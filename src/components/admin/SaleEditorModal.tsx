import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import type { StoreProduct } from '../../data/storeData';
import {
  clampStr,
  getTodayIsoDate,
  sanitizeId,
  type SaleChannel,
  type SalePaymentMethod,
  type SaleRecord,
  type SaleStatus,
} from '../../data/adminCatalog';

export type SaleDraft = Omit<SaleRecord, 'createdBy' | 'createdAt' | 'updatedAt'>;

interface SaleEditorModalProps {
  isOpen: boolean;
  initialSale: SaleDraft | null;
  catalogProducts: StoreProduct[];
  onClose: () => void;
  onSave: (draft: SaleDraft, isEdit: boolean) => Promise<void>;
}

function buildDefaultSale(catalogProducts: StoreProduct[]): SaleDraft {
  const first = catalogProducts[0];
  const price = first?.variants[0]?.priceRub ?? 2990;
  return {
    id: `CGS-${Math.floor(100000 + Math.random() * 899999)}`,
    orderDate: getTodayIsoDate(),
    productId: first?.id ?? 'custom',
    productTitle: first?.title ?? '',
    platformGroup: first?.platformGroup ?? 'xbox',
    categoryType: first?.categoryType ?? 'games',
    quantity: 1,
    unitPriceRub: price,
    totalRub: price,
    status: 'paid',
    channel: 'telegram',
    paymentMethod: 'sbp',
    customerName: '',
    customerContact: '',
    note: '',
  };
}

