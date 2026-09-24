import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Channel = {
  id: string;
  name: string;
  logo: string;
  group: string;
  category: string;
  adult: boolean;
  kind: "hls" | "mpegts";
  streamKey: string;
  url: string;
};

type PublicChannel = Omit<Channel, "url"> & { playId: string };

type Catalog = {
  channels: Channel[];
  categories: { key: string; label: string; count: number }[];
  groups: { name: string; count: number }[];
  total: number;
  loaded: number;
  partial: boolean;
  syncedAt: number;
};

const SOURCE_URL = "http://max.maxplaystb.uk/get.php?username=870370184&password=405108473&type=m3u_plus&output=mpegts";
const DEFAULT_LIMIT = 900;
const MAX_LIMIT = 1200;
const TTL_MS = 4 * 60 * 1000;
const catalogCache = new Map<string, { at: number; catalog: Catalog }>();

const sourceInfo = new URL(SOURCE_URL);
const SOURCE_ORIGIN = `${sourceInfo.protocol}//${sourceInfo.host}`;
const SOURCE_USER = sourceInfo.searchParams.get("username") ?? "";
const SOURCE_PASS = sourceInfo.searchParams.get("password") ?? "";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Accept, Authorization",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = {
  ...CORS,
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const CATEGORY_LABELS: Record<string, string> = {
  abertos: "Abertos",
  noticias: "Noticias",
  esportes: "Esportes",
  filmes: "Filmes e premium",
  infantil: "Infantil",
  documentarios: "Documentarios",
  religiosos: "Religiosos",
  adultos: "Adultos",
  outros: "Outros",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function redirectToPlayer() {
  return Response.redirect("https://juliovianadeoliveira-source.github.io/aplicativo-iptv-web/jstech-orion-player/?v=9-real-creds", 302);
}

function normalize(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function attr(line: string, key: string) {
  const found = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
  return found?.[1]?.trim() ?? "";
}

function classify(group: string, name: string) {
  const text = normalize(`${group} ${name}`);
  if (/adult|xxx|porn|erotic/.test(text)) return { category: "adultos", adult: true };
  if (/relig|gospel|catolic|cristao|cancao nova|cançao nova/.test(text)) return { category: "religiosos", adult: false };
  if (/infantil|kids|desenho|cartoon|crianca|disney|nick|toon|ra tim bum/.test(text)) return { category: "infantil", adult: false };
  if (/document|discovery|history|nat geo|natgeo|animal planet/.test(text)) return { category: "documentarios", adult: false };
  if (/sport|esport|premiere|espn|futebol|combate|ufc|nba|nfl|sportv|sport tv/.test(text)) return { category: "esportes", adult: false };
  if (/news|noticia|jornal|cnn|globo news|globonews|record news|band news|bandnews/.test(text)) return { category: "noticias", adult: false };
  if (/telecine|hbo|cinemax|megapix|warner|sony|paramount|space|axn|fx|filme|cine|series/.test(text)) return { category: "filmes", adult: false };
  if (/globo|sbt|record|band|redetv|rede tv|cultura|gazeta|tv brasil|aberto/.test(text)) return { category: "abertos", adult: false };
  return { category: "outros", adult: false };
}

function isVod(group: string, name: string, url: string) {
  const text = normalize(`${group} ${name}`);
  if (/\/(movie|series)\//i.test(url)) return true;
  if (/\.mp4(\?|$)|\.mkv(\?|$)|\.avi(\?|$)/i.test(url)) return true;
  if (/^filmes\b|^series\b|\bvod\b|lancamentos|temporada|episodio/.test(text)) return true;
  return false;
}

function streamKind(url: string): "hls" | "mpegts" {
  return /\.m3u8(\?|$)/i.test(url) ? "hls" : "mpegts";
}

function streamKeyFromUrl(value: string) {
  try {
    const u = new URL(value);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return last.replace(/\.(ts|m3u8)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
  } catch (_) {
    return "";
  }
}

function scoreChannel(c: Channel) {
  const text = normalize(`${c.name} ${c.group}`);
  let score = 0;
  if (/globo sp\b|globo rj\b|globo minas\b/.test(text)) score += 130;
  if (/globo/.test(text)) score += 120;
  if (/sbt/.test(text)) score += 105;
  if (/record/.test(text)) score += 95;
  if (/band\b/.test(text)) score += 85;
  if (/redetv|rede tv/.test(text)) score += 75;
  if (/sportv|premiere|espn/.test(text)) score += 65;
  if (/news|noticia|jornal/.test(text)) score += 40;
  if (/ h265\b|uhd|4k/.test(text)) score -= 45;
  if (/ sd\b/.test(text)) score += 5;
  if (c.adult) score -= 1000;
  return score;
}

function makeChannel(seq: number, pending: { name: string; logo: string; group: string }, url: string): Channel {
  const info = classify(pending.group, pending.name);
  return {
    id: `seq_${seq}`,
    name: pending.name.replace(/\s+/g, " ").trim() || "Canal",
    logo: pending.logo,
    group: pending.group.replace(/\s+/g, " ").trim() || "Sem categoria",
    category: info.category,
    adult: info.adult,
    kind: streamKind(url),
    streamKey: streamKeyFromUrl(url),
    url,
  };
}

async function fetchSource() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(SOURCE_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
        "Accept": "*/*",
      },
    });
    if (!res.ok || !res.body) throw new Error(`Fonte respondeu ${res.status}`);
    return res.body.getReader();
  } finally {
    clearTimeout(timer);
  }
}

