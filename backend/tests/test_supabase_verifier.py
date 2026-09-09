"""SupabaseJWTVerifier: what it accepts, and every forgery it must refuse.

These tests mint real ES256 tokens against a keypair generated here and hand the
verifier a JWKS client backed by that key, so the signature path is exercised
for real rather than mocked away. Nothing here touches the network or the
database - the verifier is a pure function of (token, key material) by design.

The negative cases are the point. A verifier that accepts a valid token is easy;
the ones that matter are the token from another Supabase project, the token
signed with the public key under HS256, and the JWKS endpoint being down.
"""

import time
import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.auth.verifier import (
    InvalidToken,
    SupabaseJWTVerifier,
    VerifierUnavailable,
)

SUPABASE_URL = "https://znaveeefzgfxsblsobdb.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
KID = "37ceb9c4-e8b1-4071-a6b1-173e34932514"


@pytest.fixture(scope="module")
def signing_key() -> ec.EllipticCurvePrivateKey:
    """One P-256 key for the module. Generation is the slow part, not the tests."""
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def verifier(
    monkeypatch: pytest.MonkeyPatch, signing_key: ec.EllipticCurvePrivateKey
) -> SupabaseJWTVerifier:
    """A verifier whose JWKS lookup returns our public key instead of fetching.

    Only the transport is replaced. `jwt.decode` still verifies the signature,
    the audience, the issuer, the expiry and the algorithm against that key, so
    every assertion below is about real verification.
    """
    built = SupabaseJWTVerifier(supabase_url=SUPABASE_URL)

    class _Key:
        key = signing_key.public_key()

    monkeypatch.setattr(
        built._jwks_client,
        "get_signing_key_from_jwt",
        lambda _token: _Key(),
    )
    return built


def mint(
    signing_key: ec.EllipticCurvePrivateKey,
    *,
    algorithm: str = "ES256",
    key: Any = None,
    **overrides: Any,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
    }
    for field, value in overrides.items():
        if value is None:
            payload.pop(field, None)
        else:
            payload[field] = value
    return jwt.encode(
        payload,
        key if key is not None else signing_key,
        algorithm=algorithm,
        headers={"kid": KID},
    )


