from django.contrib import admin

from .models import Meter, MeterReading

admin.site.register(Meter)
admin.site.register(MeterReading)
