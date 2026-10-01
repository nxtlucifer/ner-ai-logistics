"""SEC-006: who the login rate limit is counted against.

THE FINDING

The limiter keyed on `request.client.host`. Behind Render's proxy that is
the proxy, so every client on the internet shared one per-address budget:
one noisy caller locked everybody out, and on a quiet day an attacker had
the whole budget to themselves.

WHY THE OBVIOUS FIX IS WORSE THAN THE BUG

"Read X-Forwarded-For" turns a shared limit into NO limit. The header is
client-controlled; anyone can send a different value on every request and
get a fresh budget each time. A fix that makes the control weaker than
leaving it alone is not a fix, which is why this finding stayed open
rather than being closed quickly.

WHAT IS ACTUALLY CORRECT

Trust exactly the number of proxies that are really in front of the
service, and read from the RIGHT, because a conforming proxy appends the
address it received from. Anything the client wrote is pushed left and
never reached.

These tests are mostly about the attacker's side of that: the forged
prefix must never be selected, at any hop count.
"""

from app.core.rate_limit import client_address

PEER = "10.0.0.7"  # the proxy, as the app sees it
CLIENT = "203.0.113.9"  # the real caller
FORGED = "1.2.3.4"  # whatever the caller put in the header


class TestNoProxyConfigured:
    def test_the_header_is_ignored_entirely(self):
        """The default. Trusting the header with nothing overwriting it
        would let any caller mint a new identity per request."""
        assert client_address(PEER, f"{FORGED}", 0) == PEER
        assert client_address(PEER, f"{FORGED}, {CLIENT}", 0) == PEER

    def test_a_missing_peer_still_gets_a_key(self):
        # An unattributable request must share one budget, not escape the
        # limit by having no key at all.
        assert client_address(None, None, 0) == "unknown-peer"


class TestOneProxy:
    def test_the_real_client_is_read(self):
        assert client_address(PEER, CLIENT, 1) == CLIENT

    def test_a_forged_prefix_is_not_read(self):
        """The attack. The caller sends a header; the proxy appends their
        real address to the right of it."""
        assert client_address(PEER, f"{FORGED}, {CLIENT}", 1) == CLIENT

    def test_many_forged_entries_change_nothing(self):
        forged = ", ".join([FORGED] * 20)
        assert client_address(PEER, f"{forged}, {CLIENT}", 1) == CLIENT

    def test_whitespace_and_empty_entries_do_not_shift_the_index(self):
        assert client_address(PEER, f"  {FORGED} , , {CLIENT}  ", 1) == CLIENT


class TestTwoProxies:
    def test_counts_from_the_right(self):
        # client -> edge -> app-proxy: the header reads "client, edge".
        assert client_address(PEER, f"{CLIENT}, 10.1.1.1", 2) == CLIENT

    def test_a_forged_prefix_is_still_not_read(self):
        assert client_address(PEER, f"{FORGED}, {CLIENT}, 10.1.1.1", 2) == CLIENT


class TestShortChains:
    def test_fewer_hops_than_configured_does_not_wrap_around(self):
        """A request that did not come through the expected chain.

        Indexing past the start would silently select the rightmost entry -
        the proxy - and quietly restore the original bug. It clamps to the
        leftmost real entry instead.
        """
        assert client_address(PEER, CLIENT, 3) == CLIENT

    def test_an_empty_header_falls_back_to_the_peer(self):
        assert client_address(PEER, "", 1) == PEER
        assert client_address(PEER, "   ,  ", 1) == PEER
        assert client_address(PEER, None, 1) == PEER


class TestBounds:
    def test_an_over_long_entry_is_truncated(self):
        # The audit column is 45 characters; a header is attacker-sized.
        assert len(client_address(PEER, "x" * 500, 1)) == 45

    def test_two_different_clients_get_two_different_keys(self):
        """The property the whole finding is about: behind a proxy, two
        callers must not share one budget."""
        a = client_address(PEER, "198.51.100.1", 1)
        b = client_address(PEER, "198.51.100.2", 1)
        assert a != b
