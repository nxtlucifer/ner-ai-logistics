"""Every string a client can send has a stated maximum.

WHY A SWEEP AND NOT A LIST

A hand-written list of fields to check is a list that goes stale the first
time somebody adds a field. This walks every request model the application
actually exposes and fails on any unbounded string, so a new endpoint cannot
quietly accept a megabyte of text into a VARCHAR(60) and fail at the
database - or, worse, into a TEXT column and succeed.

WHAT "BOUNDED" MEANS HERE

A `max_length`, a pattern that cannot match arbitrarily long input, or an
enum. A bare `str` is not bounded, and neither is `str | None`.

The backend is authoritative. The clients mirror these limits for the sake
of the person typing - `maxlength` in a browser is a courtesy, not a
control.
"""

from __future__ import annotations

import inspect
from typing import get_args, get_origin

import pytest
from fastapi.routing import APIRoute
from pydantic import BaseModel
from pydantic_core import PydanticUndefined

from app.main import create_app

#: Fields whose value is a server-generated identifier or a bounded scalar
#: reaching us as a string. Each entry is a deliberate exemption with a
#: reason, not a way to make the test quiet.
EXEMPT: dict[str, str] = {
    # Money and measurements arrive as strings to avoid a float round-trip
    # and are parsed to Decimal, which bounds them by its own rules.
    "weight_kg": "Decimal, range-checked by the schema",
    "quantity": "integer",
}


def _models_of(app) -> dict[str, type[BaseModel]]:
    """Every request body model the application actually serves."""
    found: dict[str, type[BaseModel]] = {}

    def walk(model: type[BaseModel]) -> None:
        if model.__name__ in found:
            return
        found[model.__name__] = model
        for field in model.model_fields.values():
            for arg in (field.annotation, *get_args(field.annotation)):
                if inspect.isclass(arg) and issubclass(arg, BaseModel):
                    walk(arg)
                for inner in get_args(arg):
                    if inspect.isclass(inner) and issubclass(inner, BaseModel):
                        walk(inner)

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for param in route.dependant.body_params:
            annotation = param.field_info.annotation
            candidates = [annotation, *get_args(annotation)]
            for candidate in candidates:
                if inspect.isclass(candidate) and issubclass(candidate, BaseModel):
                    walk(candidate)
    return found


def _string_limits(model: type[BaseModel]) -> dict[str, int | None]:
    """Per field: the maximum length the API actually enforces, or None.

    Read from the model's JSON Schema rather than from `model_fields`,
    because that is the contract - it is what FastAPI validates against and
    what the OpenAPI document publishes. A constraint declared inside a
    union arm (`Annotated[str, Field(max_length=N)] | None`) does not appear
    on `field.metadata`, and a checker that reads only that reports a
    bounded field as unbounded. A sweep that cries wolf is a sweep somebody
    switches off.

    Fields that are not strings at all are absent from the result.
    """

    def scan(node: dict) -> tuple[bool, int | None, bool]:
        """(is_string, max_length, is_bounded_by_shape)."""
        if node.get("type") == "string":
            if "enum" in node or "const" in node:
                return True, node.get("maxLength"), True
            if "format" in node or "pattern" in node:
                return True, node.get("maxLength"), True
            return True, node.get("maxLength"), node.get("maxLength") is not None
        best: tuple[bool, int | None, bool] = (False, None, True)
        for key in ("anyOf", "oneOf", "allOf"):
            for arm in node.get(key, ()):
                is_str, longest, bounded = scan(arm)
                if not is_str:
                    continue
                prev_str, prev_max, prev_bounded = best
                best = (
                    True,
                    longest if prev_max is None else max(prev_max, longest or 0),
                    (prev_bounded if prev_str else True) and bounded,
                )
        return best

    schema = model.model_json_schema(ref_template="#/$defs/{model}")
    defs = schema.get("$defs", {})

    def resolve(node: dict) -> dict:
        ref = node.get("$ref")
        if ref and ref.startswith("#/$defs/"):
            return defs.get(ref.split("/")[-1], {})
        return node

    out: dict[str, int | None] = {}
    for name, raw in schema.get("properties", {}).items():
        node = resolve(raw)
        # A union of a $ref and null needs each arm resolved too.
        for key in ("anyOf", "oneOf"):
            if key in node:
                node = {**node, key: [resolve(a) for a in node[key]]}
        is_str, longest, bounded = scan(node)
        if is_str:
            out[name] = longest if bounded or longest is not None else None
            if not bounded and longest is None:
                out[name] = None
        elif is_str:
            out[name] = longest
    return out


