import { Timestamp } from 'firebase/firestore';
import { mapRawToProduct, STORE_PRODUCTS, type StoreProduct } from './storeData';
import type { RawCatalogItem } from './catalogRaw';

export type SaleStatus = 'paid' | 'pending' | 'refunded' | 'cancelled';
export type SaleChannel = 'site' | 'telegram' | 'avito' | 'wildberries';
export type SalePaymentMethod = 'sbp' | 'card' | 'transfer';

export type FlexibleTimestamp = Timestamp | string | number | null;

export interface FirestoreProductDoc {
  id: string;
  sku: string;
  title: string;
  platformGroup: 'ps' | 'xbox';
  platformLabel: string;
  categoryType: 'games' | 'subscriptions';
  deliveryType: 'account' | 'key' | 'subscription';
  regionLabel: string;
  genre: string;
  brand: string;
  editionLabel: string;
  language: string;
  hasRussian: boolean;
  isPreorder: boolean;
  inStock: boolean;
  isHidden: boolean;
  priceRub: number;
  oldPriceRub: number;
  image: string;
  shortDescription: string;
  fullDescription: string;
  createdBy: string;
  createdAt?: FlexibleTimestamp;
  updatedAt?: FlexibleTimestamp;
}

export interface SaleRecord {
  id: string;
  orderDate: string; // YYYY-MM-DD
  productId: string;
  productTitle: string;
  platformGroup: 'ps' | 'xbox';
  categoryType: 'games' | 'subscriptions';
  quantity: number;
  unitPriceRub: number;
  totalRub: number;
  status: SaleStatus;
  channel: SaleChannel;
  paymentMethod: SalePaymentMethod;
  customerName: string;
  customerContact: string;
  note: string;
  createdBy: string;
  createdAt?: FlexibleTimestamp;
  updatedAt?: FlexibleTimestamp;
}

export interface CatalogStatsSummary {
  total: number;
  xboxGames: number;
  psGames: number;
  subscriptions: number;
  keys: number;
  preorders: number;
  withRussian: number;
  discounted: number;
}

export const BUILTIN_PRODUCT_IDS = new Set(STORE_PRODUCTS.map((p) => p.id));
export const DEFAULT_DELTA_CUTOFF_ISO = '2026-11-26T01:00:00.000Z';

export interface StaticCatalogManifest {
  version: number;
  deltaCutoffIso: string;
  totalExtraCount: number;
  descriptions: string[];
  parts: string[];
}

interface CompactStaticCatalogItem extends Omit<RawCatalogItem, 'description'> {
  description?: string;
  dIdx?: number;
}

export interface LoadedStaticExtraCatalog {
  products: StoreProduct[];
  idSet: Set<string>;
  deltaCutoffIso: string;
}

let cachedStaticExtraPromise: Promise<LoadedStaticExtraCatalog> | null = null;

/**
 * Loads the pre-built 27,020-item static catalog chunks from /catalog-data/
 * in parallel with 0 Firestore reads. Cached per session.
 */
export function loadStaticExtraCatalog(): Promise<LoadedStaticExtraCatalog> {
  if (cachedStaticExtraPromise) return cachedStaticExtraPromise;

  cachedStaticExtraPromise = (async () => {
    try {
      const manifestRes = await fetch('/catalog-data/manifest.json');
      const ct = manifestRes.headers.get('content-type') || '';
      if (!manifestRes.ok || !ct.includes('application/json')) {
        return {
          products: [],
          idSet: new Set<string>(),
          deltaCutoffIso: DEFAULT_DELTA_CUTOFF_ISO,
        };
      }

      const manifest = (await manifestRes.json()) as StaticCatalogManifest;
      const parts = Array.isArray(manifest.parts) ? manifest.parts : [];
      const descriptions = Array.isArray(manifest.descriptions) ? manifest.descriptions : [];
      const deltaCutoffIso =
        typeof manifest.deltaCutoffIso === 'string' && manifest.deltaCutoffIso
          ? manifest.deltaCutoffIso
          : DEFAULT_DELTA_CUTOFF_ISO;

      const partArrays = await Promise.all(
        parts.map(async (partUrl) => {
          try {
            const res = await fetch(partUrl);
            if (!res.ok) return [] as CompactStaticCatalogItem[];
            const parsed = (await res.json()) as unknown;
            return Array.isArray(parsed) ? (parsed as CompactStaticCatalogItem[]) : [];
          } catch {
            return [] as CompactStaticCatalogItem[];
          }
        })
      );

      const products: StoreProduct[] = [];
      const idSet = new Set<string>();

      for (const chunk of partArrays) {
        for (const compact of chunk) {
          if (!compact || !compact.id || BUILTIN_PRODUCT_IDS.has(compact.id) || idSet.has(compact.id)) {
            continue;
          }
          const description =
            typeof compact.description === 'string'
              ? compact.description
              : typeof compact.dIdx === 'number'
                ? descriptions[compact.dIdx] || ''
                : '';

          const rawItem: RawCatalogItem = {
            id: compact.id,
            sku: compact.sku,
            title: compact.title,
            platform: compact.platform,
            region: compact.region,
            hasRussian: compact.hasRussian,
            category: compact.category,
            brand: compact.brand,
            price: compact.price,
            oldPrice: compact.oldPrice,
            image: compact.image,
            description,
          };

          idSet.add(rawItem.id);
          products.push(mapRawToProduct(rawItem));
        }
      }

      products.sort((a, b) => b.featuredScore - a.featuredScore);

      return { products, idSet, deltaCutoffIso };
    } catch {
      return {
        products: [],
        idSet: new Set<string>(),
        deltaCutoffIso: DEFAULT_DELTA_CUTOFF_ISO,
      };
    }
  })();

  return cachedStaticExtraPromise;
}

