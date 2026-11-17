// Waymore Jobs — CarsXE license-plate decoder proxy.
//
// Why this exists: CarsXE's plate lookup is a PAID endpoint and its key must be
// passed in the request URL. Putting that key in the public website would let
// anyone read it and spend the shop's CarsXE credits. This Edge Function keeps
// the key as a Supabase secret (CARSXE_KEY) and makes the call server-side, so
// the key never reaches the browser. It also adds the CORS headers the browser
// needs and makes a free NHTSA VIN decode possible afterwards from the VIN it
// returns.
//
// Only signed-in workers can call it: Supabase verifies the login (JWT) before
// this runs, and we additionally refuse accounts still "pending" approval.
//
// Deploy: Supabase Dashboard -> Edge Functions -> create "platedecoder",
// paste this file, Deploy. Then set the secret:
//   Edge Functions -> Secrets (or Project Settings -> Edge Functions):
//   CARSXE_KEY = your CarsXE API key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Browser preflight.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const KEY = Deno.env.get("CARSXE_KEY");
  if (!KEY) {
    // Function deployed but the key was never set. The app falls back to the
    // manual flow when it sees this.
    return json({ error: "not_configured", success: false }, 200);
  }

  // Make sure the caller is an approved worker (not a pending sign-up), so an
  // unapproved account can't spend paid lookups.
  try {
    const auth = req.headers.get("Authorization") || "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: who } = await supa.auth.getUser();
    if (!who?.user) return json({ error: "sign_in", success: false }, 401);
    const { data: prof } = await supa
      .from("profiles")
      .select("role")
      .eq("user_id", who.user.id)
      .single();
    if (!prof || prof.role === "pending") {
      return json({ error: "not_approved", success: false }, 403);
    }
  } catch (_e) {
    // If the profile check itself fails, don't block the lookup on it.
  }

  let plate = "", state = "", country = "";
  try {
    const b = await req.json();
    plate = String(b?.plate || "").trim();
    state = String(b?.state || "").trim();
    country = String(b?.country || "").trim();
  } catch (_e) {
    return json({ error: "bad_request", success: false }, 400);
  }
  if (!plate) return json({ error: "no_plate", success: false }, 400);

  const u = new URL("https://api.carsxe.com/v2/platedecoder");
  u.searchParams.set("key", KEY);
  u.searchParams.set("plate", plate);
  if (state) u.searchParams.set("state", state);
  if (country) u.searchParams.set("country", country);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(u.toString(), { signal: ctrl.signal });
    clearTimeout(t);
    const data = await r.json().catch(() => ({}));
    // Pass CarsXE's answer straight back. The app reads data.vin.
    return json(data, 200);
  } catch (_e) {
    return json({ error: "lookup_failed", success: false }, 200);
  }
});
