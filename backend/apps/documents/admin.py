from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["title", "category", "organization", "content_type", "size", "created_at"]
    list_filter = ["category", "content_type"]
    search_fields = ["title", "original_filename"]
    exclude = ["file"]
    readonly_fields = ["sha256", "size", "content_type", "original_filename"]
