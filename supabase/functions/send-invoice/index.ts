// Waymore Jobs — email an invoice to the customer.
//
// The app calls this when an order is marked billed (and from the invoice's
// "Email customer" button). It sends the invoice HTML through Resend
// (https://resend.com, free tier). Only a signed-in worker can call it.
//
// Deploy: Supabase Dashboard -> Edge Functions -> create "send-invoice",
// paste this, Deploy. Then set these secrets (Edge Functions -> Secrets):
//   RESEND_API_KEY = your Resend API key (re_...)
//   INVOICE_FROM   = Waymore Truck Repairs <invoices@waymoreauto.com>
//                    (must be an address on a domain you verified in Resend)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const KEY = Deno.env.get("RESEND_API_KEY");
  if (!KEY) return json({ error: "not_configured" }, 200);
  const FROM = Deno.env.get("INVOICE_FROM") || "Waymore Truck Repairs <onboarding@resend.dev>";

  let to = "", subject = "", html = "", replyTo = "", cc: string[] = [];
  try {
    const b = await req.json();
    to = String(b?.to || "").trim();
    subject = String(b?.subject || "Invoice");
    html = String(b?.html || "");
    replyTo = String(b?.replyTo || "").trim();
    if (Array.isArray(b?.cc)) cc = b.cc.map((x: unknown) => String(x).trim()).filter((x: string) => x.includes("@"));
  } catch (_) {
    return json({ error: "bad_request" }, 400);
  }
  if (!to || !html) return json({ error: "no_recipient_or_body" }, 400);

  try {
    const payload: Record<string, unknown> = { from: FROM, to: [to], subject, html };
    if (replyTo) payload.reply_to = replyTo;
    if (cc.length) payload.cc = cc;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: data?.message || ("Resend error " + r.status) }, 200);
    return json({ ok: true, id: data?.id });
  } catch (_e) {
    return json({ error: "send_failed" }, 200);
  }
});
