// Waymore Jobs — push notifications to the owner's iPhone.
//
// The app calls this (best effort) when something happens: a new service order,
// a job finished / ready to invoice, a new worker signs up, a repair needs
// authorization, or a sync problem. This function looks up the owner's/admin's
// subscribed phones and sends each a Web Push notification.
//
// Free: Web Push needs no paid service, only a VAPID key pair (set as secrets).
//
// Deploy: Supabase Dashboard -> Edge Functions -> create "notify", paste this,
// Deploy. Then set these secrets (Edge Functions -> Secrets):
//   VAPID_JWK     = the key pair JSON from the setup guide
//   VAPID_SUBJECT = mailto:you@yourshop.com   (any contact email)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import * as webpush from "jsr:@negrel/webpush@^0.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// What each event looks like on the phone.
function message(type: string, text: string): { title: string; body: string } {
  const t = (text || "").toString().slice(0, 300);
  switch (type) {
    case "so":     return { title: "🆕 New service order", body: t || "A new service order was created." };
    case "done":   return { title: "✅ Ready to invoice",   body: t || "A job was finished." };
    case "signup": return { title: "👤 New worker sign-up", body: t || "Someone is waiting for approval." };
    case "auth":   return { title: "⚠️ Needs authorization", body: t || "A repair is over the pre-authorized amount." };
    case "error":  return { title: "🛑 Sync problem",       body: t || "A phone could not save to the shop." };
    default:       return { title: "Waymore Jobs",          body: t || "Update in the shop." };
  }
}

let appServerPromise: Promise<webpush.ApplicationServer> | null = null;
function appServer() {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const keys = await webpush.importVapidKeys(JSON.parse(Deno.env.get("VAPID_JWK")!), { extractable: false });
      return await webpush.ApplicationServer.new({
        contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:notify@waymore.jobs",
        vapidKeys: keys,
      });
    })();
  }
  return appServerPromise;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!Deno.env.get("VAPID_JWK")) return json({ error: "not_configured" }, 200);

  let type = "", text = "";
  try { const b = await req.json(); type = String(b?.type || ""); text = String(b?.text || ""); }
  catch (_) { return json({ error: "bad_request" }, 400); }

  // Service-role client to read the owner's/admin's subscribed phones.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: admins } = await admin.from("profiles").select("user_id").eq("role", "admin");
  const ids = (admins || []).map((a: { user_id: string }) => a.user_id);
  if (!ids.length) return json({ ok: true, sent: 0 });
  const { data: subs } = await admin.from("push_subs").select("endpoint, sub").in("user_id", ids);
  if (!subs || !subs.length) return json({ ok: true, sent: 0 });

  const server = await appServer();
  const payload = JSON.stringify({ ...message(type, text), url: "./", tag: "wm-" + type });
  let sent = 0;
  const dead: string[] = [];
  for (const row of subs) {
    try {
      const subscriber = server.subscribe(row.sub);
      await subscriber.pushTextMessage(payload, { ttl: 60, urgency: webpush.Urgency.High });
      sent++;
    } catch (e) {
      if (e instanceof webpush.PushMessageError && e.isGone()) dead.push(row.endpoint);
    }
  }
  if (dead.length) await admin.from("push_subs").delete().in("endpoint", dead);
  return json({ ok: true, sent, removed: dead.length });
});
