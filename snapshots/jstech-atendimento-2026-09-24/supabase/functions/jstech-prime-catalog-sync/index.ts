import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Source = { key: string; name: string; url: string };
type Plan = { name: string; price: number; months: number; monthly_equivalent: number; service: string };

const SOURCES: Source[] = [
  { key: "plenocs", name: "Pleno CS", url: "https://plenocs.net/" },
  { key: "questbr", name: "Quest BR", url: "https://questbr.com.br/" },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const sbUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const dbHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

function textFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(?:ndash|mdash);|&#8211;|&#8212;/gi, "-")
    .replace(/&atilde;/gi, "ã").replace(/&aacute;/gi, "á")
    .replace(/&ecirc;/gi, "ê").replace(/&eacute;/gi, "é")
    .replace(/&ccedil;/gi, "ç").replace(/&iacute;/gi, "í")
    .replace(/\s+/g, " ")
    .trim();
}

function numberBR(value: string) {
  const normalized = value.trim().replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}

function findPrice(text: string, label: string, months: number): Plan | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:Plano\\s+)?${escaped}[\\s\\S]{0,180}?R\\$\\s*([0-9.]+(?:,[0-9]{1,2})?)`, "i"),
    new RegExp(`R\\$\\s*([0-9.]+(?:,[0-9]{1,2})?)[\\s\\S]{0,90}?${escaped}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const price = numberBR(match[1]);
    if (!Number.isFinite(price) || price <= 0 || price > 5000) continue;
    return { name: label, months, price, monthly_equivalent: Number((price / months).toFixed(2)), service: "IPTV" };
  }
  return null;
}

function extractPlans(text: string) {
  const definitions: Array<[string, number]> = [
    ["Mensal", 1], ["Trimestral", 3], ["Semestral", 6], ["Anual", 12],
  ];
  return definitions.map(([label, months]) => findPrice(text, label, months)).filter(Boolean) as Plan[];
}

function extractPlenoBlock(text: string, start: RegExp, end: RegExp, service: string): Plan[] {
  const startMatch = text.match(start);
  if (!startMatch || startMatch.index === undefined) return [];
  const from = startMatch.index;
  const tail = text.slice(from + startMatch[0].length);
  const endMatch = tail.match(end);
  const block = text.slice(from, endMatch?.index === undefined ? from + 700 : from + startMatch[0].length + endMatch.index);
  const section = block.match(/R\$\s*([0-9.]+\s*(?:,\s*[0-9]{1,2})?)\s*mensal([\s\S]{0,600})/i);
  if (!section) return [];
  const monthly = numberBR(section[1]);
  const rest = section[2];
  const valueBefore = (label: string) => {
    const match = rest.match(new RegExp(`R\\$\\s*([0-9.]+\\s*(?:,\\s*[0-9]{1,2})?)[^R$]{0,35}${label}`, "i"));
    return match ? numberBR(match[1]) : null;
  };
  const values: Array<[string, number, number | null]> = [
    ["Mensal", 1, monthly],
    ["Trimestral", 3, valueBefore("Trimestral")],
    ["Semestral", 6, valueBefore("Semestral")],
    ["Anual", 12, valueBefore("Anual")],
  ];
  return values.filter(([, , price]) => Number.isFinite(price) && Number(price) > 0).map(([name, months, price]) => ({
    name, months, price: Number(price), monthly_equivalent: Number((Number(price) / months).toFixed(2)), service,
  }));
}

function extractPlenoPlans(text: string): Plan[] {
  const satellite = extractPlenoBlock(text, /CS\s+Sat[eé]lite\s+R\$/i, /CS\s+NET\s+R\$/i, "CS Satélite");
  const cable = extractPlenoBlock(text, /CS\s+NET\s+R\$/i, /IPTV\s+R\$/i, "CS NET").filter((plan) => plan.months === 1);
  const iptv = extractPlenoBlock(text, /IPTV\s+R\$/i, /(?:Ver detalhes|Perguntas Frequentes)/i, "IPTV");
  return [...satellite, ...cable, ...iptv];
}

