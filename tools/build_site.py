"""Build the website (index.html) from the shared app source app/waymore-jobs.html.

The same source also runs inside Claude as an artifact. Here we add the Supabase
library and project settings so the page runs in website mode (Supabase database,
worker logins, photo storage).
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "waymore-jobs.html"
OUT = ROOT / "index.html"

SUPABASE_URL = "https://onyjozzlyxknodhmfhte.supabase.co"
# Publishable key: designed to be public. Access is controlled by the login + Row Level Security in supabase/setup.sql.
SUPABASE_KEY = "sb_publishable_MO1SPIG19eRAfwz3a6hU6w_mO__2MdN"
SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js"

HEAD_EXTRA = (
    '<link rel="manifest" href="manifest.json">\n'
    '<meta name="theme-color" content="#f5b700">\n'
    '<link rel="icon" href="icon-192.png">\n'
    '<link rel="apple-touch-icon" href="icon-192.png">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="Waymore">\n'
)
BOOT = (
    f'<script src="{SUPABASE_JS}"></script>\n'
    f'<script>window.WAYMORE_SB={{url:"{SUPABASE_URL}",key:"{SUPABASE_KEY}"}};</script>\n'
)

html = SRC.read_text(encoding="utf-8")
assert html.count("<title>Waymore Jobs</title>") == 1 and html.count("\n<script>\n") == 1
html = html.replace("<title>Waymore Jobs</title>", HEAD_EXTRA + "<title>Waymore Jobs</title>", 1)
html = html.replace("\n<script>\n", "\n" + BOOT + "<script>\n", 1)
OUT.write_text(html, encoding="utf-8")
print("wrote", OUT, len(html), "bytes")