export const PRESET_ARTWORKS: { label: string; src: string }[] = [
  { label: 'PlayStation Экшен', src: '/src/assets/images/catalog_ps_action_1795245737849.jpg' },
  { label: 'Xbox Гонки', src: '/src/assets/images/catalog_xbox_racing_1795245738055.jpg' },
  { label: 'Подписки Game Pass', src: '/src/assets/images/catalog_subscription_cards_1795245737656.jpg' },
  { label: 'Кооп Sci-Fi', src: '/src/assets/images/catalog_coop_scifi_1795245737517.jpg' },
  { label: 'Консольный сетап', src: '/src/assets/images/hero_console_setup_1795245737990.jpg' },
];

export function sanitizeId(raw: string, fallbackPrefix = 'prod'): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 76);
  if (cleaned.length >= 2) return cleaned;
  return `${fallbackPrefix}-${Date.now().toString(36)}`;
}

export function clampStr(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function buildDeliveryLabel(
  platformGroup: 'ps' | 'xbox',
  deliveryType: 'account' | 'key' | 'subscription'
): string {
  if (deliveryType === 'subscription') return 'На ваш аккаунт или готовый профиль';
  if (deliveryType === 'key') return 'Ключ на ваш аккаунт';
  return platformGroup === 'ps' ? 'Покупка на турецкий аккаунт' : 'Покупка на любой аккаунт';
}

function buildDeliveryTimeNote(
  platformGroup: 'ps' | 'xbox',
  deliveryType: 'account' | 'key' | 'subscription'
): string {
  if (deliveryType === 'key') return 'Цифровой ключ · 5–15 мин';
  if (deliveryType === 'subscription') return 'Оформление подписки · 5–15 мин';
  return platformGroup === 'ps'
    ? 'Покупка в турецком PS Store · 5–15 мин'
    : 'Оформление на аккаунт Xbox · 5–15 мин';
}

function buildActivationSteps(
  platformGroup: 'ps' | 'xbox',
  deliveryType: 'account' | 'key' | 'subscription'
): string[] {
  if (deliveryType === 'subscription') {
    const accountTarget =
      platformGroup === 'ps'
        ? 'Мы можем приобрести и активировать подписку PlayStation Plus прямо на ваш личный аккаунт PlayStation либо выдать новый готовый аккаунт по вашему выбору.'
        : 'Мы можем приобрести и активировать подписку Xbox Game Pass Ultimate прямо на ваш личный аккаунт Microsoft либо выдать новый готовый аккаунт по вашему выбору.';
    const playStep =
      platformGroup === 'ps'
        ? 'Если выбран готовый аккаунт — включите «Общий доступ к консоли» на PS4/PS5 и играйте со своего основного профиля (все сохранения и трофеи сохраняются).'
        : 'После активации используйте подписку на своём аккаунте или включите «Домашнюю консоль» на Xbox и играйте с основного профиля без VPN.';
    return [
      'Оформите заказ в корзине и укажите ваш Telegram (@username) или напишите сразу менеджеру: https://t.me/GyberGameStore.',
      accountTarget,
      playStep,
    ];
  }
  if (deliveryType === 'key') {
    return [
      'Оформите заказ в корзине и укажите ваш Telegram (@username) или напишите менеджеру: https://t.me/GyberGameStore.',
      'Менеджер отправит официальный цифровой ключ активации Xbox в Telegram и при необходимости поможет активировать ключ на ваш аккаунт.',
      'Игра закрепляется за вашим личным аккаунтом Microsoft навсегда и доступна для загрузки с консоли.',
    ];
  }
  if (platformGroup === 'ps') {
    return [
      'При оформлении заказа укажите ваш Telegram (@username) или напишите менеджеру: https://t.me/GyberGameStore. Если турецкого аккаунта PlayStation ещё нет — бесплатно поможем создать.',
      'Мы официально оплачиваем игру в турецком PlayStation Store за 5–15 минут и отправляем подтверждение покупки в Telegram.',
      'Включите «Общий доступ к консоли» на PS5/PS4 и играйте со своего основного российского аккаунта со всеми трофеями.',
    ];
  }
  return [
    'Оформите заказ в корзине и укажите ваш Telegram (@username) или напишите менеджеру: https://t.me/GyberGameStore.',
    'Мы официально приобретаем игру на ваш аккаунт Microsoft (подходит любой аккаунт Xbox) за 5–15 минут и сообщаем о готовности в Telegram.',
    'После подтверждения скачайте игру из вашей библиотеки на консоль и играйте без ограничений.',
  ];
}

export function firestoreDocToStoreProduct(
  docData: FirestoreProductDoc,
  baseProduct?: StoreProduct
): StoreProduct {
  const priceRub = Math.max(1, Math.round(docData.priceRub));
  const oldPriceRub =
    docData.oldPriceRub > priceRub ? Math.round(docData.oldPriceRub) : 0;
  const discountPercent =
    oldPriceRub > priceRub ? Math.round((1 - priceRub / oldPriceRub) * 100) : 0;

  const deliveryLabel = buildDeliveryLabel(docData.platformGroup, docData.deliveryType);
  const deliveryNote = buildDeliveryTimeNote(docData.platformGroup, docData.deliveryType);
  const variantId = baseProduct?.variants[0]?.id || `sku-${docData.sku}`;

  const fallbackTone =
    docData.platformGroup === 'ps'
      ? 'from-slate-900 via-blue-950 to-zinc-900'
      : docData.categoryType === 'subscriptions'
        ? 'from-emerald-950 via-zinc-900 to-neutral-950'
        : 'from-zinc-900 via-neutral-900 to-stone-900';

  const shortDescription =
    docData.shortDescription ||
    (docData.fullDescription.length > 155
      ? `${docData.fullDescription.slice(0, 152)}…`
      : docData.fullDescription);

  return {
    id: docData.id,
    sku: docData.sku,
    slug: baseProduct?.slug || `custom-${docData.id}`,
    title: docData.title,
    rawTitle: docData.title,
    editionLabel: docData.editionLabel,
    seriesKey: baseProduct?.seriesKey || docData.title.toLowerCase().trim(),
    platformLabel: docData.platformLabel,
    platformGroup: docData.platformGroup,
    categoryType: docData.categoryType,
    deliveryType: docData.deliveryType,
    deliveryLabel,
    regionLabel: docData.regionLabel,
    isPreorder: docData.isPreorder,
    hasRussian: docData.hasRussian,
    brand: docData.brand,
    genre: docData.genre,
    releaseYear: baseProduct?.releaseYear || '2026',
    releaseDate: baseProduct?.releaseDate,
    language: docData.language,
    rating: baseProduct?.rating ?? 5.0,
    featuredScore: baseProduct ? baseProduct.featuredScore : 120,
    image: docData.image,
    fallbackTone,
    shortDescription,
    fullDescription: docData.fullDescription || shortDescription,
    activationSteps: buildActivationSteps(docData.platformGroup, docData.deliveryType),
    variants: [
      {
        id: variantId,
        label: `${docData.editionLabel} · ${docData.regionLabel}`,
        editionNote: docData.isPreorder ? `${deliveryLabel} · Предзаказ` : deliveryLabel,
        oldPriceRub,
        priceRub,
        discountPercent,
        deliveryNote,
        inStock: docData.inStock,
      },
    ],
  };
}

export function storeProductToEditorDraft(
  product: StoreProduct,
  override?: FirestoreProductDoc
): Omit<FirestoreProductDoc, 'createdBy' | 'createdAt' | 'updatedAt'> {
  if (override) {
    return {
      id: override.id,
      sku: override.sku,
      title: override.title,
      platformGroup: override.platformGroup,
      platformLabel: override.platformLabel,
      categoryType: override.categoryType,
      deliveryType: override.deliveryType,
      regionLabel: override.regionLabel,
      genre: override.genre,
      brand: override.brand,
      editionLabel: override.editionLabel,
      language: override.language,
      hasRussian: override.hasRussian,
      isPreorder: override.isPreorder,
      inStock: override.inStock,
      isHidden: override.isHidden,
      priceRub: override.priceRub,
      oldPriceRub: override.oldPriceRub,
      image: override.image,
      shortDescription: override.shortDescription,
      fullDescription: override.fullDescription,
    };
  }
  const v = product.variants[0];
  return {
    id: product.id,
    sku: product.sku,
    title: product.title,
    platformGroup: product.platformGroup,
    platformLabel: product.platformLabel,
    categoryType: product.categoryType,
    deliveryType: product.deliveryType,
    regionLabel: product.regionLabel,
    genre: product.genre,
    brand: product.brand,
    editionLabel: product.editionLabel,
    language: product.language,
    hasRussian: product.hasRussian,
    isPreorder: product.isPreorder,
    inStock: v.inStock,
    isHidden: false,
    priceRub: v.priceRub,
    oldPriceRub: v.oldPriceRub,
    image: product.image,
    shortDescription: product.shortDescription,
    fullDescription: product.fullDescription,
  };
}

export function getTimestampMs(value?: FlexibleTimestamp): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return 0;
}

