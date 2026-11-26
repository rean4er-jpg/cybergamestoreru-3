import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Globe, ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react';
import {
  clampStr,
  compressImageFileToDataUrl,
  PRESET_ARTWORKS,
  sanitizeId,
  type FirestoreProductDoc,
} from '../../data/adminCatalog';
import { ResilientImage } from '../ResilientImage';

export type ProductDraft = Omit<FirestoreProductDoc, 'createdBy' | 'createdAt' | 'updatedAt'>;

interface ProductEditorModalProps {
  isOpen: boolean;
  initialDraft: ProductDraft | null;
  isEditingBuiltin: boolean;
  onClose: () => void;
  onSave: (draft: ProductDraft) => Promise<void>;
}

const PLATFORM_OPTIONS: Array<{
  label: string;
  group: 'ps' | 'xbox';
}> = [
  { label: 'PlayStation 5', group: 'ps' },
  { label: 'PS4 / PS5', group: 'ps' },
  { label: 'PlayStation 4', group: 'ps' },
  { label: 'Xbox Series X|S', group: 'xbox' },
  { label: 'Xbox One / Series X|S', group: 'xbox' },
  { label: 'Xbox Series X|S / ПК', group: 'xbox' },
  { label: 'Xbox One / Series X|S / ПК', group: 'xbox' },
];

function createEmptyDraft(): ProductDraft {
  const randomSku = String(Math.floor(2000000000 + Math.random() * 799999999));
  return {
    id: `custom-${Date.now().toString(36)}`,
    sku: randomSku,
    title: '',
    platformGroup: 'ps',
    platformLabel: 'PlayStation 5',
    categoryType: 'games',
    deliveryType: 'account',
    regionLabel: 'Турция',
    genre: 'Экшен · Приключения',
    brand: 'PlayStation',
    editionLabel: 'Standard Edition',
    language: 'Русские субтитры и интерфейс',
    hasRussian: true,
    isPreorder: false,
    inStock: true,
    isHidden: false,
    priceRub: 3490,
    oldPriceRub: 0,
    image: '',
    shortDescription: '',
    fullDescription: '',
  };
}

