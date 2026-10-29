"""Shared Django settings for Nexora. Environment-specific modules import from here."""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=["http://localhost:3000"])

# Public URL of the Next.js frontend, used when building links in emails.
FRONTEND_URL = env("NEXORA_FRONTEND_URL", default="http://localhost:3000").rstrip("/")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    # Shared platform layer
    "apps.core",
    "apps.accounts",
    "apps.organizations",
    "apps.audit",
    "apps.documents",
    # Business modules
    "apps.properties",
    "apps.tenants",
    "apps.leases",
    "apps.utilities",
    "apps.billing",
    "apps.deposits",
    "apps.payments",
    "apps.notifications",
    "apps.maintenance",
    "apps.inspections",
    "apps.portal",
    "apps.reports",
    "apps.listings",
    "apps.subscriptions",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestIdMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DATABASE_CONN_MAX_AGE", default=60)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("NEXORA_DEFAULT_TIMEZONE", default="Africa/Nairobi")
USE_I18N = True
USE_TZ = True

NEXORA_DEFAULT_CURRENCY = env("NEXORA_DEFAULT_CURRENCY", default="KES")

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Private file storage -------------------------------------------------
# Uploaded documents are never served from a public URL. They are streamed through
# permission-checked API endpoints. Local development stores them on disk; production
# should point the "private" storage at an S3-compatible bucket (django-storages).
PRIVATE_MEDIA_ROOT = Path(env("PRIVATE_MEDIA_ROOT", default=str(BASE_DIR / "private_media")))
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": PRIVATE_MEDIA_ROOT, "base_url": None},
    },
    "private": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
        "OPTIONS": {"location": PRIVATE_MEDIA_ROOT},
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
DOCUMENT_MAX_UPLOAD_BYTES = env.int("DOCUMENT_MAX_UPLOAD_BYTES", default=10 * 1024 * 1024)
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024

# --- Sessions & CSRF -------------------------------------------------------
# The browser talks to Django through the Next.js proxy, so cookies are same-origin.
SESSION_COOKIE_NAME = "nexora_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=60 * 60 * 24 * 7)
CSRF_COOKIE_NAME = "nexora_csrftoken"
CSRF_COOKIE_HTTPONLY = False  # The SPA must read it to send X-CSRFToken.
CSRF_COOKIE_SAMESITE = "Lax"

# --- REST framework --------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication"  # enforces CSRF when logged in
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_ANON", default="60/min"),
        "user": env("THROTTLE_USER", default="600/min"),
        "auth": env("THROTTLE_AUTH", default="10/min"),
        # Public enquiry and viewing-request forms, per IP.
        "enquiry": env("THROTTLE_ENQUIRY", default="10/hour"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Nexora API",
    "DESCRIPTION": "Nexora all-in-one business management platform API.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "ENUM_NAME_OVERRIDES": {
        "UnitTypeCategoryEnum": "apps.properties.models.UnitType.Category",
        "DocumentCategoryEnum": "apps.documents.models.Document.Category",
        "ChargeRuleMethodEnum": "apps.billing.models.ChargeRule.Method",
        "DepositMethodEnum": "apps.deposits.models.DepositTransaction.Method",
        "InvoiceKindEnum": "apps.billing.models.Invoice.Kind",
        "DepositKindEnum": "apps.deposits.models.DepositTransaction.Kind",
        "InvoiceStatusEnum": "apps.billing.models.Invoice.Status",
        "LeaseStatusEnum": "apps.leases.models.Lease.Status",
        "TenantStatusEnum": "apps.tenants.models.Tenant.Status",
        "UnitStatusEnum": "apps.properties.models.Unit.Status",
        "MembershipStatusEnum": "apps.organizations.models.Membership.Status",
        "InvitationStatusEnum": "apps.organizations.models.Invitation.Status",
        "OrganizationStatusEnum": "apps.organizations.models.Organization.Status",
        "MeterUtilityEnum": "apps.utilities.models.Meter.Utility",
        "PaymentMethodEnum": "apps.payments.models.PaymentMethod",
        "PaymentStatusEnum": "apps.payments.models.Payment.Status",
        "PaymentRequestStatusEnum": "apps.payments.models.PaymentRequest.Status",
        "ProviderEventStatusEnum": "apps.payments.models.ProviderEvent.Status",
        "PaymentSourceEnum": "apps.payments.models.Payment.Source",
        "MaintenanceStatusEnum": "apps.maintenance.models.MaintenanceRequest.Status",
        "MaintenanceCategoryEnum": "apps.maintenance.models.MaintenanceRequest.Category",
        "MaintenanceSourceEnum": "apps.maintenance.models.MaintenanceRequest.Source",
        "MaintenanceCostKindEnum": "apps.maintenance.models.MaintenanceCost.Kind",
        "MaintenanceCostStatusEnum": "apps.maintenance.models.MaintenanceCost.Status",
        "InspectionKindEnum": "apps.inspections.models.Inspection.Kind",
        "InspectionStatusEnum": "apps.inspections.models.Inspection.Status",
        "MoveOutStatusEnum": "apps.leases.models.MoveOutNotice.Status",
        "NotificationKindEnum": "apps.notifications.models.Notification.Kind",
        "NotificationStatusEnum": "apps.notifications.models.Notification.Status",
    },
}

