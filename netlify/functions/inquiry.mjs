import { validateInquiry } from '../../assets/inquiry-model.mjs';

const MAX_BYTES = 16384;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

function settings(env) {
  const token = env('INQUIRY_WEBHOOK_TOKEN');
  try {
    const target = new URL(env('INQUIRY_WEBHOOK_URL'));
    const origin = new URL(env('INQUIRY_SITE_ORIGIN'));
    if (env('INQUIRY_ENABLED') !== 'true' || !token || target.protocol !== 'https:' || origin.protocol !== 'https:' || target.username || target.password || target.hash || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) return null;
    return { target: target.href, token, origin: origin.origin };
  } catch { return null; }
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new RangeError();
  if (!request.body) return '';
  const reader = request.body.getReader(); let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

// Dependencies are injectable for tests; default production handler uses real delivery.
export function createHandler({ env = key => globalThis.Netlify?.env.get(key), deliver = fetch } = {}) {
  return async request => {
    const config = settings(env);
    if (request.method === 'GET') return reply(200, { service: 'laguna-inquiry-v1', enabled: !!config });
    if (request.method !== 'POST') return reply(405, { status: 'rejected' });
    if (!config) return reply(503, { status: 'not_configured' });
    if (request.headers.get('origin') !== config.origin) return reply(403, { status: 'rejected' });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { status: 'rejected' });
    let input;
    try { input = JSON.parse(await readBody(request)); } catch (error) { return reply(error instanceof RangeError ? 413 : 400, { status: 'invalid' }); }
    const { value, errors } = validateInquiry(input);
    if (!uuid.test(input?.requestId || '') || Object.keys(errors).length) return reply(400, { status: 'invalid', errors });
    try {
      const response = await deliver(config.target, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.token}`, 'Idempotency-Key': input.requestId },
        body: JSON.stringify({ ...value, requestId: input.requestId, schemaVersion: 1, source: 'laguna-atelier' }),
      });
      const result = response.ok ? await response.json() : null;
      // A 200 page, queued response or generic webhook acknowledgement is not proof of receipt.
      if (result?.status !== 'accepted' || result.requestId !== input.requestId || typeof result.receipt !== 'string' || !/^[\p{L}\p{N} ._:/-]{1,100}$/u.test(result.receipt)) return reply(502, { status: 'unconfirmed', requestId: input.requestId });
      return reply(200, { status: 'accepted', requestId: input.requestId, receipt: result.receipt });
    } catch { return reply(502, { status: 'unconfirmed', requestId: input.requestId }); }
  };
}

export default createHandler();
export const config = { rateLimit: { windowLimit: 15, windowSize: 60, aggregateBy: ['ip', 'domain'], action: 'rate_limit' } };