async function scanCatalog(limit: number, query = ""): Promise<Catalog> {
  const cappedLimit = Math.max(50, Math.min(MAX_LIMIT, limit || DEFAULT_LIMIT));
  const q = normalize(query);
  const reader = await fetchSource();
  const decoder = new TextDecoder("utf-8");
  const channels: Channel[] = [];
  const seen = new Set<string>();
  let pending: { name: string; logo: string; group: string } | null = null;
  let buffer = "";
  let seq = 0;
  let partial = false;

  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return false;

    if (line.startsWith("#EXTINF")) {
      const display = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Canal";
      pending = {
        name: attr(line, "tvg-name") || display || "Canal",
        logo: attr(line, "tvg-logo"),
        group: attr(line, "group-title") || "Sem categoria",
      };
      return false;
    }

    if (line.startsWith("#") || !pending || !/^https?:\/\//i.test(line)) return false;

    const key = `${normalize(pending.name)}|${line}`;
    if (!isVod(pending.group, pending.name, line) && !seen.has(key)) {
      seen.add(key);
      const channel = makeChannel(seq, pending, line);
      seq++;
      const haystack = normalize(`${channel.name} ${channel.group}`);
      if (channel.streamKey && (!q || haystack.includes(q))) channels.push(channel);
      if (channels.length >= cappedLimit) {
        partial = true;
        return true;
      }
    }

    pending = null;
    return false;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const stop = handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (stop) {
          try { await reader.cancel(); } catch (_) {}
          return buildCatalog(channels, seq, partial);
        }
        idx = buffer.indexOf("\n");
      }
      if (buffer.length > 250000) buffer = "";
    }
    handleLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }

  return buildCatalog(channels, seq, partial);
}