function includesAny(text: string, values: string[]) {
  const lower = text.toLocaleLowerCase("pt-BR");
  return values.filter((value) => lower.includes(value.toLocaleLowerCase("pt-BR")));
}

function extractCatalog(text: string, source: Source) {
  const compatibility = includesAny(text, [
    "Smart TV", "TV Box", "Android TV", "Fire TV Stick", "Chromecast", "Roku",
    "Android", "iPhone", "Celular", "Tablet", "Notebook", "Computador", "PC",
    "Projetor smart", "iPad", "Apple TV",
  ]);
  const qualities = includesAny(text, ["SD", "HD", "Full HD", "4K"]);
  const payments = [
    /\bpix\b/i.test(text) ? "Pix" : null,
    /cart[aã]o(?:\s+de\s+cr[eé]dito)?/i.test(text) ? "Cartão de crédito" : null,
    /boleto/i.test(text) ? "Boleto bancário" : null,
  ].filter(Boolean);
  const trial = text.match(/teste(?:\s+IPTV)?(?:\s+gr[aá]tis)?[^.]{0,70}?([0-9]{1,3})\s*(?:h|hora)/i);
  const speed = (quality: string) => {
    const escaped = quality.replace(" ", "\\s+");
    const match = text.match(new RegExp(`${escaped}[^.]{0,90}?([0-9]{1,3})\\s*Mbps`, "i"));
    return match ? Number(match[1]) : null;
  };
  return {
    plans: source.key === "plenocs" ? extractPlenoPlans(text) : extractPlans(text),
    compatibility,
    qualities,
    payments: source.key === "plenocs" ? ["Pix"] : payments,
    internet_recommendations: {
      HD_mbps: speed("HD"),
      FullHD_mbps: speed("Full HD"),
      "4K_mbps": speed("4K"),
    },
    free_trial: /teste(?:\s+IPTV)?\s+gr[aá]tis/i.test(text),
    support: {
      trial_hours: source.key === "plenocs" ? 24 : (trial ? Number(trial[1]) : null),
      whatsapp_days_per_week: /(?:todos os dias|7\s+dias)/i.test(text) ? 7 : null,
    },
  };
}

async function save(source: Source, payload: Record<string, unknown>) {
  const response = await fetch(`${sbUrl}/rest/v1/jstech_prime_catalog_sync?on_conflict=source_key`, {
    method: "POST",
    headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ source_key: source.key, ...payload }),
  });
  if (!response.ok) throw new Error(`Banco ${response.status}: ${await response.text()}`);
  return await response.json();
}

async function markError(source: Source, message: string) {
  await fetch(`${sbUrl}/rest/v1/jstech_prime_catalog_sync?source_key=eq.${source.key}`, {
    method: "PATCH",
    headers: dbHeaders,
    body: JSON.stringify({ sync_status: "error", last_error: message.slice(0, 500) }),
  });
}

async function syncOne(source: Source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JSTechPrimeCatalogSync/2.0; +https://juliovianadeoliveira-source.github.io/aplicativo-iptv-web/jstech-prime/)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`Fonte HTTP ${response.status}`);
    const text = textFromHtml(await response.text());
    const catalog = extractCatalog(text, source);
    if (catalog.plans.length < 1) throw new Error("Nenhum plano reconhecido; último dado preservado");
    const rows = await save(source, {
      ...catalog,
      fetched_at: new Date().toISOString(),
      source_last_modified: response.headers.get("last-modified"),
      sync_status: "ok",
      last_error: null,
    });
    return { key: source.key, name: source.name, ok: true, plans: catalog.plans.length, row: rows[0] ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markError(source, message).catch(() => undefined);
    return { key: source.key, name: source.name, ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }
  const results = await Promise.all(SOURCES.map(syncOne));
  return new Response(JSON.stringify({ ok: results.some((item) => item.ok), sources: results, synced_at: new Date().toISOString() }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
});
