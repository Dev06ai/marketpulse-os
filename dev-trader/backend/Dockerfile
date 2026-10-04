FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=3000 \
    PUSH_ENABLED=false \
    BITGET_DEMO_TRADING=true \
    DEMO_EXECUTION_PAUSED=true \
    BITGET_EXECUTION_STATE_FILE=/data/dev_trader_execution.json \
    LEARNING_STATE_FILE=/data/dev_trader_learning.json \
    DECISION_JOURNAL_FILE=/data/dev_trader_decisions.sqlite3 \
    DECISION_JOURNAL_RETENTION_DAYS=7 \
    DECISION_JOURNAL_MAX_RECORDS=750 \
    DECISION_JOURNAL_MAX_BLOB_MB=64 \
    DASHBOARD_SECONDS=5

WORKDIR /app
COPY requirements-core.txt ./
RUN pip install --no-cache-dir -r requirements-core.txt
COPY app ./app
COPY knowledge ./knowledge

EXPOSE 3000
# One process owns execution state. Multiple workers could duplicate orders.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3000} --workers 1 --ws websockets --no-access-log"]
