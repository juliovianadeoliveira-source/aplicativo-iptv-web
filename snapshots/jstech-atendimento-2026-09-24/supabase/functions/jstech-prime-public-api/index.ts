import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const sbUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const dbHeaders = {
  "Content-Type": "application/json",
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};
const sourceMeta: Record<string, { name: string; url: string }> = {
  plenocs: { name: "Pleno CS", url: "https://plenocs.net/" },
  questbr: { name: "Quest BR", url: "https://questbr.com.br/" },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method === "GET") {
    const fields = "source_key,plans,compatibility,qualities,payments,internet_recommendations,free_trial,support,fetched_at,sync_status,last_error";
    const response = await fetch(`${sbUrl}/rest/v1/jstech_prime_catalog_sync?select=${fields}&source_key=in.(questbr,plenocs)&order=source_key.asc`, { headers: dbHeaders });
    if (!response.ok) {
      return new Response(JSON.stringify({ ok: false, sources: [] }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const rows = await response.json();
    const sources = rows.map((row: Record<string, unknown>) => ({ ...row, ...(sourceMeta[String(row.source_key)] || {}) }));
    return new Response(JSON.stringify({ ok: true, sources, generated_at: new Date().toISOString() }), {
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const nome = String(body?.nome || "").trim().slice(0, 100);
      const whatsapp = String(body?.whatsapp || "").replace(/[^0-9+() -]/g, "").trim().slice(0, 30);
      const servico = String(body?.servico || "").trim().slice(0, 120);
      const mensagem = String(body?.mensagem || "").trim().slice(0, 1000);
      if (nome.length < 2 || whatsapp.replace(/\D/g, "").length < 8 || !servico) {
        return new Response(JSON.stringify({ ok: false, error: "Dados inválidos." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const response = await fetch(`${sbUrl}/rest/v1/jstech_prime_leads`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ nome, whatsapp, servico, mensagem }),
      });
      return new Response(JSON.stringify({ ok: response.ok }), {
        status: response.ok ? 200 : 500,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    } catch {
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
  }

  return new Response("Method Not Allowed", { status: 405, headers: cors });
});
