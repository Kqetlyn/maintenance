# Maintenance dashboard (owns dashboard.db; exposes the read-only availability API).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .
WORKDIR /app/backend

# The SQLite database and imports live here — mount a persistent volume at /app/data.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8000
# Health: the integration API's own health route (token-agnostic 'ok').
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4).status==200 else 1)"

# init_db() runs on startup (creates/migrates tables incl. downtime_event and takes a
# one-time dashboard.db.bak before migrating).
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "4", "--timeout", "180"]
