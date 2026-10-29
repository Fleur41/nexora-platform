from rest_framework.routers import SimpleRouter

from .views import InspectionViewSet

router = SimpleRouter()
router.register("inspections", InspectionViewSet, basename="inspection")

urlpatterns = router.urls
