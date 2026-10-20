import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PRODUCTS, validateInquiry, cleanCart, newRequestId } from '../assets/inquiry-model.mjs';
import { createHandler } from '../netlify/functions/inquiry.mjs';

const requestId = '912003cc-bf22-40c2-8e06-a6c4d6081ef1';
const good = () => ({ requestId, mode: 'products', items: [{ id: 'fiamma-01', quantity: 2 }, { id: 'gift-box-01', quantity: 1 }], name: 'Тестовый покупатель', email: 'test@example.test', phone: '', comment: '', consent: true });
const settings = { INQUIRY_ENABLED: 'true', INQUIRY_WEBHOOK_URL: 'https://receiver.example.test/inquiries', INQUIRY_WEBHOOK_TOKEN: 'test-only-token', INQUIRY_SITE_ORIGIN: 'https://atelier.example.test' };
const env = key => settings[key];
const req = (body = good(), extra = {}) => new Request('https://atelier.example.test/.netlify/functions/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', origin: settings.INQUIRY_SITE_ORIGIN }, body: JSON.stringify(body), ...extra });
const accepted = () => Response.json({ status: 'accepted', requestId, receipt: 'TEST-001' });

test('request keys work in HTTPS and HTTP preview contexts', () => {
  const fallback = newRequestId({ getRandomValues: array => crypto.getRandomValues(array) });
  assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newRequestId(), newRequestId());
});

test('catalogue computes authoritative totals, ignoring client prices', () => {
  const input = good(); input.items[0].unitPrice = 1; input.estimatedTotal = 1;
  const { value, errors } = validateInquiry(input);
  assert.deepEqual(errors, {}); assert.equal(value.estimatedTotal, 10700); assert.equal(value.items[0].unitPrice, 4900);
});
test('rejects empty, unknown, duplicate and invalid-quantity baskets', () => {
  for (const items of [[], [{ id: 'missing', quantity: 1 }], [{ id: 'fiamma-01', quantity: 0 }], [{ id: 'fiamma-01', quantity: 1.5 }], [{ id: 'fiamma-01', quantity: 100 }], [{ id: 'fiamma-01', quantity: '2' }], [null], [...good().items, good().items[0]]]) assert.ok(validateInquiry({ ...good(), items }).errors.items);
});
test('contact validation and consent', () => {
  for (const change of [{ name: ' ' }, { email: '', phone: '' }, { email: 'bad@' }, { phone: '123' }, { phone: 'abc1234567890' }, { consent: false }, { comment: 'x'.repeat(2001) }]) assert.ok(Object.keys(validateInquiry({ ...good(), ...change }).errors).length);
  assert.deepEqual(validateInquiry({ ...good(), email: '', phone: '+7 (999) 123-45-67' }).errors, {});
});
test('custom inquiry requires description and quantity, without catalogue items', () => {
  const custom = { ...good(), mode: 'custom', items: [], quantity: 3, comment: 'Индивидуальная стеклянная чаша' };
  assert.deepEqual(validateInquiry(custom).errors, {}); assert.equal(validateInquiry(custom).value.estimatedTotal, null);
  assert.ok(validateInquiry({ ...custom, comment: ' ' }).errors.comment);
  assert.ok(validateInquiry({ ...custom, quantity: 0 }).errors.quantity);
});
test('corrupted storage cannot inject catalogue rows', () => {
  assert.deepEqual(cleanCart({}), []);
  assert.deepEqual(cleanCart([null, { id: '<script>', quantity: 1 }, { id: 'fiamma-01', quantity: -1 }]), []);
  assert.deepEqual(cleanCart([{ id: 'luce-01', quantity: 80 }, { id: 'luce-01', quantity: 80 }]), [{ id: 'luce-01', quantity: 99 }]);
});
test('unconfigured or partial setup does not send', async () => {
  for (const missing of Object.keys(settings)) {
    const handler = createHandler({ env: key => key === missing ? undefined : env(key), deliver: () => assert.fail('must not deliver') });
    assert.equal((await handler(req())).status, 503);
    const response = await handler(new Request('https://atelier.example.test/.netlify/functions/inquiry'));
    assert.equal((await response.json()).enabled, false);
  }
});
test('rejects invalid origin, payload, content type, UUID and oversized streams', async () => {
  const handler = createHandler({ env, deliver: () => assert.fail('must not deliver') });
  assert.equal((await handler(req(good(), { headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example.test' } }))).status, 403);
  assert.equal((await handler(req(good(), { body: '{' }))).status, 400);
  assert.equal((await handler(req(good(), { headers: { 'content-type': 'text/plain', origin: settings.INQUIRY_SITE_ORIGIN } }))).status, 415);
  assert.equal((await handler(req({ ...good(), requestId: 'invalid' }))).status, 400);
  assert.equal((await handler(req({ ...good(), items: [] }))).status, 400);
  assert.equal((await handler(req({ ...good(), comment: 'a'.repeat(17000) }))).status, 413);
});
test('confirmed receiver acceptance forwards canonical data and idempotency key', async () => {
  let deliveries = 0;
  const handler = createHandler({ env, deliver: async (url, options) => {
    deliveries++; assert.equal(url, settings.INQUIRY_WEBHOOK_URL); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    assert.equal(options.headers['Idempotency-Key'], requestId);
    const payload = JSON.parse(options.body); assert.equal(payload.estimatedTotal, 10700); assert.equal(payload.source, 'laguna-atelier');
    return accepted();
  } });
  for (let i = 0; i < 2; i++) {
    const response = await handler(req()); assert.equal(response.status, 200); assert.equal((await response.json()).receipt, 'TEST-001');
  }
  assert.equal(deliveries, 2); // Receiver must durably deduplicate this shared key.
});
test('never reports success on generic acknowledgements, redirects, errors or timeouts', async () => {
  for (const deliver of [async () => new Response('<html>OK</html>'), async () => Response.json({ ok: true }), async () => Response.json({ status: 'accepted', requestId: 'wrong', receipt: '123' }), async () => Response.json({ status: 'accepted', requestId, receipt: '' }), async () => new Response('', { status: 302 }), async () => new Response('', { status: 500 }), async () => { throw new DOMException('timeout', 'TimeoutError'); }]) {
    const response = await createHandler({ env, deliver })(req()); assert.equal(response.status, 502); assert.equal((await response.json()).status, 'unconfirmed');
  }
});
test('all product actions and basket links exist; noindex and animation code retained', async () => {
  for (const product of PRODUCTS) {
    const html = await readFile(`${product.id}.html`, 'utf8'); assert.ok(html.includes(`inquiry.html?add=${product.id}`));
  }
  for (const name of (await readdir('.')).filter(name => name.endsWith('.html'))) {
    const html = await readFile(name, 'utf8'); assert.ok(html.includes('noindex,nofollow'), name);
    assert.ok(!/data-demo|alert\(/.test(html), name);
    if (name !== 'inquiry.html') assert.ok(html.includes('href="inquiry.html"'), name);
  }
  const home = await readFile('index.html', 'utf8'); assert.ok(home.includes('inquiry.html?mode=custom')); assert.ok(home.includes('function syncWorldMotion()'));
});
