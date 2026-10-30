from rest_framework.routers import SimpleRouter

from .views import ExpenseViewSet

router = SimpleRouter()
router.register("expenses", ExpenseViewSet, basename="expense")

urlpatterns = router.urls
