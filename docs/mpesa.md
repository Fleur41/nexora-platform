# Activating M-Pesa (Safaricom Daraja)

**Current status: the integration is built and tested against a simulated Daraja API. It has not
been run against Safaricom's real sandbox or production, because that needs credentials only the
landlord (or Nexora's operator) can obtain.** Until the steps below are done for a paybill or till,
Nexora shows it as *Not connected* and staff record M-Pesa payments manually with the M-Pesa code.

## What each landlord needs

1. **A paybill or till** in the landlord's own name (Nexora never collects tenants' money).
2. **A Daraja app** at <https://developer.safaricom.co.ke> with the *M-Pesa Express* (STK push)
   and *C2B* products. This gives a **consumer key** and **consumer secret**.
3. **For STK payment prompts:** the **Lipa na M-Pesa Online passkey** for the shortcode
   (sandbox: shown on the Daraja test credentials page; production: issued by Safaricom at go-live).
4. **For production:** Safaricom's go-live approval for the shortcode on that Daraja app.

## What the Nexora deployment needs

| Setting | Why |
| ------- | --- |
| `NEXORA_FIELD_ENCRYPTION_KEY` | Fernet key that encrypts consumer secrets and passkeys at rest. Back it up: losing it makes stored credentials unreadable. Rotate by putting the new key first: `new,old`. |
| `NEXORA_PUBLIC_API_URL` | Public **https** URL of the Django API. Safaricom posts callbacks here; `localhost` is unreachable. For sandbox testing, an ngrok/cloudflared tunnel to port 8000 works. |
| `MPESA_CALLBACK_ALLOWED_IPS` (optional) | Comma-separated Safaricom callback IPs. If set, callbacks from other addresses are rejected and logged. |
| Celery worker + beat | Beat expires STK requests that never got a callback. |

## Steps in the app (Owner)

1. **Payment settings → Add payment method** → *M-Pesa Paybill* or *Till*, with the shortcode.
2. **M-Pesa connection** → choose *Sandbox* or *Production*, paste the consumer key, secret and
   passkey → **Save credentials**. Secrets are encrypted and never shown again.
3. **Test connection**. Nexora requests an OAuth token from Safaricom; only on success does the
   status become **Connected**.
4. **Register callback URLs** registers this configuration's confirmation/validation URLs for
   C2B (paybill/till payments made from the tenant's phone). The URLs contain a per-configuration
   secret; keep them private.

## How payments flow

- **Tenant pays to the paybill/till (C2B):** Safaricom calls the confirmation URL. Nexora stores
  the event, ignores repeats of the same `TransID`, checks the shortcode, then records the payment.
  The *account number* the tenant typed (lease number like `LSE0007`, or the unit number) picks the
  lease; if it doesn't match exactly one active lease, the payment waits under **Payments →
  Unmatched** for staff to match.
- **Staff sends a payment prompt (STK push)** from a lease page: the tenant gets a PIN prompt. When
  Safaricom's callback says it succeeded, Nexora **re-checks with Safaricom's STK query API**
  (server-side verification) and confirms the amount before recording the payment and receipt.
  Cancelled prompts record nothing; anything inconsistent is marked *Needs review*.
- Every callback is answered quickly with `ResultCode 0`, except unexpected server errors, which
  return 500 so Safaricom retries (processing is idempotent).

## Testing in the sandbox

Use Safaricom's sandbox shortcode `174379` and its published test passkey, the test MSISDN from the
Daraja portal, and a tunnel for `NEXORA_PUBLIC_API_URL`. The Daraja portal's *C2B simulate* sends a
confirmation to your registered URL; STK prompts go to the sandbox test phone.
