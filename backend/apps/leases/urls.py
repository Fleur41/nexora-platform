from rest_framework.routers import SimpleRouter

from .views import LeaseViewSet

router = SimpleRouter()
router.register("leases", LeaseViewSet, basename="lease")

urlpatterns = router.urls
