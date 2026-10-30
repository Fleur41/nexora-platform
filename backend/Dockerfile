FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Production images get runtime dependencies only; docker-compose.yml (development) passes
# REQUIREMENTS=requirements-dev.txt for pytest and ruff.
ARG REQUIREMENTS=requirements.txt
COPY requirements.txt requirements-dev.txt ./
RUN pip install -r ${REQUIREMENTS}

COPY . .

RUN useradd --create-home nexora && mkdir -p /data/private_media /app/staticfiles \
    && chown -R nexora /app /data
USER nexora

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", \
     "--access-logfile", "-", "--timeout", "60"]
