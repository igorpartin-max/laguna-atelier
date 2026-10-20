// One catalogue for the browser and server. Prices are estimates, not a payment offer.
export const PRODUCTS = Object.freeze([
  { id: 'fiamma-01', name: 'FIAMMA 01', price: 4900, description: 'Цветочная свеча ручной формы' },
  { id: 'luce-01', name: 'LUCE 01', price: 14900, description: 'Свеча в стеклянной чаше' },
  { id: 'gift-box-01', name: 'GIFT BOX 01', price: 900, description: 'Подарочная упаковка' },
]);
export const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
export const productById = id => PRODUCTS.find(product => product.id === id);

export function newRequestId(random = globalThis.crypto) {
  if (typeof random.randomUUID === 'function') return random.randomUUID();
  // getRandomValues also supports local HTTP previews where randomUUID is unavailable.
  const bytes = random.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function cleanCart(value) {
  if (!Array.isArray(value)) return [];
  const quantities = new Map();
  for (const row of value) {
    if (row && productById(row.id) && Number.isInteger(row.quantity) && row.quantity >= 1 && row.quantity <= 99) {
      quantities.set(row.id, Math.min(99, (quantities.get(row.id) || 0) + row.quantity));
    }
  }
  return [...quantities].map(([id, quantity]) => ({ id, quantity }));
}

const string = value => typeof value === 'string' ? value.trim() : '';
export function validateInquiry(input) {
  const data = input && typeof input === 'object' ? input : {};
  const errors = {};
  const mode = data.mode;
  if (!['products', 'custom'].includes(mode)) errors.mode = 'Выберите тип заявки.';
  const name = string(data.name), email = string(data.email), phone = string(data.phone), comment = string(data.comment);
  if (name.length < 2 || name.length > 100) errors.name = 'Укажите имя: от 2 до 100 символов.';
  if (!email && !phone) errors.contact = 'Укажите email или телефон для ответа.';
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = 'Проверьте адрес email.';
  if (phone && (!/^[+\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15 || phone.length > 40)) errors.phone = 'Укажите телефон: от 7 до 15 цифр.';
  if (comment.length > 2000 || (mode === 'custom' && comment.length < 10)) errors.comment = mode === 'custom' ? 'Опишите идею: от 10 до 2000 символов.' : 'Комментарий — не более 2000 символов.';
  if (data.consent !== true) errors.consent = 'Подтвердите передачу контактов для ответа на заявку.';
  let items = [];
  let quantity = null;
  if (mode === 'products') {
    const raw = data.items;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > PRODUCTS.length || raw.some(row => !row || !productById(row.id) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99) || new Set(raw?.map(row => row?.id)).size !== raw?.length) {
      errors.items = 'Выберите товары и целое количество от 1 до 99 для каждого.';
    } else {
      items = raw.map(row => ({ id: row.id, name: productById(row.id).name, quantity: row.quantity, unitPrice: productById(row.id).price }));
    }
  } else if (mode === 'custom') {
    quantity = data.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) errors.quantity = 'Укажите целое количество от 1 до 99.';
  }
  return { errors, value: { mode, name, email, phone, comment, consent: data.consent === true, items, quantity, currency: 'RUB', estimatedTotal: mode === 'products' ? items.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0) : null } };
}

export function inquiryText(data) {
  return [
    'LAGUNA ATELIER · Заявка',
    data.mode === 'custom' ? 'Индивидуальный заказ' : 'Товары из коллекции',
    ...(data.mode === 'products' ? data.items.map(row => `${row.name} · ${row.quantity} шт. × ${money(row.unitPrice)}`) : [`Количество: ${data.quantity}`]),
    data.mode === 'products' ? `Ориентировочная сумма: ${money(data.estimatedTotal)}. Без доставки.` : 'Стоимость и сроки согласуются отдельно.',
    `Имя: ${data.name}`, `Email: ${data.email || '—'}`, `Телефон: ${data.phone || '—'}`,
    `Комментарий: ${data.comment || '—'}`,
    'Контакты предоставлены для ответа на эту заявку.',
    'Заявка не является оплатой или подтверждённым заказом.',
  ].join('\n');
}
