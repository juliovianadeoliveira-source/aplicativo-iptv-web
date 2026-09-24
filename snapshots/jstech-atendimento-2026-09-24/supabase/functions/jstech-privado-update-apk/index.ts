import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function apkHeaders(name: string, bytes: Uint8Array): Headers {
  return new Headers({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": 'attachment; filename="' + name + '"',
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const u = new URL(req.url);
    const requested = u.searchParams.get("v") || "";

    if (requested.startsWith("1.5.5")) {
      const source = "https://raw.githubusercontent.com/juliovianadeoliveira-source/jstech-prime-site/main/updates/JSTech-Privado-1.5.5-release.b64.txt?t=" + Date.now();
      const r = await fetch(source, { headers: { "cache-control": "no-cache" } });
      if (!r.ok) throw new Error("github_payload");
      const bytes = b64ToBytes(await r.text());
      const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
      const expected = "6982de93ce14a8ae2f2ae795a089d62cad930f3d54c0e54bb36db27f737b888a";
      if (sha !== expected) {
        return new Response(JSON.stringify({ok:false,error:"checksum_mismatch",expected,actual:sha,bytes:bytes.byteLength}), {
          status:503, headers:{"content-type":"application/json","cache-control":"no-store"}
        });
      }
      if (u.searchParams.get("meta") === "1") {
        return new Response(JSON.stringify({ok:true,versionCode:29,versionName:"1.5.5",bytes:bytes.byteLength,sha256:sha,source:"github"}), {
          headers:{"content-type":"application/json","cache-control":"no-store"}
        });
      }
      const headers = apkHeaders("JSTech-Privado-1.5.5.apk", bytes);
      if (req.method === "HEAD") return new Response(null,{status:200,headers});
      return new Response(bytes,{status:200,headers});
    }

    const base = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const h = { apikey: key, Authorization: `Bearer ${key}` };

    const m = await fetch(
      base + "/rest/v1/jstech_privado_updates?select=version_code,version_name,sha256&order=version_code.desc&limit=1",
      { headers: h }
    );
    if (!m.ok) throw new Error("metadata");
    const metas = await m.json();
    if (!metas.length) throw new Error("no metadata");
    const meta = metas[0];

    const p = await fetch(
      base + `/rest/v1/jstech_privado_update_parts?select=part_no,b64&version_code=eq.${meta.version_code}&order=part_no.asc`,
      { headers: h }
    );
    if (!p.ok) throw new Error("parts");
    const parts = await p.json();
    if (!parts.length) throw new Error("no parts");

    const bytes = b64ToBytes(parts.map((x: any) => x.b64).join(""));
    const sha = hex(await crypto.subtle.digest("SHA-256", bytes));

    if (sha !== meta.sha256) {
      return new Response(JSON.stringify({ok:false,error:"checksum_mismatch",expected:meta.sha256,actual:sha,bytes:bytes.byteLength}), {
        status:503, headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }

    if (u.searchParams.get("meta") === "1") {
      return new Response(JSON.stringify({ok:true,versionCode:meta.version_code,versionName:meta.version_name,bytes:bytes.byteLength,sha256:sha,parts:parts.length}), {
        headers:{"content-type":"application/json","cache-control":"no-store"}
      });
    }

    const headers = apkHeaders(`JSTech-Privado-${meta.version_name}.apk`, bytes);
    if (req.method === "HEAD") return new Response(null,{status:200,headers});
    return new Response(bytes,{status:200,headers});
  } catch (_e) {
    return new Response(JSON.stringify({ok:false,error:"update_unavailable"}), {
      status:503, headers:{"content-type":"application/json","cache-control":"no-store"}
    });
  }
});