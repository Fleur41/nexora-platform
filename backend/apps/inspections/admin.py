from django.contrib import admin

from .models import Inspection, InspectionItem

admin.site.register(Inspection)
admin.site.register(InspectionItem)