function buildCatalog(channels: Channel[], scanned: number, partial: boolean): Catalog {
  channels.sort((a, b) => scoreChannel(b) - scoreChannel(a) || a.name.localeCompare(b.name));
  const cat = new Map<string, number>();
  const groups = new Map<string, number>();
  for (const c of channels) {
    cat.set(c.category, (cat.get(c.category) ?? 0) + 1);
    groups.set(c.group, (groups.get(c.group) ?? 0) + 1);
  }
  return {
    channels,
    categories: Object.keys(CATEGORY_LABELS)
      .filter((key) => cat.has(key))
      .map((key) => ({ key, label: CATEGORY_LABELS[key], count: cat.get(key)! })),
    groups: [...groups.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    total: channels.length,
    loaded: channels.length,
    partial,
    syncedAt: Date.now(),
  };
}

async function findChannelBySeq(target: number): Promise<Channel | null> {
  for (const cached of catalogCache.values()) {
    const found = cached.catalog.channels.find((c) => c.id === `seq_${target}`);
    if (found) return found;
  }

  const reader = await fetchSource();
  const decoder = new TextDecoder("utf-8");
  const seen = new Set<string>();
  let pending: { name: string; logo: string; group: string } | null = null;
  let buffer = "";
  let seq = 0;
  let found: Channel | null = null;

  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line) return false;
    if (line.startsWith("#EXTINF")) {
      const display = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Canal";
      pending = { name: attr(line, "tvg-name") || display || "Canal", logo: attr(line, "tvg-logo"), group: attr(line, "group-title") || "Sem categoria" };
      return false;
    }
    if (line.startsWith("#") || !pending || !/^https?:\/\//i.test(line)) return false;
    const key = `${normalize(pending.name)}|${line}`;
    if (!isVod(pending.group, pending.name, line) && !seen.has(key)) {
      seen.add(key);
      if (seq === target) {
        found = makeChannel(seq, pending, line);
        return true;
      }
      seq++;
    }
    pending = null;
    return false;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const stop = handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (stop) {
          try { await reader.cancel(); } catch (_) {}
          return found;
        }
        idx = buffer.indexOf("\n");
      }
      if (buffer.length > 250000) buffer = "";
    }
    handleLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }

  return found;
}

function publicCatalog(catalog: Catalog) {
  const channels: PublicChannel[] = catalog.channels.map(({ url: _url, ...channel }) => ({
    ...channel,
    playId: channel.id,
  }));
  return { ...catalog, channels };
}

async function handleCatalog(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const query = url.searchParams.get("q") ?? "";
  const key = `${Math.max(50, Math.min(MAX_LIMIT, limit || DEFAULT_LIMIT))}|${normalize(query)}`;
  const cached = catalogCache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS && url.searchParams.get("refresh") !== "1") {
    return json(publicCatalog(cached.catalog));
  }

  try {
    const catalog = await scanCatalog(limit, query);
    catalogCache.set(key, { at: Date.now(), catalog });
    return json(publicCatalog(catalog));
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    return json({ error: `Nao carregou os canais: ${message}` }, 502);
  }
}