export function SaleEditorModal({
  isOpen,
  initialSale,
  catalogProducts,
  onClose,
  onSave,
}: SaleEditorModalProps) {
  const [form, setForm] = useState<SaleDraft>(() => buildDefaultSale(catalogProducts));
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(initialSale ? { ...initialSale } : buildDefaultSale(catalogProducts));
    setProductSearch('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialSale]);

  const matchingProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return catalogProducts.slice(0, 40);
    const out: StoreProduct[] = [];
    for (const p of catalogProducts) {
      if (
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.platformLabel.toLowerCase().includes(q)
      ) {
        out.push(p);
        if (out.length >= 40) break;
      }
    }
    return out;
  }, [catalogProducts, productSearch]);

  if (!isOpen) return null;

  const isEdit = Boolean(initialSale);

  const handleSelectProduct = (productId: string) => {
    const prod = catalogProducts.find((p) => p.id === productId);
    if (!prod) return;
    const unitPrice = prod.variants[0].priceRub;
    setForm((prev) => ({
      ...prev,
      productId: prod.id,
      productTitle: clampStr(prod.title, 160),
      platformGroup: prod.platformGroup,
      categoryType: prod.categoryType,
      unitPriceRub: unitPrice,
      totalRub: unitPrice * Math.max(1, prev.quantity),
    }));
  };

  const handleQtyChange = (qty: number) => {
    const safeQty = Math.max(1, Math.min(100, Math.round(qty || 1)));
    setForm((prev) => ({
      ...prev,
      quantity: safeQty,
      totalRub: safeQty * Math.max(1, Math.round(prev.unitPriceRub || 0)),
    }));
  };

  const handleUnitPriceChange = (price: number) => {
    const safePrice = Math.max(1, Math.min(500000, Math.round(price || 0)));
    setForm((prev) => ({
      ...prev,
      unitPriceRub: safePrice,
      totalRub: safePrice * Math.max(1, prev.quantity),
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (form.productTitle.trim().length < 2) {
      setError('Укажите название проданного товара.');
      return;
    }
    if (form.customerName.trim().length < 1) {
      setError('Укажите имя покупателя.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.orderDate)) {
      setError('Некорректный формат даты заказа.');
      return;
    }

    const quantity = Math.max(1, Math.min(100, Math.round(form.quantity)));
    const unitPriceRub = Math.max(1, Math.min(500000, Math.round(form.unitPriceRub)));
    const totalRub = Math.max(1, Math.min(5000000, Math.round(quantity * unitPriceRub)));

    const payload: SaleDraft = {
      id: isEdit ? form.id : sanitizeId(form.id, 'CGS'),
      orderDate: form.orderDate,
      productId: clampStr(form.productId || 'custom', 80),
      productTitle: clampStr(form.productTitle, 160),
      platformGroup: form.platformGroup,
      categoryType: form.categoryType,
      quantity,
      unitPriceRub,
      totalRub,
      status: form.status,
      channel: form.channel,
      paymentMethod: form.paymentMethod,
      customerName: clampStr(form.customerName, 120),
      customerContact: clampStr(form.customerContact, 160),
      note: clampStr(form.note, 400),
    };

    setSaving(true);
    try {
      await onSave(payload, isEdit);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить продажу.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl border border-neutral-200 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#111111] text-white px-6 py-4 flex items-center justify-between border-b border-neutral-800">
          <div>
            <h2 id="sale-editor-title" className="text-lg font-bold italic">
              {isEdit ? `Редактирование заказа ${form.id}` : 'Добавить запись о продаже'}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Учёт продаж с сайта, Telegram, Avito и Wildberries
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Закрыть окно продажи"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-4">
          {/* Quick Product Picker */}
          <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-2.5">
            <label className="text-xs font-semibold text-neutral-700 block">
              Выбрать товар из каталога (автоподстановка цены)
            </label>
            <input
              type="search"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Фильтр товаров по названию или SKU..."
              className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-[#52c44c]"
            />
            <select
              value={catalogProducts.some((p) => p.id === form.productId) ? form.productId : ''}
              onChange={(e) => handleSelectProduct(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-neutral-300 rounded-md focus:outline-none focus:border-[#52c44c]"
            >
              <option value="">— Выберите товар или введите вручную ниже —</option>
              {matchingProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.platformLabel}) — {p.variants[0].priceRub.toLocaleString('ru-RU')} ₽
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
            <div className="sm:col-span-8 space-y-1">
              <label htmlFor="sale-product-title" className="text-xs font-semibold text-neutral-700 block">
                Наименование товара *
              </label>
              <input
                id="sale-product-title"
                type="text"
                required
                maxLength={160}
                value={form.productTitle}
                onChange={(e) => setForm((prev) => ({ ...prev, productTitle: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              />
            </div>
            <div className="sm:col-span-4 space-y-1">
              <label htmlFor="sale-date" className="text-xs font-semibold text-neutral-700 block">
                Дата продажи *
              </label>
              <input
                id="sale-date"
                type="date"
                required
                value={form.orderDate}
                onChange={(e) => setForm((prev) => ({ ...prev, orderDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            <div className="space-y-1">
              <label htmlFor="sale-qty" className="text-xs font-semibold text-neutral-700 block">
                Кол-во (шт.)
              </label>
              <input
                id="sale-qty"
                type="number"
                min={1}
                max={100}
                required
                value={form.quantity}
                onChange={(e) => handleQtyChange(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c] tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="sale-price" className="text-xs font-semibold text-neutral-700 block">
                Цена за шт. (₽)
              </label>
              <input
                id="sale-price"
                type="number"
                min={1}
                max={500000}
                required
                value={form.unitPriceRub}
                onChange={(e) => handleUnitPriceChange(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c] tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold text-neutral-700 block">Итого (₽)</span>
              <div className="px-3 py-2 text-sm font-mono font-bold text-neutral-900 bg-neutral-100 border border-neutral-200 rounded-lg tabular-nums">
                {form.totalRub.toLocaleString('ru-RU')} ₽
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="space-y-1">
              <label htmlFor="sale-status" className="text-xs font-semibold text-neutral-700 block">
                Статус
              </label>
              <select
                id="sale-status"
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, status: e.target.value as SaleStatus }))
                }
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              >
                <option value="paid">Оплачен</option>
                <option value="pending">В обработке</option>
                <option value="refunded">Возврат</option>
                <option value="cancelled">Отменён</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="sale-channel" className="text-xs font-semibold text-neutral-700 block">
                Канал
              </label>
              <select
                id="sale-channel"
                value={form.channel}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, channel: e.target.value as SaleChannel }))
                }
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              >
                <option value="site">Сайт</option>
                <option value="telegram">Telegram</option>
                <option value="avito">Avito</option>
                <option value="wildberries">Wildberries</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="sale-method" className="text-xs font-semibold text-neutral-700 block">
                Оплата
              </label>
              <select
                id="sale-method"
                value={form.paymentMethod}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    paymentMethod: e.target.value as SalePaymentMethod,
                  }))
                }
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              >
                <option value="sbp">СБП</option>
                <option value="card">Карта РФ</option>
                <option value="transfer">Перевод</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <label htmlFor="sale-customer" className="text-xs font-semibold text-neutral-700 block">
                Покупатель *
              </label>
              <input
                id="sale-customer"
                type="text"
                required
                maxLength={120}
                value={form.customerName}
                onChange={(e) => setForm((prev) => ({ ...prev, customerName: e.target.value }))}
                placeholder="Имя клиента"
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="sale-contact" className="text-xs font-semibold text-neutral-700 block">
                Контакт (Telegram / Email)
              </label>
              <input
                id="sale-contact"
                type="text"
                maxLength={160}
                value={form.customerContact}
                onChange={(e) => setForm((prev) => ({ ...prev, customerContact: e.target.value }))}
                placeholder="@username или email"
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="sale-note" className="text-xs font-semibold text-neutral-700 block">
              Комментарий к заказу
            </label>
            <input
              id="sale-note"
              type="text"
              maxLength={400}
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="Например: покупка на турецкий аккаунт за 10 мин"
              className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="pt-3 border-t border-neutral-200 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить продажу'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
