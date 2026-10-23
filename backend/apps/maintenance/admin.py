from django.contrib import admin

from .models import MaintenanceCost, MaintenanceRequest, MaintenanceUpdate

admin.site.register(MaintenanceRequest)
admin.site.register(MaintenanceUpdate)
admin.site.register(MaintenanceCost)
