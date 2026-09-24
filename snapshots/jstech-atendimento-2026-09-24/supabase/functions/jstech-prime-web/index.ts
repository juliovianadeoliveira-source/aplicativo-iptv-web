const projectUrl = Deno.env.get('SUPABASE_URL') || 'https://fvttsguxeocisqvcrbqh.supabase.co';
const originBase = projectUrl + '/functions/v1/jstech-prime-site';

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const pathname = u.pathname;

  if (pathname.endsWith('/catalog')) {
    const r = await fetch(originBase + '/catalog', { headers: { 'accept': 'application/json' } });
    return new Response(await r.arrayBuffer(), {
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (pathname.endsWith('/lead') && req.method === 'POST') {
    const body = await req.text();
    const r = await fetch(originBase + '/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return new Response(await r.arrayBuffer(), {
      status: r.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'Allow': 'GET, HEAD, POST' } });
  }

  const r = await fetch(originBase, { headers: { 'Accept': 'text/html' } });
  const html = await r.text();
  const bytes = new TextEncoder().encode(html);

  return new Response(req.method === 'HEAD' ? null : bytes, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Disposition': 'inline; filename="index.html"',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
});