export function combineProductOverrides(
  firestoreDocs: FirestoreProductDoc[],
  serverDocs: FirestoreProductDoc[]
): FirestoreProductDoc[] {
  const byId = new Map<string, FirestoreProductDoc>();
  for (const docData of firestoreDocs) {
    byId.set(docData.id, docData);
  }
  for (const docData of serverDocs) {
    const existing = byId.get(docData.id);
    if (!existing || getTimestampMs(docData.updatedAt) >= getTimestampMs(existing.updatedAt)) {
      byId.set(docData.id, docData);
    }
  }
  return Array.from(byId.values());
}

export function mergeCatalogProducts(
  firestoreDocs: FirestoreProductDoc[],
  includeHidden = false,
  extraStaticProducts: StoreProduct[] = [],
  extraStaticIdSet?: Set<string>
): StoreProduct[] {
  const staticIds =
    extraStaticIdSet ??
    (extraStaticProducts.length > 0
      ? new Set(extraStaticProducts.map((p) => p.id))
      : null);

  const overrideMap = new Map<string, FirestoreProductDoc>();
  const customOnly: FirestoreProductDoc[] = [];

  for (const docData of firestoreDocs) {
    overrideMap.set(docData.id, docData);
    if (!BUILTIN_PRODUCT_IDS.has(docData.id) && !(staticIds && staticIds.has(docData.id))) {
      customOnly.push(docData);
    }
  }

  const mergedCustom: StoreProduct[] = [];
  for (const docData of customOnly) {
    if (!includeHidden && docData.isHidden) continue;
    mergedCustom.push(firestoreDocToStoreProduct(docData));
  }

  // Sort newly added custom items by updatedAt descending so new additions appear at the top
  mergedCustom.sort((a, b) => {
    const docA = overrideMap.get(a.id);
    const docB = overrideMap.get(b.id);
    return getTimestampMs(docB?.updatedAt) - getTimestampMs(docA?.updatedAt);
  });

  const mergedBuiltin: StoreProduct[] = [];
  for (const base of STORE_PRODUCTS) {
    const override = overrideMap.get(base.id);
    if (override) {
      if (!includeHidden && override.isHidden) continue;
      mergedBuiltin.push(firestoreDocToStoreProduct(override, base));
    } else {
      mergedBuiltin.push(base);
    }
  }

  if (extraStaticProducts.length === 0) {
    return [...mergedCustom, ...mergedBuiltin];
  }

  const mergedExtraStatic: StoreProduct[] = [];
  for (const base of extraStaticProducts) {
    const override = overrideMap.get(base.id);
    if (override) {
      if (!includeHidden && override.isHidden) continue;
      mergedExtraStatic.push(firestoreDocToStoreProduct(override, base));
    } else {
      mergedExtraStatic.push(base);
    }
  }

  // Both mergedBuiltin and mergedExtraStatic are already ordered by featuredScore descending.
  // Two-pointer O(N) merge puts top-scored extra items (like PS Plus subscriptions) onto Page 1.
  const rankedCatalog: StoreProduct[] = new Array(mergedBuiltin.length + mergedExtraStatic.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < mergedBuiltin.length && j < mergedExtraStatic.length) {
    if (mergedBuiltin[i].featuredScore >= mergedExtraStatic[j].featuredScore) {
      rankedCatalog[k++] = mergedBuiltin[i++];
    } else {
      rankedCatalog[k++] = mergedExtraStatic[j++];
    }
  }
  while (i < mergedBuiltin.length) rankedCatalog[k++] = mergedBuiltin[i++];
  while (j < mergedExtraStatic.length) rankedCatalog[k++] = mergedExtraStatic[j++];

  return [...mergedCustom, ...rankedCatalog];
}

