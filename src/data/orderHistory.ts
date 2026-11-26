import type { OrderReceipt } from '../components/PaymentModal';

const STORAGE_KEY = 'cgs_my_orders_v1';
const MAX_SAVED_ORDERS = 30;

function isValidOrderReceipt(value: unknown): value is OrderReceipt {
  if (!value || typeof value !== 'object') return false;
  const o = value as Partial<OrderReceipt>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    (o.status === 'pending' || o.status === 'paid' || o.status === 'cancelled') &&
    typeof o.amountRub === 'number' &&
    Array.isArray(o.items)
  );
}

export function loadSavedOrders(): OrderReceipt[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidOrderReceipt)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, MAX_SAVED_ORDERS);
  } catch {
    return [];
  }
}

export function persistSavedOrders(orders: OrderReceipt[]): OrderReceipt[] {
  const sorted = [...orders]
    .filter(isValidOrderReceipt)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, MAX_SAVED_ORDERS);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    } catch {
      // Ignore storage quota errors
    }
  }
  return sorted;
}

export function upsertSavedOrder(
  current: OrderReceipt[],
  nextOrder: OrderReceipt
): OrderReceipt[] {
  const existing = current.find((item) => item.id === nextOrder.id);
  const merged: OrderReceipt = {
    ...existing,
    ...nextOrder,
    accessToken: nextOrder.accessToken || existing?.accessToken,
  };
  const without = current.filter((item) => item.id !== nextOrder.id);
  return persistSavedOrders([merged, ...without]);
}
