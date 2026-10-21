from django.contrib import admin

from .models import Invitation, Membership, Organization


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "status", "country", "currency", "created_at"]
    list_filter = ["status", "country"]
    search_fields = ["name", "slug"]


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "organization", "role", "status", "joined_at"]
    list_filter = ["role", "status"]
    search_fields = ["user__email", "organization__name"]


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display = ["email", "organization", "role", "status", "expires_at"]
    list_filter = ["status", "role"]
    search_fields = ["email", "organization__name"]
    exclude = ["token_hash"]