export function ProductEditorModal({
  isOpen,
  initialDraft,
  isEditingBuiltin,
  onClose,
  onSave,
}: ProductEditorModalProps) {
  const [form, setForm] = useState<ProductDraft>(createEmptyDraft);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadMeta, setUploadMeta] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(initialDraft ? { ...initialDraft } : createEmptyDraft());
    setUploadMeta(null);
    setImageError(null);
    setSubmitError(null);
  }, [isOpen, initialDraft]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const isEditMode = Boolean(initialDraft);
  const priceNum = Number(form.priceRub) || 0;
  const oldPriceNum = Number(form.oldPriceRub) || 0;
  const computedDiscount =
    oldPriceNum > priceNum && priceNum > 0
      ? Math.round((1 - priceNum / oldPriceNum) * 100)
      : 0;

  const handleFileProcess = async (file: File) => {
    setImageError(null);
    setUploadingImage(true);
    try {
      const result = await compressImageFileToDataUrl(file);
      setForm((prev) => ({ ...prev, image: result.dataUrl }));
      setUploadMeta(`${result.width}×${result.height} · ${result.sizeKb} КБ`);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Ошибка обработки изображения.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileProcess(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFileProcess(file);
    }
  };

  const handlePlatformLabelChange = (nextLabel: string) => {
    const found = PLATFORM_OPTIONS.find((opt) => opt.label === nextLabel);
    const nextGroup = found?.group ?? 'ps';
    setForm((prev) => ({
      ...prev,
      platformLabel: nextLabel,
      platformGroup: nextGroup,
      brand:
        prev.brand === 'PlayStation' || prev.brand === 'Xbox'
          ? nextGroup === 'ps'
            ? 'PlayStation'
            : 'Xbox'
          : prev.brand,
      regionLabel:
        nextGroup === 'ps' && prev.regionLabel === 'Любой аккаунт'
          ? 'Турция'
          : prev.regionLabel,
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSubmitError(null);

    const title = clampStr(form.title, 160);
    if (title.length < 2) {
      setSubmitError('Укажите название товара (минимум 2 символа).');
      return;
    }

    const priceRub = Math.round(Number(form.priceRub));
    if (!Number.isFinite(priceRub) || priceRub < 1 || priceRub > 500000) {
      setSubmitError('Цена должна быть от 1 ₽ до 500 000 ₽.');
      return;
    }

    const rawOldPrice = Math.round(Number(form.oldPriceRub) || 0);
    const oldPriceRub =
      Number.isFinite(rawOldPrice) && rawOldPrice > priceRub && rawOldPrice <= 500000
        ? rawOldPrice
        : 0;

    const fullDesc = clampStr(
      form.fullDescription || form.shortDescription || `Официальная цифровая версия ${title}.`,
      4000
    );
    const shortDesc = clampStr(
      form.shortDescription || (fullDesc.length > 155 ? `${fullDesc.slice(0, 152)}…` : fullDesc),
      300
    );

    const payload: ProductDraft = {
      id: isEditMode ? form.id : sanitizeId(form.id || `custom-${Date.now().toString(36)}`, 'prod'),
      sku: clampStr(form.sku || String(Date.now()).slice(-10), 40),
      title,
      platformGroup: form.platformGroup,
      platformLabel: clampStr(form.platformLabel || 'PlayStation 5', 60),
      categoryType: form.categoryType,
      deliveryType: form.deliveryType,
      regionLabel: clampStr(form.regionLabel || 'Турция', 50),
      genre: clampStr(form.genre || 'Экшен · Приключения', 80),
      brand: clampStr(form.brand || (form.platformGroup === 'ps' ? 'PlayStation' : 'Xbox'), 80),
      editionLabel: clampStr(form.editionLabel || 'Standard Edition', 80),
      language: clampStr(
        form.language ||
          (form.hasRussian ? 'Русские субтитры и интерфейс' : 'Английский (English)'),
        100
      ),
      hasRussian: Boolean(form.hasRussian),
      isPreorder: Boolean(form.isPreorder),
      inStock: Boolean(form.inStock),
      isHidden: Boolean(form.isHidden),
      priceRub,
      oldPriceRub,
      image: form.image.trim().slice(0, 450000),
      shortDescription: shortDesc,
      fullDescription: fullDesc,
    };

    setSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Не удалось сохранить товар.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6 bg-black/65 backdrop-blur-xs"
      onClick={() => !saving && onClose()}
    >
      <div
        className="w-full max-w-5xl bg-white sm:rounded-xl border border-neutral-200 shadow-2xl max-h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#111111] text-white px-6 py-4 flex items-center justify-between border-b border-neutral-800 shrink-0">
          <div>
            <h2 id="product-editor-title" className="text-lg font-bold italic">
              {isEditMode ? 'Редактирование товара' : 'Новый товар в каталог'}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {isEditingBuiltin
                ? `Изменение базовой позиции #${form.sku} · обновления сразу появятся на витрине`
                : 'Загрузите обложку, укажите описание и цену — позиция сразу появится на сайте'}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Закрыть редактор товара"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Image Upload + Live Card Preview */}
            <div className="lg:col-span-5 space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-neutral-700">
                    Изображение товара (обложка 4:3)
                  </label>
                  {uploadMeta && (
                    <span className="text-[11px] font-mono text-emerald-700 tabular-nums">
                      {uploadMeta}
                    </span>
                  )}
                </div>

                {/* Drag & Drop Upload Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`relative rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
                    isDragging
                      ? 'border-[#52c44c] bg-[#52c44c]/10'
                      : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  <div className="flex flex-col items-center gap-2">
                    {uploadingImage ? (
                      <Loader2 className="w-7 h-7 text-[#52c44c] animate-spin" />
                    ) : (
                      <Upload className="w-7 h-7 text-neutral-400" strokeWidth={1.75} />
                    )}
                    <div className="text-xs text-neutral-700 font-medium">
                      Перетащите JPG, PNG или WebP сюда
                    </div>
                    <button
                      type="button"
                      disabled={uploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>Выбрать файл с компьютера</span>
                    </button>
                    <p className="text-[11px] text-neutral-500">
                      Автоматическое сжатие до 720×540 для мгновенной загрузки
                    </p>
                  </div>
                </div>

                {imageError && (
                  <p className="text-xs text-red-600 font-medium">{imageError}</p>
                )}

                {/* Direct URL input */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.image.startsWith('data:') ? '' : form.image}
                    onChange={(e) => {
                      setUploadMeta(null);
                      setForm((prev) => ({ ...prev, image: e.target.value }));
                    }}
                    placeholder={
                      form.image.startsWith('data:')
                        ? 'Изображение загружено с устройства'
                        : 'Или вставьте прямую ссылку на изображение (https://...)'
                    }
                    className="flex-1 px-3 py-2 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                  {form.image && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadMeta(null);
                        setForm((prev) => ({ ...prev, image: '' }));
                      }}
                      title="Очистить изображение"
                      className="p-2 text-neutral-500 hover:text-red-600 border border-neutral-200 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Preset gallery */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] text-neutral-500 block">
                    Или выберите готовую обложку магазина:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_ARTWORKS.map((preset) => (
                      <button
                        key={preset.src}
                        type="button"
                        onClick={() => {
                          setUploadMeta(null);
                          setForm((prev) => ({ ...prev, image: preset.src }));
                        }}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                          form.image === preset.src
                            ? 'border-[#52c44c] bg-[#52c44c]/10 text-neutral-900'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Live Storefront Card Preview */}
              <div className="pt-4 border-t border-neutral-200 space-y-2">
                <div className="text-xs font-semibold text-neutral-500">
                  Предпросмотр карточки на витрине
                </div>
                <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden max-w-xs">
                  <div className="relative aspect-[4/3] w-full bg-neutral-900 overflow-hidden">
                    <ResilientImage
                      src={form.image}
                      alt={form.title || 'Превью товара'}
                      title={form.title || 'Новый товар'}
                      className="w-full h-full"
                    />
                    {computedDiscount > 0 ? (
                      <span className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 text-[11px] font-bold text-black bg-[#52c44c] rounded-md tabular-nums">
                        Скидка -{computedDiscount}%
                      </span>
                    ) : form.isPreorder ? (
                      <span className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 text-[11px] font-bold text-white bg-black/85 border border-neutral-700 rounded-md">
                        Предзаказ
                      </span>
                    ) : null}
                  </div>
                  <div className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span className="truncate">
                        {form.platformLabel} · {form.regionLabel}
                      </span>
                      <span className="font-mono text-neutral-400 tabular-nums">#{form.sku}</span>
                    </div>
                    <div className="text-sm font-semibold text-neutral-900 line-clamp-2 min-h-[2.4rem]">
                      {form.title || 'Название игры или подписки'}
                    </div>
                    <div className="flex items-center justify-between text-xs text-neutral-500">
                      <span className="truncate">{form.genre}</span>
                      {form.hasRussian && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <Globe className="w-3 h-3" />
                          <span>RU</span>
                        </span>
                      )}
                    </div>
                    <div className="pt-2.5 border-t border-neutral-100 flex items-center justify-between">
                      <div>
                        {computedDiscount > 0 && (
                          <span className="font-mono text-xs text-neutral-400 line-through block tabular-nums">
                            {oldPriceNum.toLocaleString('ru-RU')} ₽
                          </span>
                        )}
                        <span className="font-mono text-base font-bold text-neutral-900 tabular-nums">
                          {priceNum.toLocaleString('ru-RU')} ₽
                        </span>
                      </div>
                      <span className="px-3 py-1.5 text-xs font-semibold text-white bg-[#52c44c] rounded-md">
                        В корзину
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Fields, Pricing & Descriptions */}
            <div className="lg:col-span-7 space-y-5">
              {/* Title & SKU */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-8 space-y-1.5">
                  <label htmlFor="prod-title" className="text-xs font-semibold text-neutral-700 block">
                    Название позиции *
                  </label>
                  <input
                    id="prod-title"
                    type="text"
                    required
                    maxLength={160}
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Например: GTA 6 Standard Edition"
                    className="w-full px-3.5 py-2.5 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
                <div className="sm:col-span-4 space-y-1.5">
                  <label htmlFor="prod-sku" className="text-xs font-semibold text-neutral-700 block">
                    Артикул (SKU) *
                  </label>
                  <input
                    id="prod-sku"
                    type="text"
                    required
                    maxLength={40}
                    value={form.sku}
                    onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
              </div>

              {/* Pricing Block */}
              <div className="p-4 rounded-lg bg-neutral-50 border border-neutral-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900">
                    Цена и скидка (₽)
                  </span>
                  {computedDiscount > 0 ? (
                    <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                      Автоскидка: -{computedDiscount}% (экономия {(oldPriceNum - priceNum).toLocaleString('ru-RU')} ₽)
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">Без зачёркнутой цены</span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="prod-price" className="text-xs text-neutral-600 block">
                      Цена продажи (₽) *
                    </label>
                    <input
                      id="prod-price"
                      type="number"
                      required
                      min={1}
                      max={500000}
                      step={1}
                      value={form.priceRub || ''}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, priceRub: Number(e.target.value) }))
                      }
                      className="w-full px-3.5 py-2.5 text-sm font-mono font-semibold bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c] tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="prod-old-price" className="text-xs text-neutral-600 block">
                      Старая цена до скидки (₽, опц.)
                    </label>
                    <input
                      id="prod-old-price"
                      type="number"
                      min={0}
                      max={500000}
                      step={1}
                      value={form.oldPriceRub || ''}
                      placeholder="0 — без скидки"
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          oldPriceRub: e.target.value ? Number(e.target.value) : 0,
                        }))
                      }
                      className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c] tabular-nums"
                    />
                  </div>
                </div>
              </div>

              {/* Platform, Category & Delivery */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="prod-platform" className="text-xs font-semibold text-neutral-700 block">
                    Платформа
                  </label>
                  <select
                    id="prod-platform"
                    value={form.platformLabel}
                    onChange={(e) => handlePlatformLabelChange(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  >
                    {PLATFORM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="prod-category" className="text-xs font-semibold text-neutral-700 block">
                    Раздел
                  </label>
                  <select
                    id="prod-category"
                    value={form.categoryType}
                    onChange={(e) => {
                      const nextCat = e.target.value as 'games' | 'subscriptions';
                      setForm((prev) => ({
                        ...prev,
                        categoryType: nextCat,
                        deliveryType: nextCat === 'subscriptions' ? 'subscription' : prev.deliveryType === 'subscription' ? 'account' : prev.deliveryType,
                      }));
                    }}
                    className="w-full px-3 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  >
                    <option value="games">Игры</option>
                    <option value="subscriptions">Подписки</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="prod-delivery" className="text-xs font-semibold text-neutral-700 block">
                    Формат выдачи
                  </label>
                  <select
                    id="prod-delivery"
                    value={form.deliveryType}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        deliveryType: e.target.value as 'account' | 'key' | 'subscription',
                      }))
                    }
                    className="w-full px-3 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  >
                    <option value="account">Покупка на аккаунт</option>
                    <option value="key">Цифровой ключ</option>
                    <option value="subscription">Аккаунт с подпиской</option>
                  </select>
                </div>
              </div>

              {/* Region, Edition, Genre, Brand */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="prod-region" className="text-xs font-semibold text-neutral-700 block">
                    Регион активации
                  </label>
                  <input
                    id="prod-region"
                    type="text"
                    maxLength={50}
                    value={form.regionLabel}
                    onChange={(e) => setForm((prev) => ({ ...prev, regionLabel: e.target.value }))}
                    placeholder="Турция / Любой аккаунт / Россия, без ВПН"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="prod-edition" className="text-xs font-semibold text-neutral-700 block">
                    Издание / срок
                  </label>
                  <input
                    id="prod-edition"
                    type="text"
                    maxLength={80}
                    value={form.editionLabel}
                    onChange={(e) => setForm((prev) => ({ ...prev, editionLabel: e.target.value }))}
                    placeholder="Standard Edition / Deluxe / 12 месяцев"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="prod-genre" className="text-xs font-semibold text-neutral-700 block">
                    Жанр
                  </label>
                  <input
                    id="prod-genre"
                    type="text"
                    maxLength={80}
                    value={form.genre}
                    onChange={(e) => setForm((prev) => ({ ...prev, genre: e.target.value }))}
                    placeholder="Экшен · Приключения"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="prod-brand" className="text-xs font-semibold text-neutral-700 block">
                    Издатель / бренд
                  </label>
                  <input
                    id="prod-brand"
                    type="text"
                    maxLength={80}
                    value={form.brand}
                    onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                    placeholder="Rockstar Games / Sony / Microsoft"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>
              </div>

              {/* Language & Flags */}
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <label htmlFor="prod-language" className="text-xs font-semibold text-neutral-700 block">
                    Локализация
                  </label>
                  <input
                    id="prod-language"
                    type="text"
                    maxLength={100}
                    value={form.language}
                    onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                    placeholder="Полная русская локализация / Русские субтитры / Английский"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-neutral-700">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.hasRussian}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, hasRussian: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                    />
                    <span>Есть русский язык</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.isPreorder}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, isPreorder: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                    />
                    <span>Предзаказ</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.inStock}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, inStock: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                    />
                    <span>В наличии</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={form.isHidden}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, isHidden: e.target.checked }))
                      }
                      className="w-4 h-4 accent-neutral-800 cursor-pointer"
                    />
                    <span>Скрыть с витрины</span>
                  </label>
                </div>
              </div>

              {/* Descriptions */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="prod-full-desc" className="text-xs font-semibold text-neutral-700">
                      Описание товара *
                    </label>
                    <span className="text-[11px] font-mono text-neutral-400 tabular-nums">
                      {form.fullDescription.length} / 4000
                    </span>
                  </div>
                  <textarea
                    id="prod-full-desc"
                    rows={4}
                    maxLength={4000}
                    value={form.fullDescription}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, fullDescription: e.target.value }))
                    }
                    placeholder="Подробное описание игры, особенности издания, условия активации..."
                    className="w-full px-3.5 py-2.5 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c] resize-y"
                  />
                </div>
              </div>

              {submitError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {submitError}
                </div>
              )}
            </div>
          </div>

          {/* Sticky Footer Actions */}
          <div className="mt-6 pt-4 border-t border-neutral-200 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving || uploadingImage}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? 'Сохранение...' : isEditMode ? 'Сохранить изменения' : 'Опубликовать товар'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