class TestAccepts:
    def test_a_valid_supabase_token_yields_its_subject(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        user_id = uuid.uuid4()
        claims = verifier.verify(mint(signing_key, sub=str(user_id)))
        assert claims.user_id == user_id

    def test_the_subject_is_our_user_id_unchanged(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        """`users.id` IS `auth.users.id` - no mapping, no truncation, no case games."""
        user_id = uuid.uuid4()
        claims = verifier.verify(mint(signing_key, sub=str(user_id).upper()))
        assert claims.user_id == user_id


class TestRoleIsNotAuthorization:
    def test_the_token_role_is_carried_but_is_never_our_role(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        """Supabase says `authenticated` for everyone; that is not a permission.

        `deps.get_current_user` reads the real role from our users table. This
        asserts the verifier does not smuggle a Postgres role into a field that
        looks like an application role.
        """
        claims = verifier.verify(mint(signing_key))
        assert claims.role == "authenticated"

    def test_a_forged_admin_role_claim_does_not_become_an_admin_claim(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        """Even a validly-signed token cannot assert an application role.

        A Supabase project owner can put anything in `role`. It reaches
        TokenClaims, and it is inert there - nothing in this application may
        branch on it. This test exists so that stops being true loudly.
        """
        claims = verifier.verify(mint(signing_key, role="ADMIN"))
        assert claims.role == "ADMIN"
        # The guarantee is in deps.get_current_user, which never reads it.
        import inspect

        from app.api import deps

        assert "claims.role" not in inspect.getsource(deps.get_current_user)


class TestRefuses:
    def test_an_expired_token(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        now = int(time.time())
        with pytest.raises(InvalidToken):
            verifier.verify(mint(signing_key, iat=now - 7200, exp=now - 3600))

    def test_a_token_from_another_supabase_project(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        """Without the issuer check this verifies as soon as the key matches."""
        with pytest.raises(InvalidToken):
            verifier.verify(
                mint(signing_key, iss="https://someoneelse.supabase.co/auth/v1")
            )

    def test_a_token_for_a_different_audience(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        with pytest.raises(InvalidToken):
            verifier.verify(mint(signing_key, aud="anon"))

    def test_a_token_with_no_expiry(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        with pytest.raises(InvalidToken):
            verifier.verify(mint(signing_key, exp=None))

    def test_a_token_with_no_subject(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        with pytest.raises(InvalidToken):
            verifier.verify(mint(signing_key, sub=None))

    def test_a_subject_that_is_not_a_uuid(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        with pytest.raises(InvalidToken):
            verifier.verify(mint(signing_key, sub="not-a-uuid"))

    def test_a_token_signed_by_a_different_key(
        self, verifier: SupabaseJWTVerifier
    ) -> None:
        attacker = ec.generate_private_key(ec.SECP256R1())
        with pytest.raises(InvalidToken):
            verifier.verify(mint(attacker))

    def test_alg_none(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        now = int(time.time())
        unsigned = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "aud": "authenticated",
                "iss": ISSUER,
                "iat": now,
                "exp": now + 3600,
            },
            key="",
            algorithm="none",
            headers={"kid": KID},
        )
        with pytest.raises(InvalidToken):
            verifier.verify(unsigned)

    def test_hs256_signed_with_the_public_key(
        self, verifier: SupabaseJWTVerifier, signing_key: ec.EllipticCurvePrivateKey
    ) -> None:
        """The classic asymmetric/symmetric confusion attack.

        The public key is public. If HS256 were accepted, anyone could sign a
        token with it and the verifier would check that signature against the
        same value and pass. ALGORITHMS excludes HS256 for exactly this reason.
        """
        import base64
        import hashlib
        import hmac
        import json

        from cryptography.hazmat.primitives import serialization

        public_pem = signing_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

        # Forged by hand on purpose. PyJWT's `encode` refuses to use a PEM key
        # as an HMAC secret, which is a guard on the SIGNING side - an attacker
        # writing twenty lines of base64 and hmac is not subject to it. Testing
        # through `encode` would therefore prove PyJWT protects us when signing
        # and prove nothing about what this verifier accepts.
        def b64(raw: bytes) -> bytes:
            return base64.urlsafe_b64encode(raw).rstrip(b"=")

        now = int(time.time())
        header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": KID}).encode())
        payload = b64(
            json.dumps(
                {
                    "sub": str(uuid.uuid4()),
                    "aud": "authenticated",
                    "iss": ISSUER,
                    "iat": now,
                    "exp": now + 3600,
                }
            ).encode()
        )
        signed = header + b"." + payload
        signature = b64(hmac.new(public_pem, signed, hashlib.sha256).digest())
        forged = (signed + b"." + signature).decode()

        with pytest.raises(InvalidToken):
            verifier.verify(forged)

    def test_an_unknown_kid_is_a_bad_token_not_an_outage(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A rotated-out or foreign `kid` must be 401, never 500.

        Reporting it as an outage would let anyone force 5xx responses with a
        made-up kid, and would make ordinary key rotation look like downtime.
        """
        built = SupabaseJWTVerifier(supabase_url=SUPABASE_URL)

        def _no_such_key(_token: str) -> None:
            raise PyJWKClientError('Unable to find a signing key that matches: "x"')

        monkeypatch.setattr(built._jwks_client, "get_signing_key_from_jwt", _no_such_key)
        with pytest.raises(InvalidToken):
            built.verify("irrelevant.because.lookup.fails")


class TestOutageIsNotRejection:
    def test_an_unreachable_jwks_endpoint_does_not_report_a_bad_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A valid session must not be told it expired because we cannot reach Supabase.

        InvalidToken becomes a 401, which sends the driver back to a login
        screen that also cannot work. VerifierUnavailable fails loudly instead.
        """
        built = SupabaseJWTVerifier(supabase_url=SUPABASE_URL)

        def _down(_token: str) -> None:
            raise PyJWKClientConnectionError("cannot reach jwks endpoint")

        monkeypatch.setattr(built._jwks_client, "get_signing_key_from_jwt", _down)

        with pytest.raises(VerifierUnavailable):
            built.verify("any.token.at.all")

    def test_verifier_unavailable_is_not_an_invalid_token(self) -> None:
        """Guards the distinction against a well-meaning future refactor."""
        assert not issubclass(VerifierUnavailable, InvalidToken)


class TestIssuerConstruction:
    def test_a_trailing_slash_on_the_url_does_not_change_the_issuer(self) -> None:
        """`https://x.supabase.co/` and `https://x.supabase.co` are the same project.

        Without the rstrip the issuer becomes `...co//auth/v1` and every real
        token is rejected - a config typo that would present as total auth
        failure.
        """
        assert (
            SupabaseJWTVerifier(supabase_url=SUPABASE_URL + "/")._issuer
            == SupabaseJWTVerifier(supabase_url=SUPABASE_URL)._issuer
        )