export function computeCatalogStats(products: StoreProduct[]): CatalogStatsSummary {
  let xboxGames = 0;
  let psGames = 0;
  let subscriptions = 0;
  let keys = 0;
  let preorders = 0;
  let withRussian = 0;
  let discounted = 0;

  for (const p of products) {
    if (p.platformGroup === 'xbox' && p.categoryType === 'games') xboxGames++;
    if (p.platformGroup === 'ps') psGames++;
    if (p.categoryType === 'subscriptions') subscriptions++;
    if (p.deliveryType === 'key') keys++;
    if (p.isPreorder) preorders++;
    if (p.hasRussian) withRussian++;
    if (p.variants[0].discountPercent > 0) discounted++;
  }

  return {
    total: products.length,
    xboxGames,
    psGames,
    subscriptions,
    keys,
    preorders,
    withRussian,
    discounted,
  };
}

export function getRelatedEditionsFromList(
  product: StoreProduct,
  allProducts: StoreProduct[]
): StoreProduct[] {
  if (!product.seriesKey) return [];
  const siblings = allProducts.filter(
    (item) =>
      item.platformGroup === product.platformGroup &&
      item.seriesKey === product.seriesKey
  );
  if (siblings.length <= 1) return [];
  return siblings.sort((a, b) => a.variants[0].priceRub - b.variants[0].priceRub);
}