# --- Cache (throttling) ----------------------------------------------------
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# --- Celery ----------------------------------------------------------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=REDIS_URL)
CELERY_RESULT_BACKEND = None
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ACKS_LATE = True
CELERY_BEAT_SCHEDULE = {
    "scheduled-billing": {
        "task": "apps.billing.tasks.run_scheduled_billing_for_all",
        "schedule": 60 * 60 * 6,  # several times a day; each org bills at most once a month
    },
    "daily-reminders": {
        "task": "apps.notifications.tasks.send_scheduled_reminders",
        "schedule": 60 * 60 * 6,  # dedupe keys make repeated runs harmless
    },
    "subscription-lifecycle": {
        "task": "apps.subscriptions.tasks.run_subscription_lifecycle",
        "schedule": 60 * 60 * 6,  # idempotent: one invoice per period, status only moves forward
    },
    "retry-stuck-notifications": {
        "task": "apps.notifications.tasks.retry_stuck_notifications",
        "schedule": 60 * 15,
    },
    "expire-stale-mpesa-requests": {
        "task": "apps.payments.tasks.expire_stale_payment_requests",
        "schedule": 60 * 10,
    },
    "sync-unit-occupancy": {
        "task": "apps.leases.tasks.sync_unit_occupancy",
        "schedule": 60 * 60,  # hourly; idempotent
    },
}

# --- Email -----------------------------------------------------------------
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Nexora <no-reply@nexora.local>")

# --- Payments & integrations ----------------------------------------------
# Fernet key(s) for encrypting integration secrets at rest. Comma-separate to rotate.
NEXORA_FIELD_ENCRYPTION_KEY = env("NEXORA_FIELD_ENCRYPTION_KEY", default="")
# Public HTTPS base URL of this API (e.g. https://api.nexora.co.ke), used to build the
# callback URLs registered with Safaricom. Callbacks cannot reach localhost.
NEXORA_PUBLIC_API_URL = env("NEXORA_PUBLIC_API_URL", default="").rstrip("/")
# Optional allowlist of Safaricom callback source IPs. Empty = accept from anywhere (the
# per-configuration secret in the callback URL still authenticates the sender).
# --- Nexora's own subscription billing ---------------------------------------------------
NEXORA_TRIAL_DAYS = env.int("NEXORA_TRIAL_DAYS", default=30)
NEXORA_TRIAL_PLAN = env("NEXORA_TRIAL_PLAN", default="growth")
# How landlords pay Nexora. The account number is each organization's subscription code.
NEXORA_PAYBILL = env("NEXORA_PAYBILL", default="")
NEXORA_BANK_NAME = env("NEXORA_BANK_NAME", default="")
NEXORA_BANK_ACCOUNT = env("NEXORA_BANK_ACCOUNT", default="")
# Nexora's own Daraja app, for M-Pesa prompts on Nexora invoices (optional).
NEXORA_MPESA_ENVIRONMENT = env("NEXORA_MPESA_ENVIRONMENT", default="sandbox")
NEXORA_MPESA_CONSUMER_KEY = env("NEXORA_MPESA_CONSUMER_KEY", default="")
NEXORA_MPESA_CONSUMER_SECRET = env("NEXORA_MPESA_CONSUMER_SECRET", default="")
NEXORA_MPESA_PASSKEY = env("NEXORA_MPESA_PASSKEY", default="")

MPESA_CALLBACK_ALLOWED_IPS = env.list("MPESA_CALLBACK_ALLOWED_IPS", default=[])
MPESA_TIMEOUT_SECONDS = env.int("MPESA_TIMEOUT_SECONDS", default=20)
STATEMENT_IMPORT_MAX_ROWS = env.int("STATEMENT_IMPORT_MAX_ROWS", default=5000)

# --- Notifications ------------------------------------------------------------
# "console" logs SMS (development); "africastalking" sends via Africa's Talking.
NOTIFICATION_SMS_BACKEND = env("NOTIFICATION_SMS_BACKEND", default="console")
AFRICASTALKING_USERNAME = env("AFRICASTALKING_USERNAME", default="")
AFRICASTALKING_API_KEY = env("AFRICASTALKING_API_KEY", default="")
AFRICASTALKING_SENDER_ID = env("AFRICASTALKING_SENDER_ID", default="")

# --- Invitations -----------------------------------------------------------
INVITATION_TTL_DAYS = env.int("INVITATION_TTL_DAYS", default=7)

# --- Logging ---------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"request_id": {"()": "apps.core.middleware.RequestIdLogFilter"}},
    "formatters": {
        "structured": {
            "format": (
                "%(asctime)s level=%(levelname)s logger=%(name)s "
                "request_id=%(request_id)s msg=%(message)s"
            )
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
            "filters": ["request_id"],
        }
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
    "loggers": {"django.db.backends": {"level": "WARNING"}},
}
