import { PRODUCTS, productById, money, cleanCart, validateInquiry, inquiryText, newRequestId } from './inquiry-model.mjs';

const $ = id => document.getElementById(id);
const form = $('inquiry-form');
const storageKey = 'laguna-cart-v1';
const endpoint = './.netlify/functions/inquiry';
let cart = [], storageAvailable = true, available = false, pending = false, completed = false;
let prepared = null, requestId = null, preparedFingerprint = null;
try { cart = cleanCart(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { storageAvailable = false; }
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch { storageAvailable = false; }
  if (!storageAvailable) {
    $('storage-note').hidden = false;
    $('storage-note').textContent = 'Браузер не сохраняет корзину. Она доступна на этой странице до её закрытия; скачайте подготовленную заявку, чтобы сохранить выбор.';
  }
}

function renderCart() {
  $('cart').replaceChildren();
  if (!cart.length) {
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Корзина пока пуста. Выберите предмет выше или перейдите к индивидуальному заказу.'; $('cart').append(empty);
  }
  for (const row of cart) {
    const product = productById(row.id);
    const article = document.createElement('article'); article.className = 'cart-item';
    // Only trusted catalogue IDs enter this template; user text is never HTML.
    article.innerHTML = `<div class="cart-item-head"><a href="${product.id}.html">${product.name}</a><span>${money(product.price)}</span></div><p class="muted">${product.description}</p><div class="cart-controls"><label for="qty-${row.id}">Количество<input id="qty-${row.id}" type="number" min="1" max="99" step="1" inputmode="numeric" value="${row.quantity}" aria-describedby="error-items"></label><button type="button" class="secondary">Убрать ${product.name}</button></div>`;
    article.querySelector('input').addEventListener('input', event => {
      row.quantity = event.target.valueAsNumber;
      persist(); updateTotal(); clearReview();
    });
    article.querySelector('button').addEventListener('click', () => {
      cart = cart.filter(item => item.id !== row.id); persist(); renderCart(); clearReview(); $('product').focus();
    });
    $('cart').append(article);
  }
  updateTotal();
}
function updateTotal() {
  const valid = cart.every(row => Number.isInteger(row.quantity) && row.quantity > 0 && row.quantity <= 99);
  $('total').textContent = valid ? `Предварительно: ${money(cart.reduce((sum, row) => sum + productById(row.id).price * row.quantity, 0))}` : 'Проверьте количество: целое число от 1 до 99.';
}
function addProduct(id) {
  if (!productById(id)) return;
  const existing = cart.find(row => row.id === id);
  if (existing) existing.quantity = Math.min(99, (Number.isInteger(existing.quantity) ? existing.quantity : 0) + 1);
  else cart.push({ id, quantity: 1 });
  persist(); renderCart(); clearReview();
}
for (const product of PRODUCTS) {
  const option = document.createElement('option'); option.value = product.id; option.textContent = `${product.name} · ${money(product.price)}`; $('product').append(option);
}
$('add-product').addEventListener('click', () => { addProduct($('product').value); $(`qty-${$('product').value}`).focus(); });
const params = new URLSearchParams(location.search);
if (params.get('mode') === 'custom') form.elements.mode.value = 'custom';
if (productById(params.get('add'))) {
  addProduct(params.get('add'));
  params.delete('add');
  // Reloading/back does not add the same product again.
  history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
}
persist(); renderCart(); form.hidden = false;

function clearReview() { $('review-panel').hidden = true; completed = false; }
function showMode() {
  const custom = form.elements.mode.value === 'custom';
  $('products-panel').hidden = custom; $('custom-panel').hidden = !custom;
  $('selection-title').textContent = custom ? 'Ваша идея' : 'Ваша подборка';
  $('comment').required = custom;
  $('comment-label').firstChild.textContent = custom ? 'Расскажите об идее *' : 'Комментарий';
  clearReview();
}
form.querySelectorAll('[name=mode]').forEach(radio => radio.addEventListener('change', showMode));
form.addEventListener('input', clearReview);
showMode();

async function checkChannel() {
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const data = response.ok ? await response.json() : null;
    available = data?.service === 'laguna-inquiry-v1' && data.enabled === true;
    $('channel').textContent = available ? 'После проверки вы сможете отправить заявку в LAGUNA ATELIER. Оплата на сайте не требуется.' : 'Онлайн-приём заявок пока не подключён. Здесь можно подготовить и скачать заявку; в ателье она не отправится.';
  } catch {
    available = false;
    $('channel').textContent = 'Онлайн-отправка сейчас недоступна. Можно подготовить и скачать заявку. Отправка не подтверждена.';
  }
}
checkChannel();