async function handleCep(url: URL) {
  const cep = (url.searchParams.get("cep") ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return json({ error: "Digite um CEP com 8 numeros." }, 400);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("ViaCEP falhou");
    const data = await res.json();
    if (data.erro || !data.uf) return json({ error: "CEP nao encontrado." }, 404);
    return json({ uf: data.uf, city: data.localidade ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro";
    return json({ error: `Nao consultei o CEP: ${message}` }, 502);
  }
}

type StreamCred = { user: string; pass: string };

function keyPart(value: string) {
  return value.replace(/\.(ts|m3u8)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function pushCred(list: StreamCred[], user: string, pass: string) {
  if (!user || !pass) return;
  if (!list.some((item) => item.user === user && item.pass === pass)) list.push({ user, pass });
}

function credsFromOriginalUrl(originalUrl: string, streamKey: string) {
  const creds: StreamCred[] = [];
  try {
    const original = new URL(originalUrl);
    const parts = original.pathname.split("/").filter(Boolean);
    const keyIndex = parts.findLastIndex((part) => keyPart(part) === streamKey);
    if (keyIndex >= 2) {
      pushCred(creds, parts[keyIndex - 2], parts[keyIndex - 1]);
    }
  } catch (_) {}
  return creds;
}

function candidateUrls(streamKey: string, originalUrl?: string) {
  const key = streamKey.replace(/[^a-zA-Z0-9_-]/g, "");
  const candidates = new Set<string>();
  const origins: string[] = [];
  const creds: StreamCred[] = [];

  const addOrigin = (origin: string) => {
    if (!origin || origins.includes(origin)) return;
    origins.push(origin.replace(/\/$/, ""));
    try {
      const secure = new URL(origin);
      if (secure.protocol === "http:") {
        secure.protocol = "https:";
        const secureOrigin = secure.toString().replace(/\/$/, "");
        if (!origins.includes(secureOrigin)) origins.push(secureOrigin);
      }
    } catch (_) {}
  };

  if (originalUrl) {
    try {
      const original = new URL(originalUrl);
      candidates.add(original.toString());
      if (original.protocol === "http:") {
        const secureOriginal = new URL(original.toString());
        secureOriginal.protocol = "https:";
        candidates.add(secureOriginal.toString());
      }
      addOrigin(`${original.protocol}//${original.host}`);
      for (const cred of credsFromOriginalUrl(originalUrl, key)) pushCred(creds, cred.user, cred.pass);
    } catch (_) {}
  }

  pushCred(creds, SOURCE_USER, SOURCE_PASS);
  addOrigin(SOURCE_ORIGIN);

  const addFormats = (origin: string, user: string, pass: string) => {
    if (!origin || !user || !pass || !key) return;
    const base = origin.replace(/\/$/, "");
    candidates.add(`${base}/live/${user}/${pass}/${key}.ts`);
    candidates.add(`${base}/live/${user}/${pass}/${key}`);
    candidates.add(`${base}/${user}/${pass}/${key}`);
    candidates.add(`${base}/${user}/${pass}/${key}.ts`);
    candidates.add(`${base}/live/${user}/${pass}/${key}.m3u8`);
    candidates.add(`${base}/hls/${user}/${pass}/${key}.m3u8`);
  };

  for (const origin of origins) {
    for (const cred of creds) addFormats(origin, cred.user, cred.pass);
  }

  return [...candidates];
}

const HEADER_PROFILES = [
  {
    name: "vlc",
    headers: {
      "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
      "Accept": "*/*",
      "Icy-MetaData": "1",
    },
  },
  {
    name: "browser",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "video/webm,video/ogg,video/*;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
    },
  },
  {
    name: "smarters",
    headers: {
      "User-Agent": "IPTVSmartersPlayer/4.0",
      "Accept": "*/*",
      "Connection": "keep-alive",
    },
  },
  {
    name: "tivimate",
    headers: {
      "User-Agent": "TiviMate/5.1.0",
      "Accept": "*/*",
    },
  },
  {
    name: "okhttp",
    headers: {
      "User-Agent": "okhttp/4.12.0",
      "Accept": "*/*",
    },
  },
];

function headersForUpstream(range: string | null, candidate = "", profileIndex = 0) {
  const profile = HEADER_PROFILES[profileIndex] ?? HEADER_PROFILES[0];
  const headers: Record<string, string> = { ...profile.headers };
  if (range) headers.Range = range;
  try {
    const origin = new URL(candidate);
    headers.Referer = `${origin.protocol}//${origin.host}/`;
  } catch (_) {}
  return headers;
}

async function tryUpstream(url: string, range: string | null, timeoutMs: number, profileIndex = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: headersForUpstream(range, url, profileIndex),
      redirect: "follow",
    });
    return upstream;
  } finally {
    clearTimeout(timer);
  }
}

function makeStreamResponse(req: Request, upstream: Response, kind: "hls" | "mpegts") {
  const out = new Headers(CORS);
  out.set("Content-Type", upstream.headers.get("content-type") || (kind === "hls" ? "application/vnd.apple.mpegurl" : "video/mp2t"));
  out.set("Cache-Control", "no-store");
  const len = upstream.headers.get("content-length");
  const cr = upstream.headers.get("content-range");
  const ar = upstream.headers.get("accept-ranges");
  if (len) out.set("Content-Length", len);
  if (cr) out.set("Content-Range", cr);
  if (ar) out.set("Accept-Ranges", ar);
  return new Response(req.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: out });
}

