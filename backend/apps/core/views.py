from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness/readiness probe. Reports database connectivity only."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []

    @extend_schema(responses={200: dict, 503: dict})
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_ok = True
        except Exception:  # noqa: BLE001 - any DB failure means not ready
            db_ok = False
        return Response(
            {"status": "ok" if db_ok else "degraded", "database": db_ok},
            status=200 if db_ok else 503,
        )
