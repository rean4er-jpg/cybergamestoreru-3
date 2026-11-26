import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Receipt,
  RefreshCw,
  ShoppingBag,
  X,
  XCircle,
} from 'lucide-react';
import type { OrderReceipt } from './PaymentModal';

interface MyOrdersModalProps {
  isOpen: boolean;
  orders: OrderReceipt[];
  onClose: () => void;
  onSelectOrder: (order: OrderReceipt) => void;
  onOrdersSynced: (updatedOrders: OrderReceipt[]) => void;
}

function formatOrderDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function MyOrdersModal({
  isOpen,
  orders,
  onClose,
  onSelectOrder,
  onOrdersSynced,
}: MyOrdersModalProps) {
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Sync status of any pending orders when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    const pendingWithTokens = orders.filter((o) => o.status === 'pending' && o.accessToken);
    if (pendingWithTokens.length === 0) return;

    let cancelled = false;
    void Promise.all(
      pendingWithTokens.map(async (ord): Promise<OrderReceipt | null> => {
        try {
          const res = await fetch(
            `/api/orders/${encodeURIComponent(ord.id)}?token=${encodeURIComponent(ord.accessToken!)}`
          );
          if (!res.ok) return null;
          const fresh = (await res.json()) as OrderReceipt;
          return { ...fresh, accessToken: ord.accessToken };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const updates = results.filter((r): r is OrderReceipt => Boolean(r));
      if (updates.length > 0) {
        onOrdersSynced(updates);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRefreshSingle = async (order: OrderReceipt) => {
    if (!order.accessToken || refreshingId) return;
    setRefreshingId(order.id);
    try {
      const res = await fetch(
        `/api/orders/${encodeURIComponent(order.id)}?token=${encodeURIComponent(order.accessToken)}`
      );
      if (res.ok) {
        const fresh = (await res.json()) as OrderReceipt;
        onOrdersSynced([{ ...fresh, accessToken: order.accessToken }]);
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Мои покупки и заказы"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl border border-neutral-200 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black text-white px-6 py-4 flex items-center justify-between border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Receipt className="w-5 h-5 text-[#52c44c]" />
            <div>
              <h2 className="text-base font-bold italic">Мои покупки</h2>
              <div className="text-[11px] text-neutral-400">
                История оформленных и оплаченных заказов
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть мои покупки"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-neutral-300 hover:text-white hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {orders.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <ShoppingBag className="w-10 h-10 text-neutral-300 mx-auto" strokeWidth={1.5} />
              <div className="text-base font-semibold text-neutral-900">
                Покупок пока нет
              </div>
              <p className="text-sm text-neutral-500 max-w-sm mx-auto leading-relaxed">
                Все заказы, оформленные в этом браузере, автоматически сохраняются здесь — вы
                сможете в любой момент открыть чек или написать менеджеру по заказу.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {orders.map((order) => {
                const isPaid = order.status === 'paid';
                const isCancelled = order.status === 'cancelled';
                const telegramText = encodeURIComponent(
                  `Здравствуйте! По заказу ${order.id} (${order.amountRub} ₽).\nТовары: ${order.items
                    .map((i) => `${i.title} (${i.quantity} шт.)`)
                    .join(', ')}.\nАккаунт: ${order.accountStatus}`
                );

                return (
                  <div
                    key={order.id}
                    className="border border-neutral-200 rounded-xl p-4 bg-neutral-50 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-neutral-900">
                            #{order.id}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              isPaid
                                ? 'text-emerald-700'
                                : isCancelled
                                  ? 'text-neutral-500'
                                  : 'text-amber-700'
                            }`}
                          >
                            {isPaid ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : isCancelled ? (
                              <XCircle className="w-3.5 h-3.5" />
                            ) : (
                              <Clock className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {isPaid
                                ? 'Оплачен'
                                : isCancelled
                                  ? 'Отменён'
                                  : 'Ожидает оплаты'}
                            </span>
                          </span>
                          {order.provider === 'sandbox' && (
                            <span className="text-[11px] font-medium text-neutral-500">
                              · Тестовый
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {formatOrderDateTime(order.paidAt || order.createdAt)} ·{' '}
                          {order.paymentMethod === 'sbp' ? 'СБП' : 'Карта РФ'}
                        </div>
                      </div>

                      <div className="font-mono text-base font-bold text-neutral-900 tabular-nums">
                        {order.amountRub.toLocaleString('ru-RU')} ₽
                      </div>
                    </div>

                    <div className="bg-white border border-neutral-200 rounded-lg divide-y divide-neutral-100 px-3">
                      {order.items.map((item) => (
                        <div
                          key={`${order.id}-${item.productId}-${item.variantId}`}
                          className="py-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-neutral-900 truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] text-neutral-500 truncate">
                              {item.variantLabel} × {item.quantity}
                            </div>
                          </div>
                          <span className="font-mono font-semibold text-neutral-800 shrink-0 tabular-nums">
                            {(item.unitPriceRub * item.quantity).toLocaleString('ru-RU')} ₽
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectOrder(order);
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-black hover:bg-neutral-800 rounded-lg transition-colors cursor-pointer"
                      >
                        {isPaid ? 'Открыть чек' : isCancelled ? 'Детали заказа' : 'Перейти к оплате'}
                      </button>

                      {isPaid && (
                        <a
                          href={`https://t.me/GyberGameStore?text=${telegramText}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors"
                        >
                          <span>Получить в Telegram</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {!isPaid && !isCancelled && order.accessToken && (
                        <button
                          type="button"
                          disabled={refreshingId === order.id}
                          onClick={() => void handleRefreshSingle(order)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:border-neutral-400 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              refreshingId === order.id ? 'animate-spin' : ''
                            }`}
                          />
                          <span>Проверить статус</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 border-t border-neutral-200 text-xs text-neutral-500 leading-relaxed">
            Заказы сохраняются в этом браузере. Если вы оформляли покупку с другого устройства,
            напишите менеджеру в{' '}
            <a
              href="https://t.me/GyberGameStore"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#52c44c] font-semibold hover:underline"
            >
              Telegram @GyberGameStore
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
}
