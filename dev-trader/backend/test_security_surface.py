"""Security contract for Dev Trader's public HTTP surface.

The mobile backend is internet reachable. New state-changing HTTP routes must
never be added casually: they require an explicit authentication/authorization
design and a deliberate update to this test after security review.
"""
from app.main import app


MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Existing push-test endpoint does not alter exchange/account state. It remains
# the only current mutating HTTP route. Trading/execution mutations are forbidden
# from the public API surface.
REVIEWED_MUTATING_ROUTES = {
    # Credential-gated pairing issues only short-lived mobile read credentials;
    # it does not create broker orders or alter trading controls.
    ("/auth/pair", "POST"),
    ("/system-check/push", "POST"),
}


def test_no_unreviewed_public_mutation_routes():
    discovered = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = set(getattr(route, "methods", set()) or set())
        for method in methods & MUTATING_METHODS:
            discovered.add((path, method))

    assert discovered == REVIEWED_MUTATING_ROUTES, (
        "Public API mutation surface changed. Do not whitelist a new route until "
        "it has server-side authentication/authorization, audit logging and a "
        "security review. Found: " + repr(sorted(discovered))
    )


def test_no_public_exchange_mutation_route_names():
    dangerous_terms = ("execute", "order", "position", "close", "cancel", "credential", "api-key", "secret")
    for path, method in REVIEWED_MUTATING_ROUTES:
        lowered = path.lower()
        assert not any(term in lowered for term in dangerous_terms), (
            f"Reviewed public route {method} {path} looks capable of exchange or credential mutation."
        )
