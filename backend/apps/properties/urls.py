from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("properties", views.PropertyViewSet, basename="property")
router.register("unit-types", views.UnitTypeViewSet, basename="unit-type")
router.register("units", views.UnitViewSet, basename="unit")
router.register(
    "property-assignments", views.PropertyAssignmentViewSet, basename="property-assignment"
)

urlpatterns = router.urls
