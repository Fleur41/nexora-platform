from rest_framework.routers import SimpleRouter

from .views import DepositViewSet

router = SimpleRouter()
router.register("deposits", DepositViewSet, basename="deposit")

urlpatterns = router.urls
