# Waymore Jobs

Shop app for Waymore truck repairs: service orders with action items (complaint, cause, correction),
mechanic timers, photos, parts, scheduling, billing, office and reports. English and Spanish.

## Files

| File | What it is |
|---|---|
| `index.html` | The website. Built from `app/waymore-jobs.html` by `tools/build_site.py`. |
| `app/waymore-jobs.html` | The app source. Inside Claude it runs as an artifact with Claude's database; on the website it runs on Supabase. |
| `supabase/setup.sql` | One-time Supabase setup: worker logins and roles, shop data, history backup, photo storage, live updates. |
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

## Rebuild after changing the app

```
python3 tools/build_site.py
```
