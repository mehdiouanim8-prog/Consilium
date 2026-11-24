/**
 * Same-origin Cloudflare Pages API proxy.
 * Configure the Pages environment variable CONSILIUM_API_ORIGIN to the deployed
 * Consilium Worker origin, for example https://consilium-system.<account>.workers.dev.
 * The browser calls /api/* on the website origin; this Function forwards the
 * request and response (including HttpOnly Set-Cookie headers) to the Worker.
 */
export async function onRequest({ request, env }) {
  const configuredOrigin = String(env.CONSILIUM_API_ORIGIN || '').trim();
  if (!configuredOrigin) {
    return new Response(JSON.stringify({
      ok: false,
      code: 'API_PROXY_NOT_CONFIGURED',
      message: 'The Consilium application service has not been connected yet.'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  let apiOrigin;
  try {
    apiOrigin = new URL(configuredOrigin);
  } catch (_error) {
    return new Response('CONSILIUM_API_ORIGIN must be a valid HTTPS URL.', { status: 500 });
  }
  if (apiOrigin.protocol !== 'https:' || apiOrigin.username || apiOrigin.password) {
    return new Response('CONSILIUM_API_ORIGIN must be an HTTPS origin without credentials.', { status: 500 });
  }

  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/')) {
    return new Response('Not found', { status: 404 });
  }

  const target = new URL(`${incoming.pathname}${incoming.search}`, apiOrigin.origin);
  const upstreamRequest = new Request(target.toString(), request);
  const upstreamResponse = await fetch(upstreamRequest);
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}