function showErrors(errors) {
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  $('errors').hidden = !Object.keys(errors).length;
  if ($('errors').hidden) return;
  for (const [field, message] of Object.entries(errors)) {
    if ($(`error-${field}`)) $(`error-${field}`).textContent = message;
    if ($(field)) $(field).setAttribute('aria-invalid', 'true');
    if (field === 'contact') { $('email').setAttribute('aria-invalid', 'true'); $('phone').setAttribute('aria-invalid', 'true'); }
    if (field === 'items') $('cart').querySelectorAll('input').forEach(input => input.setAttribute('aria-invalid', 'true'));
  }
  $('errors').textContent = 'Проверьте заявку. ' + Object.values(errors).join(' ');
  $('errors').focus();
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const raw = { mode: form.elements.mode.value, items: cart, quantity: $('quantity').valueAsNumber, name: $('name').value, email: $('email').value, phone: $('phone').value, comment: $('comment').value, consent: $('consent').checked };
  const { errors, value } = validateInquiry(raw);
  showErrors(errors);
  if (Object.keys(errors).length) return;
  prepared = value;
  const fingerprint = JSON.stringify(value);
  // Retries of an unchanged request reuse its key, including after a timeout.
  if (fingerprint !== preparedFingerprint) { requestId = newRequestId(); preparedFingerprint = fingerprint; }
  $('summary').textContent = inquiryText(prepared);
  $('result').textContent = available ? 'Заявка проверена, но ещё не отправлена. Проверьте сведения и нажмите «Отправить заявку».' : 'Заявка подготовлена, но не отправлена: онлайн-приём сейчас недоступен. Скачивание сохраняет файл только на вашем устройстве.';
  $('send').hidden = !available; $('send').disabled = false; $('edit').textContent = 'Изменить';
  $('review-panel').hidden = false; $('review-panel').focus();
});
$('edit').addEventListener('click', () => {
  clearReview(); $('name').focus();
});
$('download').addEventListener('click', () => {
  if (!prepared) return;
  const status = completed ? 'Приём заявки подтверждён сервером.' : 'Заявка не отправлена. Этот файл — локальная копия.';
  const url = URL.createObjectURL(new Blob([`\uFEFF${status}\nНомер: ${requestId}\n\n${inquiryText(prepared)}`], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `LAGUNA-заявка-${requestId}.txt`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function lockForm(locked) {
  form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = locked; });
  $('send').disabled = locked; $('edit').disabled = locked;
}
$('send').addEventListener('click', async () => {
  if (!prepared || pending || completed || !available) return;
  pending = true; lockForm(true); $('review-panel').setAttribute('aria-busy', 'true');
  $('result').textContent = 'Отправляем заявку. Дождитесь подтверждения.';
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ ...prepared, requestId }), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== 'accepted' || data.requestId !== requestId || typeof data.receipt !== 'string' || !data.receipt) {
      if (response.status === 503) throw new Error('Приём заявок сейчас не подключён. Заявка не отправлена; её можно скачать.');
      if (response.status === 400 || response.status === 413 || response.status === 403 || response.status === 415) throw new Error('Сервер отклонил заявку. Проверьте данные или скачайте её; отправка не подтверждена.');
      if (response.status === 429) throw new Error('Слишком много попыток. Подождите минуту и повторите отправку этой заявки.');
      throw new Error('Не удалось подтвердить приём. Заявка могла дойти. Повторная попытка с тем же номером защищает от дубля; можно также скачать копию.');
    }
    completed = true;
    $('result').textContent = `Заявка принята. Номер подтверждения: ${data.receipt}. Ателье свяжется с вами по указанным контактам. Наличие, стоимость и сроки ещё предстоит согласовать.`;
    $('send').hidden = true; $('edit').textContent = 'Подготовить новую заявку';
    preparedFingerprint = null;
    // Keep the accepted ID in the downloadable receipt and preserve the cart for review.
    requestId = data.requestId;
  } catch (error) {
    $('result').textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Связь прервалась; приём не подтверждён. Не закрывайте страницу: повторная отправка использует тот же номер заявки. Можно скачать копию.' : error.message;
  } finally {
    pending = false; lockForm(false); $('review-panel').removeAttribute('aria-busy');
  }
});
window.addEventListener('beforeunload', event => { if (pending) { event.preventDefault(); event.returnValue = ''; } });