def _bounded_names(model: type[BaseModel]) -> tuple[set[str], set[str]]:
    """(bounded, unbounded) string field names for one model."""
    schema = model.model_json_schema(ref_template="#/$defs/{model}")
    defs = schema.get("$defs", {})
    bounded: set[str] = set()
    unbounded: set[str] = set()

    def arms(node: dict) -> list[dict]:
        ref = node.get("$ref")
        if ref and ref.startswith("#/$defs/"):
            node = defs.get(ref.split("/")[-1], {})
        found = [node]
        for key in ("anyOf", "oneOf", "allOf"):
            for arm in node.get(key, ()):
                found.extend(arms(arm))
        return found

    for name, raw in schema.get("properties", {}).items():
        pieces = arms(raw)
        strings = [n for n in pieces if n.get("type") == "string"]
        if not strings:
            continue
        # A Decimal crosses the wire as `anyOf: [number, string]` - the
        # string arm exists so a client can send "1000.5" without a float
        # round-trip, and it is bounded by VALUE (gt/le), not by length.
        # Demanding a maxLength there would be asking how many characters a
        # weight may have.
        if any(n.get("type") in ("number", "integer") for n in pieces):
            bounded.add(name)
            continue
        ok = all(
            "maxLength" in n or "enum" in n or "const" in n or "format" in n or "pattern" in n
            for n in strings
        )
        (bounded if ok else unbounded).add(name)
    return bounded, unbounded


def _max_length(model: type[BaseModel], field_name: str) -> int | None:
    limits = _string_limits(model)
    return limits.get(field_name)


@pytest.fixture(scope="module")
def request_models():
    return _models_of(create_app())


def test_the_sweep_actually_finds_the_request_models(request_models) -> None:
    """A sweep that walks nothing passes silently, which is worse than a
    missing test: it reads like coverage."""
    assert len(request_models) > 15, sorted(request_models)
    assert "LoginRequest" in request_models
    assert "StopRequest" in request_models


def test_every_client_supplied_string_has_a_maximum(request_models) -> None:
    unbounded: list[str] = []
    for name, model in sorted(request_models.items()):
        _, loose = _bounded_names(model)
        unbounded.extend(
            f"{name}.{field}" for field in sorted(loose) if field not in EXEMPT
        )
    assert unbounded == [], (
        "these accept a string of any length from a client:\n  "
        + "\n  ".join(unbounded)
    )


def test_free_text_a_driver_types_is_bounded_tightly(request_models) -> None:
    """A reason, a note or a question is a sentence, not a document.

    Separate from the sweep because the sweep only asks whether a limit
    exists. These are the fields where the limit's SIZE matters: they are
    rendered into a manager's inbox and into an AI prompt, and a 50,000
    character "reason" is a denial of service with a polite name.
    """
    too_generous: list[str] = []
    for name, model in sorted(request_models.items()):
        for field_name in model.model_fields:
            if not any(
                word in field_name
                for word in ("reason", "note", "question", "rationale", "message")
            ):
                continue
            longest = _max_length(model, field_name)
            if longest is None or longest > 2000:
                too_generous.append(f"{name}.{field_name}={longest}")
    assert too_generous == [], (
        "free text a person types should be bounded to a sentence or two:\n  "
        + "\n  ".join(too_generous)
    )


def test_a_required_string_cannot_be_satisfied_by_whitespace(request_models) -> None:
    """`min_length=1` and a space is a value that passes validation and means
    nothing. Checked for the fields where an empty value is a real failure -
    an emergency reason above all."""
    from app.api.driver import StopRequest
    from app.services.driver_trips import MIN_STOP_REASON

    schema = StopRequest.model_json_schema()["properties"]["reason"]
    assert schema["minLength"] == MIN_STOP_REASON
    # And the service strips before measuring, so spaces cannot buy length.
    assert "strip()" in inspect.getsource(
        __import__("app.services.driver_trips", fromlist=["request_stop"]).request_stop
    )
