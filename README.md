# Waymore Jobs

Shop app for Waymore truck repairs: service orders with action items (complaint, cause, correction),
mechanic timers, photos, parts, scheduling, billing, office and reports. English and Spanish.

## Files

| File | What it is |
|---|---|
| `index.html` | The website. Built from `app/waymore-jobs.html` by `tools/build_site.py`. |
| `app/waymore-jobs.html` | The app source. Inside Claude it runs as an artifact with Claude's database; on the website it runs on Supabase. |
| `supabase/setup.sql` | One-time Supabase setup: worker logins and roles, shop data, history backup, photo storage, live updates, push subscriptions. |
| `supabase/functions/notify/` | Optional Edge Function that sends iPhone push notifications to the owner. See below. |
| `supabase/functions/send-invoice/` | Optional Edge Function that emails the invoice to the customer (via Resend). See below. |
| `sw.js` | Service worker that shows push notifications on the phone. |
| `manifest.json`, `icon-*.png` | Lets phones add the website to the home screen like an app. |

## Setup

1. **Supabase**: open SQL Editor, paste `supabase/setup.sql`, Run.
2. **Website**: GitHub repo Settings, Pages, "Deploy from a branch", pick the branch and `/ (root)`, Save.
3. **First login**: open the website, Create an account. The first account becomes Admin.
4. **Workers**: each worker opens the website and taps Create an account. The admin approves them in
   Settings, Workers, and picks their role (Mechanic, Shop desk or Admin).

## Roles

- **Mechanic**: Mechanic side only. No prices. Cannot invoice, mark paid, delete or change settings.
- **Shop desk**: everything except managing workers.
- **Admin**: everything.

These rules are enforced by Supabase (Row Level Security), not only hidden on screen.

## Plate → VIN lookup

"Look up plate" searches your own saved service orders (free, instant). If the plate isn't on file, type or scan the
VIN (or use the AutoZone button to look the plate up on AutoZone), and the free NHTSA decoder fills in year/make/model.

## Optional: iPhone push notifications

The owner can get a push on their iPhone when a new service order is created, a job is ready to invoice, a worker
signs up, or a repair needs authorization. It's **free** (Web Push + a VAPID key pair — no paid service).

iOS only allows web push for an **installed** web app, so the phone must **Add to Home Screen** and open it from
there, then tap **Settings → 🔔 Turn on notifications**. The app saves the phone's subscription in `push_subs`, and
the `notify` Edge Function (holding the private VAPID key as a secret) sends the push to the owner's phones.

To enable it:
1. Run the `push_subs` table SQL (it's in `supabase/setup.sql`) if not already present.
2. Deploy `supabase/functions/notify/index.ts` as a function named `notify`.
3. Set secrets: `VAPID_JWK` (the key-pair JSON) and `VAPID_SUBJECT` (`mailto:you@yourshop.com`). The matching
   public key is already embedded in the app.

The step-by-step with the exact key value is in the private Setup Guide. Without this, everything else works unchanged.

## Optional: email invoices to customers

Each service order can hold a **customer email**. When an order is marked **billed**, the app emails the invoice to
that customer automatically (and the invoice view has an **✉️ Email customer** button). Free via **Resend**.

To enable it:
1. Create a free Resend account and an API key.
2. Verify your sending domain (e.g. `waymoreauto.com`) in Resend by adding its DNS records, so invoices send from
   your shop and reach inboxes. (For testing you can use `onboarding@resend.dev`, which only emails your own account.)
3. Deploy `supabase/functions/send-invoice/index.ts` as a function named `send-invoice`.
4. Set secrets: `RESEND_API_KEY` and `INVOICE_FROM` (e.g. `Waymore Truck Repairs <invoices@waymoreauto.com>`).

The step-by-step is in the private Setup Guide. Without this, invoices still print/share as normal.

## Rebuild after changing the app

```
python3 tools/build_site.py
```
