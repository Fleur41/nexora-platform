from rest_framework.routers import SimpleRouter

from .views import MeterReadingViewSet, MeterViewSet

router = SimpleRouter()
router.register("meters", MeterViewSet, basename="meter")
router.register("meter-readings", MeterReadingViewSet, basename="meter-reading")

urlpatterns = router.urls
