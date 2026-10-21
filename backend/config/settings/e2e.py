"""Settings for browser end-to-end runs (CI): dev settings without Redis."""

from .dev import *  # noqa: F403

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
CELERY_TASK_ALWAYS_EAGER = True
