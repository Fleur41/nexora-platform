from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("notifications", views.InboxViewSet, basename="notification")
router.register("notification-log", views.DeliveryLogViewSet, basename="notification-log")
router.register("announcements", views.AnnouncementViewSet, basename="announcement")

urlpatterns = [
    path(
        "notification-settings/",
        views.NotificationSettingsView.as_view(),
        name="notification-settings",
    ),
    *router.urls,
]
