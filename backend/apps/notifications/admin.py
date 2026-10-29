from django.contrib import admin

from .models import Announcement, Notification, NotificationSettings


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["created_at", "kind", "channel", "recipient_key", "status"]
    list_filter = ["channel", "status", "kind"]


admin.site.register(NotificationSettings)
admin.site.register(Announcement)
