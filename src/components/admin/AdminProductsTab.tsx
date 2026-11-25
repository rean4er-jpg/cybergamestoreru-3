import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileJson,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { StoreProduct } from '../../data/storeData';
import {
  BUILTIN_PRODUCT_IDS,
  formatRub,
  type FirestoreProductDoc,
} from '../../data/adminCatalog';
import { ResilientImage } from '../ResilientImage';

type ProductFilterTab = 'all' | 'custom' | 'xbox' | 'ps' | 'subscriptions' | 'hidden';

interface AdminProductsTabProps {
  allProducts: StoreProduct[];
  overrideMap: Map<string, FirestoreProductDoc>;
  onAddProduct: () => void;
  onImportJson: () => void;
  onEditProduct: (product: StoreProduct) => void;
  onQuickPriceSave: (product: StoreProduct, nextPrice: number, nextOldPrice: number) => Promise<void>;
  onToggleHidden: (product: StoreProduct, nextHidden: boolean) => Promise<void>;
  onDeleteCustomProduct: (productId: string) => Promise<void>;
}

const PAGE_SIZE = 20;

export function AdminProductsTab({
  allProducts,
  overrideMap,
  onAddProduct,
  onImportJson,
  onEditProduct,
  onQuickPriceSave,
  onToggleHidden,
  onDeleteCustomProduct,
}: AdminProductsTabProps) {
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<ProductFilterTab>('all');
  const [page, setPage] = useState(1);

  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [draftOldPrice, setDraftOldPrice] = useState('');
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let custom = 0;
    let hidden = 0;
    let xbox = 0;
    let ps = 0;
    let subs = 0;
    for (const p of allProducts) {
      const ov = overrideMap.get(p.id);
      const isHidden = ov?.isHidden ?? false;
      if (isHidden) hidden++;
      if (!BUILTIN_PRODUCT_IDS.has(p.id) || ov) custom++;
      if (p.categoryType === 'subscriptions') subs++;
      else if (p.platformGroup === 'ps') ps++;
      else xbox++;
    }
    return { all: allProducts.length, custom, xbox, ps, subs, hidden };
  }, [allProducts, overrideMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allProducts.filter((p) => {
      const ov = overrideMap.get(p.id);
      const isHidden = ov?.isHidden ?? false;
      const isCustomOrEdited = !BUILTIN_PRODUCT_IDS.has(p.id) || Boolean(ov);

      if (filterTab === 'custom' && !isCustomOrEdited) return false;
      if (filterTab === 'hidden' && !isHidden) return false;
      if (filterTab === 'xbox' && !(p.platformGroup === 'xbox' && p.categoryType === 'games'))
        return false;
      if (filterTab === 'ps' && p.platformGroup !== 'ps') return false;
      if (filterTab === 'subscriptions' && p.categoryType !== 'subscriptions') return false;

      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.genre.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.platformLabel.toLowerCase().includes(q)
      );
    });
  }, [allProducts, overrideMap, filterTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const startQuickPrice = (product: StoreProduct) => {
    setEditingPriceId(product.id);
    setDraftPrice(String(product.variants[0].priceRub));
    setDraftOldPrice(product.variants[0].oldPriceRub > 0 ? String(product.variants[0].oldPriceRub) : '');
  };

  const commitQuickPrice = async (product: StoreProduct) => {
    const price = Math.round(Number(draftPrice));
    const oldPrice = Math.round(Number(draftOldPrice) || 0);
    if (!Number.isFinite(price) || price < 1 || price > 500000) return;

    setSavingPriceId(product.id);
    try {
      await onQuickPriceSave(product, price, oldPrice > price ? oldPrice : 0);
      setEditingPriceId(null);
    } finally {
      setSavingPriceId(null);
    }
  };

  const filterButtons: Array<{ id: ProductFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'Все', count: counts.all },
    { id: 'custom', label: 'Добавленные и изменённые', count: counts.custom },
    { id: 'xbox', label: 'Xbox', count: counts.xbox },
    { id: 'ps', label: 'PlayStation', count: counts.ps },
    { id: 'subscriptions', label: 'Подписки', count: counts.subs },
    { id: 'hidden', label: 'Скрытые', count: counts.hidden },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Поиск по названию, SKU, жанру или платформе..."
            className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-[#52c44c]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onImportJson}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-neutral-800 bg-white border border-neutral-200 hover:border-[#52c44c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileJson className="w-4 h-4 text-[#52c44c]" />
            <span>Импорт JSON</span>
          </button>

          <button
            type="button"
            onClick={onAddProduct}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить товар</span>
          </button>
        </div>
      </div>

      {/* Segmented Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-200/70 rounded-lg w-fit">
        {filterButtons.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setFilterTab(tab.id);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filterTab === tab.id
                ? 'bg-white text-neutral-900 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <span>{tab.label}</span>
            <span className="ml-1.5 font-mono text-[11px] text-neutral-400 tabular-nums">
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Product Table */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-neutral-900">
              По выбранным параметрам товары не найдены
            </p>
            <p className="text-xs text-neutral-500">
              Сбросьте поиск или добавьте новую позицию с обложкой и ценой.
            </p>
            <button
              type="button"
              onClick={onAddProduct}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg cursor-pointer"
            >
              Добавить товар
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                    <th className="py-3 px-4">Товар</th>
                    <th className="py-3 px-3">Платформа и регион</th>
                    <th className="py-3 px-3 text-right">Цена (₽)</th>
                    <th className="py-3 px-3">Статус</th>
                    <th className="py-3 px-4 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-xs">
                  {paginated.map((product) => {
                    const ov = overrideMap.get(product.id);
                    const isCustom = !BUILTIN_PRODUCT_IDS.has(product.id);
                    const isEditedBuiltin = BUILTIN_PRODUCT_IDS.has(product.id) && Boolean(ov);
                    const isHidden = ov?.isHidden ?? false;
                    const variant = product.variants[0];
                    const isEditingPrice = editingPriceId === product.id;

                    return (
                      <tr
                        key={product.id}
                        className={`hover:bg-neutral-50 transition-colors ${
                          isHidden ? 'opacity-60 bg-neutral-50/70' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3 min-w-[260px]">
                            <div className="w-14 h-10 rounded-md overflow-hidden bg-neutral-900 border border-neutral-200 shrink-0">
                              <ResilientImage
                                src={product.image}
                                alt={product.title}
                                fallbackTone={product.fallbackTone}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => onEditProduct(product)}
                                className="font-semibold text-neutral-900 hover:text-[#52c44c] text-left line-clamp-1 cursor-pointer"
                              >
                                {product.title}
                              </button>
                              <div className="text-[11px] text-neutral-500 flex items-center gap-1.5 mt-0.5">
                                <span className="font-mono tabular-nums">#{product.sku}</span>
                                <span aria-hidden="true">·</span>
                                <span>{product.genre}</span>
                                {isCustom && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-emerald-700 font-semibold">Свой товар</span>
                                  </>
                                )}
                                {isEditedBuiltin && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-700 font-semibold">Изменён</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-medium text-neutral-800">{product.platformLabel}</div>
                          <div className="text-[11px] text-neutral-500">
                            {product.regionLabel} · {product.editionLabel}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {isEditingPrice ? (
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min={1}
                                max={500000}
                                value={draftPrice}
                                onChange={(e) => setDraftPrice(e.target.value)}
                                aria-label="Новая цена"
                                className="w-24 px-2 py-1 text-xs font-mono text-right border border-[#52c44c] rounded bg-white focus:outline-none tabular-nums"
                              />
                              <input
                                type="number"
                                min={0}
                                max={500000}
                                value={draftOldPrice}
                                onChange={(e) => setDraftOldPrice(e.target.value)}
                                placeholder="Старая"
                                aria-label="Старая цена"
                                className="w-20 px-2 py-1 text-xs font-mono text-right border border-neutral-300 rounded bg-white focus:outline-none tabular-nums"
                              />
                              <button
                                type="button"
                                disabled={savingPriceId === product.id}
                                onClick={() => void commitQuickPrice(product)}
                                aria-label="Сохранить цену"
                                className="p-1.5 text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPriceId(null)}
                                aria-label="Отменить изменение цены"
                                className="p-1.5 text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startQuickPrice(product)}
                              title="Нажмите для быстрого изменения цены"
                              className="text-right group inline-block cursor-pointer"
                            >
                              {variant.oldPriceRub > variant.priceRub && (
                                <span className="block font-mono text-[11px] text-neutral-400 line-through tabular-nums">
                                  {formatRub(variant.oldPriceRub)}
                                </span>
                              )}
                              <span className="font-mono text-sm font-bold text-neutral-900 group-hover:text-[#52c44c] tabular-nums">
                                {formatRub(variant.priceRub)}
                              </span>
                            </button>
                          )}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {isHidden ? (
                            <span className="text-neutral-500 font-medium">Скрыт с витрины</span>
                          ) : variant.inStock ? (
                            <span className="text-emerald-700 font-semibold">На витрине</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">Нет в наличии</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {confirmDeleteId === product.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  void onDeleteCustomProduct(product.id);
                                }}
                                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              >
                                Удалить
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 text-[11px] font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded cursor-pointer"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onEditProduct(product)}
                                title="Редактировать фото, описание и цену"
                                className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void onToggleHidden(product, !isHidden)}
                                title={isHidden ? 'Показать на витрине' : 'Скрыть с витрины'}
                                className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md cursor-pointer"
                              >
                                {isHidden ? (
                                  <Eye className="w-4 h-4 text-emerald-700" />
                                ) : (
                                  <EyeOff className="w-4 h-4" />
                                )}
                              </button>
                              {isCustom && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(product.id)}
                                  title="Удалить добавленный товар"
                                  className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-500">
                <span className="tabular-nums">
                  Показано {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, filtered.length)} из {filtered.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:border-[#52c44c] disabled:opacity-40 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Назад</span>
                  </button>
                  <span className="px-2 font-mono tabular-nums">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-neutral-200 rounded-md text-neutral-700 hover:border-[#52c44c] disabled:opacity-40 cursor-pointer"
                  >
                    <span>Вперёд</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
