"""Low-cardinality, non-sensitive KYVORIQ Prometheus telemetry.

No exchange keys, identifiers, balances, PnL, signal IDs or prices are
exported. Kept in a private registry rather than default process metrics.
"""
from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, generate_latest, CONTENT_TYPE_LATEST

registry=CollectorRegistry(auto_describe=True)
evaluations=Counter(
    "kyvoriq_market_evaluations_total",
    "Number of bounded strategy evaluation calls",
    registry=registry,
)
feed_healthy=Gauge(
    "kyvoriq_feed_healthy",
    "1 if primary market data is healthy, else 0",
    registry=registry,
)
agent_observations=Counter(
    "kyvoriq_smc_shadow_observations_total",
    "Confirmed-bar SMC crosscheck snapshots",
    registry=registry,
)
smc_disagreements=Counter(
    "kyvoriq_smc_structure_disagreements_total",
    "Confirmed independent structure disagreement observations",
    registry=registry,
)
read_retries=Counter(
    "kyvoriq_bitget_safe_get_retries_total",
    "Read-only Bitget UTA transport retries; never order POSTs",
    registry=registry,
)


def safe_get_retry_notice(_retry_state) -> None:
    read_retries.inc()


def record_eval(health: str):
    evaluations.inc()
    feed_healthy.set(1 if health=="HEALTHY" else 0)


def record_smc(disagreement: bool):
    agent_observations.inc()
    if disagreement:
        smc_disagreements.inc()


def expose() -> bytes:
    return generate_latest(registry)