async function handleStream(req: Request, url: URL) {
  let streamKey = (url.searchParams.get("key") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  let kind: "hls" | "mpegts" = "mpegts";
  let originalUrl = "";

  const id = url.searchParams.get("id") ?? "";
  const target = Number(id.replace(/^seq_/, ""));
  if (id && Number.isFinite(target) && target >= 0) {
    const channel = await findChannelBySeq(target);
    if (channel) {
      streamKey = channel.streamKey;
      kind = channel.kind;
      originalUrl = channel.url;
    }
  }

  if (!streamKey) {
    return new Response("Canal invalido.", { status: 400, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  }

  const range = req.headers.get("range");
  const candidates = candidateUrls(streamKey, originalUrl);
  const failures: string[] = [];
  let lastError = "";

  for (const candidate of candidates) {
    for (let profile = 0; profile < HEADER_PROFILES.length; profile++) {
      try {
        const upstream = await tryUpstream(candidate, range, 9000, profile);
        const type = upstream.headers.get("content-type") ?? "";
        const playableType = !/text\/(html|plain)/i.test(type);
        if (upstream.ok && upstream.body && playableType) {
          const candidateKind = /\.m3u8(\?|$)/i.test(candidate) ? "hls" : kind;
          return makeStreamResponse(req, upstream, candidateKind);
        }
        failures.push(`${upstream.status}`);
        try { await upstream.body?.cancel(); } catch (_) {}
      } catch (err) {
        lastError = err instanceof Error ? err.message : "erro";
        failures.push("erro");
      }
    }
  }

  const detail = failures.length ? `origem recusou: ${[...new Set(failures)].slice(0, 8).join("/")}` : lastError || "sem resposta da origem";
  return new Response(`Canal indisponivel agora: ${detail}`, { status: 502, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
}

function redactErrorForDebug(value: string) {
  return value
    .replaceAll(SOURCE_USER, "***")
    .replaceAll(SOURCE_PASS, "***")
    .replace(/(https?:\/\/[^\s/]+\/)\S+/g, "$1***");
}

function redactUrlForDebug(value: string) {
  try {
    const u = new URL(value);
    const parts = u.pathname.split("/").filter(Boolean);
    const clean = parts.map((part) => part);
    const lastIndex = clean.length - 1;
    if (lastIndex >= 2) {
      clean[lastIndex - 2] = "***";
      clean[lastIndex - 1] = "***";
    }
    if ((clean[0] === "live" || clean[0] === "hls") && clean.length >= 4) {
      clean[1] = "***";
      clean[2] = "***";
    }
    u.pathname = "/" + clean.join("/");
    u.search = "";
    return u.toString();
  } catch (_) {
    return "url-invalida";
  }
}

async function handleProbe(url: URL) {
  let streamKey = (url.searchParams.get("key") ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  let originalUrl = "";
  const id = url.searchParams.get("id") ?? "";
  const target = Number(id.replace(/^seq_/, ""));
  if (id && Number.isFinite(target) && target >= 0) {
    const channel = await findChannelBySeq(target);
    if (channel) {
      streamKey = channel.streamKey;
      originalUrl = channel.url;
    }
  }
  if (!streamKey) return json({ error: "id/key invalido" }, 400);

  const attempts: { url: string; status: number; type: string; profile: string; body?: string; error?: string }[] = [];
  for (const candidate of candidateUrls(streamKey, originalUrl).slice(0, 12)) {
    for (let profile = 0; profile < HEADER_PROFILES.length; profile++) {
      try {
        const upstream = await tryUpstream(candidate, null, 7000, profile);
        const type = upstream.headers.get("content-type") ?? "";
        let body = "";
        if (!upstream.ok || /text\/(html|plain)/i.test(type)) {
          try {
            body = (await upstream.text()).replace(/\s+/g, " ").slice(0, 160);
          } catch (_) {}
        } else {
          try { await upstream.body?.cancel(); } catch (_) {}
        }
        attempts.push({ url: redactUrlForDebug(candidate), status: upstream.status, type, profile: HEADER_PROFILES[profile].name, body });
      } catch (err) {
        attempts.push({ url: redactUrlForDebug(candidate), status: -1, type: "", profile: HEADER_PROFILES[profile].name, error: err instanceof Error ? redactErrorForDebug(err.message) : "erro" });
      }
    }
  }

  return json({ key: streamKey, attempts });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const api = url.searchParams.get("api");

  try {
    if (api === "health") return json({ ok: true, version: "stream-proxy-10-safe-debug" });
    if (api === "catalog") return await handleCatalog(url);
    if (api === "cep") return await handleCep(url);
    if (api === "stream") return await handleStream(req, url);
    if (api === "probe") return await handleProbe(url);
    if (api === "debug") return json({ ok: true, version: "stream-proxy-10-safe-debug", cacheKeys: [...catalogCache.keys()] });
    return redirectToPlayer();
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    if (api) return json({ error: `Falha no servidor: ${message}` }, 500);
    return redirectToPlayer();
  }
});