/**
 * Compresses an uploaded image file on the client using HTML5 Canvas
 * so it fits comfortably within Firestore document size limits (< 300 KB).
 */
export async function compressImageFileToDataUrl(
  file: File
): Promise<{ dataUrl: string; width: number; height: number; sizeKb: number }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Пожалуйста, выберите файл изображения (JPG, PNG или WebP).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Размер исходного файла превышает 15 МБ.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      el.src = objectUrl;
    });

    const MAX_W = 720;
    const MAX_H = 540;
    const scale = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Браузер не поддерживает обработку изображений Canvas.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/webp', quality);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    while (dataUrl.length > 360000 && quality > 0.35) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    if (dataUrl.length > 440000) {
      throw new Error('Изображение слишком тяжёлое даже после сжатия. Выберите другой файл.');
    }

    const sizeKb = Math.max(1, Math.round((dataUrl.length * 3) / 4 / 1024));
    return { dataUrl, width, height, sizeKb };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatRub(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export interface ParsedCatalogImportItem {
  draft: Omit<FirestoreProductDoc, 'createdBy' | 'createdAt' | 'updatedAt'>;
  rawTitle: string;
  discountPercent: number;
}

export interface CatalogJsonParseResult {
  items: ParsedCatalogImportItem[];
  errors: string[];
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/\s+/g, '').replace(',', '.');
    const parsed = Number(cleaned);
    if (cleaned.length > 0 && Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function sanitizeNonStandardJson(rawText: string): string {
  const trimmed = rawText.replace(/^\uFEFF/, '');
  if (!/\b(?:NaN|Infinity)\b/.test(trimmed)) return trimmed;
  return trimmed.replace(
    /"(?:\\.|[^"\\])*"|-?\b(?:Infinity|NaN)\b/g,
    (match) => (match.startsWith('"') ? match : 'null')
  );
}

/**
 * Parses a JSON string containing an array of products (matching RawCatalogItem format
 * like cybergamestore_catalog_sample_20.json or full 27k catalogs with Python NaN values),
 * a single product object, or { items/products: [...] }.
 */
