from django.contrib import admin

from .models import Enquiry, Listing


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ["title", "unit", "organization", "is_published", "published_at"]
    list_filter = ["is_published"]


@admin.register(Enquiry)
class EnquiryAdmin(admin.ModelAdmin):
    list_display = ["reference", "name", "kind", "status", "listing", "created_at"]
    list_filter = ["kind", "status"]
