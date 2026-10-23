from rest_framework.routers import SimpleRouter

from .moveout_views import MoveOutViewSet
from .views import LeaseViewSet

router = SimpleRouter()
router.register("leases", LeaseViewSet, basename="lease")
router.register("move-outs", MoveOutViewSet, basename="move-out")

urlpatterns = router.urls