export function parseCatalogJsonText(rawText: string): CatalogJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeNonStandardJson(rawText));
  } catch {
    return {
      items: [],
      errors: ['Файл не является корректным JSON. Проверьте синтаксис (скобки, кавычки, запятые).'],
    };
  }

  let rawList: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) rawList = obj.items;
    else if (Array.isArray(obj.products)) rawList = obj.products;
    else if (Array.isArray(obj.data)) rawList = obj.data;
    else rawList = [obj];
  } else {
    return {
      items: [],
      errors: ['Ожидался JSON-массив товаров или объект товара.'],
    };
  }

  if (rawList.length === 0) {
    return { items: [], errors: ['В файле не найдено ни одной позиции товара.'] };
  }

  const MAX_DETAILED_ERRORS = 40;
  const items: ParsedCatalogImportItem[] = [];
  const errors: string[] = [];
  let hiddenErrorCount = 0;
  const seenIds = new Set<string>();

  const pushError = (msg: string) => {
    if (errors.length < MAX_DETAILED_ERRORS) {
      errors.push(msg);
    } else {
      hiddenErrorCount++;
    }
  };

  for (let index = 0; index < rawList.length; index++) {
    const entry = rawList[index];
    const rowLabel = `Позиция #${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      pushError(`${rowLabel}: элемент не является объектом.`);
      continue;
    }

    const rec = entry as Record<string, unknown>;
    const rawTitle = asString(rec.title || rec.name);
    if (rawTitle.length < 2) {
      pushError(`${rowLabel}: отсутствует или слишком короткое поле "title".`);
      continue;
    }

    const rawPrice = asOptionalNumber(rec.price ?? rec.priceRub);
    if (rawPrice === null || rawPrice < 1 || rawPrice > 500000) {
      pushError(
        `${rowLabel} («${rawTitle.slice(0, 40)}»): некорректная цена (ожидается от 1 до 500 000 ₽).`
      );
      continue;
    }

    const rawOldPrice = asOptionalNumber(rec.oldPrice ?? rec.oldPriceRub);
    const priceRub = Math.round(rawPrice);
    const oldPriceRub =
      rawOldPrice !== null && rawOldPrice > priceRub && rawOldPrice <= 500000
        ? Math.round(rawOldPrice)
        : 0;

    const rawId = asString(rec.id || rec.sku);
    let safeId = sanitizeId(rawId || `imp-${Date.now().toString(36)}-${index + 1}`, 'imp');
    if (seenIds.has(safeId)) {
      safeId = sanitizeId(`${safeId}-${index + 1}`, 'imp');
    }
    seenIds.add(safeId);

    const safeSku = clampStr(asString(rec.sku || rec.id) || safeId, 40);
    const rawPlatform = asString(rec.platform || rec.platformLabel, 'PlayStation');
    const normalizedPlatform = /xbox/i.test(rawPlatform) ? 'Xbox' : 'PlayStation';

    const rawItem: RawCatalogItem = {
      id: safeId,
      sku: safeSku,
      title: rawTitle,
      platform: normalizedPlatform,
      region: asString(rec.region || rec.regionLabel) || null,
      hasRussian: Boolean(rec.hasRussian),
      category: asString(rec.category, 'Games'),
      brand: asString(rec.brand, normalizedPlatform),
      price: priceRub,
      oldPrice: oldPriceRub > 0 ? oldPriceRub : null,
      image: asString(rec.image),
      description: asString(rec.description || rec.fullDescription || rec.shortDescription, rawTitle),
    };

    const mapped = mapRawToProduct(rawItem);
    const title = clampStr(mapped.title || rawTitle, 160);
    const fullDescription = clampStr(mapped.fullDescription || rawItem.description || title, 4000);
    const shortDescription = clampStr(
      mapped.shortDescription ||
        (fullDescription.length > 155 ? `${fullDescription.slice(0, 152)}…` : fullDescription),
      300
    );

    const draft: Omit<FirestoreProductDoc, 'createdBy' | 'createdAt' | 'updatedAt'> = {
      id: safeId,
      sku: safeSku,
      title: title.length >= 2 ? title : clampStr(rawTitle, 160),
      platformGroup: mapped.platformGroup,
      platformLabel: clampStr(mapped.platformLabel || 'PlayStation 5', 60),
      categoryType: mapped.categoryType,
      deliveryType: mapped.deliveryType,
      regionLabel: clampStr(mapped.regionLabel || 'Турция', 50),
      genre: clampStr(mapped.genre || 'Экшен · Приключения', 80),
      brand: clampStr(mapped.brand || normalizedPlatform, 80),
      editionLabel: clampStr(mapped.editionLabel || 'Standard Edition', 80),
      language: clampStr(mapped.language || 'Английский (English)', 100),
      hasRussian: mapped.hasRussian,
      isPreorder: mapped.isPreorder,
      inStock: rec.inStock === undefined ? true : Boolean(rec.inStock),
      isHidden: rec.isHidden === true,
      priceRub,
      oldPriceRub,
      image: rawItem.image.slice(0, 450000),
      shortDescription,
      fullDescription,
    };

    items.push({
      draft,
      rawTitle,
      discountPercent: mapped.variants[0].discountPercent,
    });
  }

  if (hiddenErrorCount > 0) {
    errors.push(`…и ещё пропущено позиций с ошибками: ${hiddenErrorCount}`);
  }

  return { items, errors };
}

/**
 * Generates realistic initial monthly sales data across the current month
 * (using real CyberGameStore catalog items) for first-time admin onboarding.
 */
export function buildInitialMonthlySales(
  adminUid: string
): Omit<SaleRecord, 'createdAt' | 'updatedAt'>[] {
  const now = new Date();
  const year = now.getFullYear();
  const monthIdx = now.getMonth();
  const maxDay = Math.max(1, Math.min(now.getDate(), 28));
  const ym = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;

  const topProducts = STORE_PRODUCTS.slice(0, 12);
  const pick = (idx: number) => topProducts[idx % topProducts.length];

  const templates: Array<{
    dayOffset: number;
    productIdx: number;
    qty: number;
    channel: SaleChannel;
    paymentMethod: SalePaymentMethod;
    status: SaleStatus;
    customerName: string;
    customerContact: string;
    note: string;
  }> = [
    { dayOffset: 0, productIdx: 0, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Алексей К.', customerContact: '@alexey_xbox', note: 'Game Pass на 12 мес' },
    { dayOffset: 0, productIdx: 2, qty: 1, channel: 'telegram', paymentMethod: 'sbp', status: 'paid', customerName: 'Дмитрий В.', customerContact: '@dmitry_ps5', note: 'Покупка на турецкий аккаунт' },
    { dayOffset: 1, productIdx: 1, qty: 1, channel: 'site', paymentMethod: 'card', status: 'paid', customerName: 'Максим С.', customerContact: 'max.s@mail.ru', note: 'Быстрая выдача 10 мин' },
    { dayOffset: 2, productIdx: 4, qty: 2, channel: 'avito', paymentMethod: 'transfer', status: 'paid', customerName: 'Илья Морозов', customerContact: 'Avito #49102', note: '2 ключа в подарок' },
    { dayOffset: 3, productIdx: 3, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Сергей Н.', customerContact: '@sergey_game', note: 'Оплачено через СБП Т-Банк' },
    { dayOffset: 4, productIdx: 5, qty: 1, channel: 'telegram', paymentMethod: 'sbp', status: 'paid', customerName: 'Артём Л.', customerContact: '@artem_l99', note: 'Создали новый турецкий профиль' },
    { dayOffset: 5, productIdx: 0, qty: 2, channel: 'wildberries', paymentMethod: 'card', status: 'paid', customerName: 'Елена Р.', customerContact: 'WB заказ 88412', note: 'Выдача подписки по инструкции' },
    { dayOffset: 6, productIdx: 6, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Никита П.', customerContact: '@nikita_play', note: 'Активировано на личный аккаунт' },
    { dayOffset: 7, productIdx: 7, qty: 1, channel: 'telegram', paymentMethod: 'transfer', status: 'paid', customerName: 'Владислав Г.', customerContact: '@vlad_g88', note: 'Предзаказ оформлен' },
    { dayOffset: 8, productIdx: 2, qty: 1, channel: 'site', paymentMethod: 'card', status: 'refunded', customerName: 'Олег Т.', customerContact: 'oleg.t@yandex.ru', note: 'Возврат до покупки по просьбе клиента' },
    { dayOffset: 9, productIdx: 8, qty: 1, channel: 'avito', paymentMethod: 'sbp', status: 'paid', customerName: 'Павел З.', customerContact: 'Avito #49281', note: 'Ключ Xbox активирован' },
    { dayOffset: 10, productIdx: 1, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Андрей Б.', customerContact: '@andrey_b', note: 'Т-Банк СБП' },
    { dayOffset: 11, productIdx: 0, qty: 1, channel: 'telegram', paymentMethod: 'sbp', status: 'paid', customerName: 'Роман Е.', customerContact: '@roman_e', note: 'Продление Game Pass Ultimate' },
    { dayOffset: 12, productIdx: 9, qty: 1, channel: 'site', paymentMethod: 'card', status: 'paid', customerName: 'Кирилл М.', customerContact: 'kirill.m@gmail.com', note: 'PS5 Турция' },
    { dayOffset: 13, productIdx: 4, qty: 1, channel: 'wildberries', paymentMethod: 'card', status: 'paid', customerName: 'Анна Д.', customerContact: 'WB заказ 90115', note: 'Подарок на консоль' },
    { dayOffset: 14, productIdx: 3, qty: 2, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Иван Ш.', customerContact: '@ivan_sh', note: 'Кооп на двоих' },
    { dayOffset: 15, productIdx: 10, qty: 1, channel: 'telegram', paymentMethod: 'sbp', status: 'paid', customerName: 'Егор Ф.', customerContact: '@egor_f', note: 'Быстрое оформление' },
    { dayOffset: 16, productIdx: 5, qty: 1, channel: 'site', paymentMethod: 'card', status: 'paid', customerName: 'Денис Ч.', customerContact: 'denis.ch@bk.ru', note: 'Карта Мир' },
    { dayOffset: 17, productIdx: 0, qty: 2, channel: 'avito', paymentMethod: 'sbp', status: 'paid', customerName: 'Виктор О.', customerContact: 'Avito #49811', note: 'Подписка на 2 консоли' },
    { dayOffset: 18, productIdx: 11, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Тимур А.', customerContact: '@timur_a', note: 'Скидка выходного дня' },
    { dayOffset: 19, productIdx: 6, qty: 1, channel: 'telegram', paymentMethod: 'transfer', status: 'paid', customerName: 'Степан Ж.', customerContact: '@stepan_zh', note: 'Повторный клиент' },
    { dayOffset: 20, productIdx: 2, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Михаил Ю.', customerContact: '@mikhail_yu', note: 'PS5 Deluxe' },
    { dayOffset: 21, productIdx: 1, qty: 2, channel: 'site', paymentMethod: 'card', status: 'paid', customerName: 'Глеб Р.', customerContact: 'gleb@inbox.ru', note: 'Оплачено картой РФ' },
    { dayOffset: 22, productIdx: 7, qty: 1, channel: 'wildberries', paymentMethod: 'card', status: 'paid', customerName: 'Мария К.', customerContact: 'WB заказ 91502', note: 'Выдано в чат' },
    { dayOffset: 23, productIdx: 0, qty: 1, channel: 'site', paymentMethod: 'sbp', status: 'paid', customerName: 'Антон В.', customerContact: '@anton_v', note: 'Game Pass Ultimate' },
    { dayOffset: 24, productIdx: 3, qty: 1, channel: 'telegram', paymentMethod: 'sbp', status: 'pending', customerName: 'Юрий С.', customerContact: '@yury_s', note: 'Ожидает подтверждения входа' },
  ];

  return templates.map((tpl, idx) => {
    const product = pick(tpl.productIdx);
    const dayNum = Math.max(1, maxDay - Math.floor((tpl.dayOffset * maxDay) / 25));
    const orderDate = `${ym}-${String(dayNum).padStart(2, '0')}`;
    const unitPriceRub = product.variants[0].priceRub;
    const totalRub = unitPriceRub * tpl.qty;
    const id = `CGS-${year % 100}${String(monthIdx + 1).padStart(2, '0')}${String(101 + idx)}`;

    return {
      id,
      orderDate,
      productId: product.id,
      productTitle: clampStr(product.title, 160),
      platformGroup: product.platformGroup,
      categoryType: product.categoryType,
      quantity: tpl.qty,
      unitPriceRub,
      totalRub,
      status: tpl.status,
      channel: tpl.channel,
      paymentMethod: tpl.paymentMethod,
      customerName: tpl.customerName,
      customerContact: tpl.customerContact,
      note: tpl.note,
      createdBy: adminUid,
    };
  });
}
