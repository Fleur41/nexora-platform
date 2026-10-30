from rest_framework import serializers

from .models import Plan, Subscription, SubscriptionInvoice


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = [
            "id",
            "code",
            "name",
            "description",
            "max_units",
            "monthly_price",
            "currency",
            "is_active",
            "sort_order",
        ]


class SubscriptionInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionInvoice
        fields = [
            "id",
            "number",
            "plan_name",
            "period_start",
            "period_end",
            "amount",
            "currency",
            "due_date",
            "status",
            "paid_at",
            "payment_method",
            "payment_reference",
            "created_at",
        ]
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)
    access_ends_on = serializers.DateField(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "plan",
            "status",
            "trial_ends_on",
            "paid_until",
            "access_ends_on",
            "complimentary",
            "account_code",
        ]
        read_only_fields = fields


class ChangePlanSerializer(serializers.Serializer):
    plan = serializers.SlugRelatedField(slug_field="code", queryset=Plan.objects.all())


class PayInvoiceSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
