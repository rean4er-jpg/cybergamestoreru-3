import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { STORE_PRODUCTS, type ProductVariant } from './src/data/storeData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PaymentMethod = 'sbp' | 'card';
type PaymentProvider = 'tbank' | 'sandbox';
type OrderStatus = 'pending' | 'paid' | 'cancelled';

interface OrderItemRecord {
  productId: string;
  variantId: string;
  title: string;
  platformLabel: string;
  variantLabel: string;
  unitPriceRub: number;
  quantity: number;
}

interface OrderRecord {
  id: string;
  accessToken: string;
  status: OrderStatus;
  provider: PaymentProvider;
  providerPaymentId?: string;
  paymentMethod: PaymentMethod;
  amountRub: number;
  items: OrderItemRecord[];
  customerName: string;
  contact: string;
  accountStatus: string;
  turkAccountEmail?: string;
  confirmationUrl?: string;
  sbpQrPayload?: string;
  createdAt: string;
  paidAt?: string;
}

const PORT = Number(process.env.PORT || 3000);
const MAX_ORDERS_IN_MEMORY = 2000;
const TBANK_API_BASE = 'https://securepay.tinkoff.ru/v2';

const orders = new Map<string, OrderRecord>();

// Authoritative catalog lookup built exclusively on the server
const catalogLookup = new Map<
  string,
  { productTitle: string; platformLabel: string; variant: ProductVariant }
>();

for (const product of STORE_PRODUCTS) {
  for (const variant of product.variants) {
    catalogLookup.set(`${product.id}::${variant.id}`, {
      productTitle: product.title,
      platformLabel: product.platformLabel,
      variant,
    });
  }
}

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const BOOTSTRAP_ADMIN_EMAIL = 'rean4er@gmail.com';

function loadFirebaseAppletConfig(): FirebaseAppletConfig | null {
  try {
    const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<FirebaseAppletConfig>;
    if (!raw.projectId || !raw.apiKey || !raw.firestoreDatabaseId) return null;
    return {
      projectId: raw.projectId,
      apiKey: raw.apiKey,
      firestoreDatabaseId: raw.firestoreDatabaseId,
    };
  } catch {
    return null;
  }
}

const firebaseCfg = loadFirebaseAppletConfig();

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
};

const firestoreProductCache = new Map<
  string,
  { expiresAt: number; entry: { productTitle: string; platformLabel: string; variant: ProductVariant } | null }
>();

interface ServerCatalogItem {
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
  createdAt: string;
  updatedAt: string;
}

interface ServerSaleRecord {
  id: string;
  orderDate: string;
  productId: string;
  productTitle: string;
  platformGroup: 'ps' | 'xbox';
  categoryType: 'games' | 'subscriptions';
  quantity: number;
  unitPriceRub: number;
  totalRub: number;
  status: 'paid' | 'pending' | 'refunded' | 'cancelled';
  channel: 'site' | 'telegram' | 'avito' | 'wildberries';
  paymentMethod: 'sbp' | 'card' | 'transfer';
  customerName: string;
  customerContact: string;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = path.resolve(__dirname, 'data');
const CUSTOM_CATALOG_FILE = path.join(DATA_DIR, 'custom-catalog.json');
const ADMIN_SALES_FILE = path.join(DATA_DIR, 'admin-sales.json');

const customCatalogMap = new Map<string, ServerCatalogItem>();
const serverSalesMap = new Map<string, ServerSaleRecord>();

let cachedCatalogJsonBuf: Buffer | null = null;
let cachedCatalogGzipBuf: Buffer | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function atomicWriteJson(filePath: string, data: unknown) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function invalidateCatalogResponseCache() {
  cachedCatalogJsonBuf = null;
  cachedCatalogGzipBuf = null;
}

function getCatalogResponseBuffers(): { json: Buffer; gzip: Buffer } {
  if (!cachedCatalogJsonBuf || !cachedCatalogGzipBuf) {
    const payload = JSON.stringify({ products: Array.from(customCatalogMap.values()) });
    cachedCatalogJsonBuf = Buffer.from(payload, 'utf8');
    cachedCatalogGzipBuf = zlib.gzipSync(cachedCatalogJsonBuf, { level: 6 });
  }
  return { json: cachedCatalogJsonBuf, gzip: cachedCatalogGzipBuf };
}

function loadPersistentStores() {
  try {
    if (fs.existsSync(CUSTOM_CATALOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_CATALOG_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof item.id === 'string') {
            customCatalogMap.set(item.id, item as ServerCatalogItem);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to load custom-catalog.json:', err);
  }

  try {
    if (fs.existsSync(ADMIN_SALES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ADMIN_SALES_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          if (row && typeof row === 'object' && typeof row.id === 'string') {
            serverSalesMap.set(row.id, row as ServerSaleRecord);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to load admin-sales.json:', err);
  }
}

loadPersistentStores();

function persistCustomCatalog() {
  atomicWriteJson(CUSTOM_CATALOG_FILE, Array.from(customCatalogMap.values()));
  invalidateCatalogResponseCache();
}

function persistServerSales() {
  atomicWriteJson(ADMIN_SALES_FILE, Array.from(serverSalesMap.values()));
}

function sanitizeServerCatalogItem(
  raw: unknown,
  actorUid: string,
  existing?: ServerCatalogItem
): ServerCatalogItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim().slice(0, 80) : '';
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) return null;

  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 160) : '';
  if (title.length < 2) return null;

  const priceNum = Math.round(Number(r.priceRub));
  if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 500000) return null;

  const rawOld = Math.round(Number(r.oldPriceRub) || 0);
  const oldPriceRub = Number.isFinite(rawOld) && rawOld > priceNum && rawOld <= 500000 ? rawOld : 0;

  const platformGroup = r.platformGroup === 'xbox' ? 'xbox' : 'ps';
  const categoryType = r.categoryType === 'subscriptions' ? 'subscriptions' : 'games';
  const deliveryType =
    r.deliveryType === 'key' || r.deliveryType === 'subscription' ? r.deliveryType : 'account';

  const nowIso = new Date().toISOString();
  const str = (val: unknown, max: number, fallback = '') =>
    typeof val === 'string' ? val.trim().slice(0, max) : fallback;

  return {
    id,
    sku: str(r.sku, 40, id) || id,
    title,
    platformGroup,
    platformLabel: str(r.platformLabel, 60, platformGroup === 'ps' ? 'PlayStation 5' : 'Xbox Series X|S'),
    categoryType,
    deliveryType,
    regionLabel: str(r.regionLabel, 50, 'Турция'),
    genre: str(r.genre, 80, 'Экшен'),
    brand: str(r.brand, 80, platformGroup === 'ps' ? 'PlayStation' : 'Xbox'),
    editionLabel: str(r.editionLabel, 80, 'Standard Edition'),
    language: str(r.language, 100, 'Английский (English)'),
    hasRussian: Boolean(r.hasRussian),
    isPreorder: Boolean(r.isPreorder),
    inStock: r.inStock !== false,
    isHidden: r.isHidden === true,
    priceRub: priceNum,
    oldPriceRub,
    image: str(r.image, 450000, ''),
    shortDescription: str(r.shortDescription, 300, title),
    fullDescription: str(r.fullDescription, 4000, title),
    createdBy: existing?.createdBy || actorUid,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

function sanitizeServerSaleRecord(
  raw: unknown,
  actorUid: string,
  existing?: ServerSaleRecord
): ServerSaleRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim().slice(0, 80) : '';
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) return null;

  const orderDate = typeof r.orderDate === 'string' ? r.orderDate.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return null;

  const productTitle = typeof r.productTitle === 'string' ? r.productTitle.trim().slice(0, 160) : '';
  if (productTitle.length < 1) return null;

  const quantity = Math.round(Number(r.quantity));
  const unitPriceRub = Math.round(Number(r.unitPriceRub));
  const totalRub = Math.round(Number(r.totalRub));
  if (
    !Number.isFinite(quantity) ||
    quantity < 1 ||
    quantity > 100 ||
    !Number.isFinite(unitPriceRub) ||
    unitPriceRub < 1 ||
    unitPriceRub > 500000 ||
    !Number.isFinite(totalRub) ||
    totalRub < 1 ||
    totalRub > 5000000
  ) {
    return null;
  }

  const status =
    r.status === 'pending' || r.status === 'refunded' || r.status === 'cancelled'
      ? r.status
      : 'paid';
  const channel =
    r.channel === 'telegram' || r.channel === 'avito' || r.channel === 'wildberries'
      ? r.channel
      : 'site';
  const paymentMethod =
    r.paymentMethod === 'card' || r.paymentMethod === 'transfer' ? r.paymentMethod : 'sbp';
  const nowIso = new Date().toISOString();
  const str = (val: unknown, max: number, fallback = '') =>
    typeof val === 'string' ? val.trim().slice(0, max) : fallback;

  return {
    id,
    orderDate,
    productId: str(r.productId, 80, 'custom-order') || 'custom-order',
    productTitle,
    platformGroup: r.platformGroup === 'ps' ? 'ps' : 'xbox',
    categoryType: r.categoryType === 'subscriptions' ? 'subscriptions' : 'games',
    quantity,
    unitPriceRub,
    totalRub,
    status,
    channel,
    paymentMethod,
    customerName: str(r.customerName, 120, 'Покупатель') || 'Покупатель',
    customerContact: str(r.customerContact, 160, ''),
    note: str(r.note, 400, ''),
    createdBy: existing?.createdBy || actorUid,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

async function resolveCatalogEntry(
  productId: string,
  variantId: string
): Promise<{ productTitle: string; platformLabel: string; variant: ProductVariant } | null> {
  // 1. Check authoritative server-persisted custom/imported catalog first (instant, 0 Firestore reads)
  const localItem = customCatalogMap.get(productId);
  if (localItem) {
    if (localItem.isHidden) return null;
    return {
      productTitle: localItem.title,
      platformLabel: localItem.platformLabel,
      variant: {
        id: variantId || `sku-${localItem.sku}`,
        label: `${localItem.editionLabel} · ${localItem.regionLabel}`,
        editionNote: localItem.regionLabel,
        oldPriceRub: localItem.oldPriceRub > localItem.priceRub ? localItem.oldPriceRub : 0,
        priceRub: localItem.priceRub,
        discountPercent:
          localItem.oldPriceRub > localItem.priceRub
            ? Math.round((1 - localItem.priceRub / localItem.oldPriceRub) * 100)
            : 0,
        deliveryNote: 'Оформление за 5–15 мин',
        inStock: localItem.inStock,
      },
    };
  }

  // 2. Fallback to static built-in catalog before touching Firestore REST
  const staticEntry = catalogLookup.get(`${productId}::${variantId}`);
  if (staticEntry) {
    return staticEntry;
  }

  // 3. Fallback to Firestore REST lookup for legacy Firestore-only custom items
  if (firebaseCfg && /^[a-zA-Z0-9_-]{2,80}$/.test(productId)) {
    const cached = firestoreProductCache.get(productId);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.entry) return cached.entry;
    } else {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseCfg.projectId
        )}/databases/${encodeURIComponent(
          firebaseCfg.firestoreDatabaseId
        )}/documents/products/${encodeURIComponent(productId)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
        if (res.ok) {
          const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
          const f = json.fields;
          if (f) {
            const isHidden = f.isHidden?.booleanValue === true;
            const inStock = f.inStock?.booleanValue !== false;
            const priceRaw = Number(f.priceRub?.integerValue ?? f.priceRub?.doubleValue ?? 0);
            const oldPriceRaw = Number(f.oldPriceRub?.integerValue ?? f.oldPriceRub?.doubleValue ?? 0);
            if (!isHidden && Number.isFinite(priceRaw) && priceRaw >= 1) {
              const title = f.title?.stringValue || 'Товар';
              const platformLabel = f.platformLabel?.stringValue || 'Xbox / PlayStation';
              const editionLabel = f.editionLabel?.stringValue || 'Standard Edition';
              const regionLabel = f.regionLabel?.stringValue || 'Турция';
              const sku = f.sku?.stringValue || productId;
              const entry = {
                productTitle: title,
                platformLabel,
                variant: {
                  id: variantId || `sku-${sku}`,
                  label: `${editionLabel} · ${regionLabel}`,
                  editionNote: regionLabel,
                  oldPriceRub: oldPriceRaw > priceRaw ? Math.round(oldPriceRaw) : 0,
                  priceRub: Math.round(priceRaw),
                  discountPercent:
                    oldPriceRaw > priceRaw ? Math.round((1 - priceRaw / oldPriceRaw) * 100) : 0,
                  deliveryNote: 'Оформление за 5–15 мин',
                  inStock,
                },
              };
              firestoreProductCache.set(productId, { expiresAt: Date.now() + 10000, entry });
              return entry;
            }
            if (isHidden) {
              firestoreProductCache.set(productId, { expiresAt: Date.now() + 10000, entry: null });
              return null;
            }
          }
        }
      } catch {
        // Ignore Firestore REST errors
      }
    }
  }

  return null;
}

async function verifyAdminBearerToken(
  req: Request
): Promise<{ uid: string; email: string } | null> {
  if (!firebaseCfg) return null;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseCfg.apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (
      user &&
      user.localId &&
      user.emailVerified === true &&
      user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
    ) {
      return { uid: user.localId, email: user.email };
    }
    return null;
  } catch {
    return null;
  }
}

function getTbankCredentials(): { terminalKey: string; password: string } | null {
  const terminalKey = process.env.TBANK_TERMINAL_KEY?.trim() || '';
  const password = process.env.TBANK_PASSWORD?.trim() || '';
  if (!terminalKey || !password) return null;
  return { terminalKey, password };
}

function getProviderConfig(): {
  activeProvider: PaymentProvider;
  providerLabel: string;
  isSandbox: boolean;
} {
  if (getTbankCredentials()) {
    return {
      activeProvider: 'tbank',
      providerLabel: 'Т-Банк Эквайринг',
      isSandbox: false,
    };
  }
  return {
    activeProvider: 'sandbox',
    providerLabel: 'Тестовая касса (Sandbox)',
    isSandbox: true,
  };
}

function resolvePublicBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL') {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return configured.replace(/\/+$/, '');
      }
    } catch {
      // fall through to request headers
    }
  }
  const protoHeader = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const hostHeader =
    (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ||
    req.get('host');
  const proto = protoHeader === 'https' || protoHeader === 'http' ? protoHeader : req.protocol;
  if (hostHeader && /^[a-zA-Z0-9.-]+(:\d+)?$/.test(hostHeader)) {
    return `${proto}://${hostHeader}`;
  }
  return `http://localhost:${PORT}`;
}

function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates T-Bank (Tinkoff) Acquiring v2 SHA-256 Token.
 * Only root-level primitive parameters participate (nested objects/arrays and Token are excluded),
 * combined with Password, sorted alphabetically by key, concatenated by value, and hashed via SHA-256.
 */
function generateTbankToken(
  params: Record<string, unknown>,
  password: string
): string {
  const flat: Record<string, string> = { Password: password };

  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token' || key === 'Password' || value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'object') {
      continue;
    }
    flat[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  }

  const concatenated = Object.keys(flat)
    .sort()
    .map((key) => flat[key])
    .join('');

  return crypto.createHash('sha256').update(concatenated, 'utf8').digest('hex');
}

function sanitizeOrderForClient(order: OrderRecord) {
  return {
    id: order.id,
    status: order.status,
    provider: order.provider,
    paymentMethod: order.paymentMethod,
    amountRub: order.amountRub,
    items: order.items,
    customerName: order.customerName,
    accountStatus: order.accountStatus,
    confirmationUrl: order.confirmationUrl,
    sbpQrPayload: order.sbpQrPayload,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

function pruneOrdersIfNeeded() {
  if (orders.size < MAX_ORDERS_IN_MEMORY) return;
  const firstKey = orders.keys().next().value;
  if (firstKey) {
    orders.delete(firstKey);
  }
}

const RUSSIAN_ROOT_CA_SHA256 =
  'D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31';

let cachedTbankAgent: https.Agent | null = null;

function getTbankHttpsAgent(): https.Agent {
  if (cachedTbankAgent) return cachedTbankAgent;

  const extraCas: string[] = [...tls.rootCertificates];
  const caPath = path.resolve(__dirname, 'certs', 'russian_trusted_root_ca.pem');
  if (fs.existsSync(caPath)) {
    const pem = fs.readFileSync(caPath, 'utf8');
    const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
    if (match) {
      const der = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
      const fp = crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
      if (fp === RUSSIAN_ROOT_CA_SHA256) {
        extraCas.push(pem);
      }
    }
  }

  cachedTbankAgent = new https.Agent({
    ca: extraCas,
    rejectUnauthorized: true,
  });
  return cachedTbankAgent;
}

function tbankPost<T>(method: 'Init' | 'GetQr' | 'GetState', payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      `${TBANK_API_BASE}/${method}`,
      {
        method: 'POST',
        agent: getTbankHttpsAgent(),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`T-Bank ${method} HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`T-Bank ${method} returned invalid JSON`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`T-Bank ${method} request timed out`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function createTbankPayment(
  order: OrderRecord,
  baseUrl: string,
  returnUrl: string,
  creds: { terminalKey: string; password: string }
): Promise<{ providerPaymentId: string; confirmationUrl: string; sbpQrPayload?: string }> {
  const amountKopecks = order.amountRub * 100;
  const failUrl = `${baseUrl}/?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.accessToken)}&paymentStatus=failed`;

  const initPayload: Record<string, unknown> = {
    TerminalKey: creds.terminalKey,
    Amount: amountKopecks,
    OrderId: order.id,
    Description: `Заказ ${order.id} — CyberGameStore (игры для турецкого аккаунта)`,
    SuccessURL: returnUrl,
    FailURL: failUrl,
    NotificationURL: `${baseUrl}/api/payments/webhook/tbank`,
    PayType: 'O',
  };

  if (order.contact.includes('@') && order.contact.includes('.')) {
    initPayload.DATA = { Email: order.contact };
  }

  const taxation = process.env.TBANK_TAXATION?.trim();
  if (taxation) {
    initPayload.Receipt = {
      Email:
        order.contact.includes('@') && order.contact.includes('.')
          ? order.contact
          : 'info@cybergamestore.ru',
      Taxation: taxation,
      Items: order.items.map((item) => ({
        Name: `${item.title} (${item.variantLabel})`.slice(0, 128),
        Price: item.unitPriceRub * 100,
        Quantity: item.quantity,
        Amount: item.unitPriceRub * item.quantity * 100,
        Tax: 'none',
        PaymentMethod: 'full_payment',
        PaymentObject: 'service',
      })),
    };
  }

  initPayload.Token = generateTbankToken(initPayload, creds.password);

  const data = await tbankPost<{
    Success?: boolean;
    ErrorCode?: string;
    Message?: string;
    Details?: string;
    PaymentId?: string | number;
    PaymentURL?: string;
  }>('Init', initPayload);

  if (!data.Success || !data.PaymentId || !data.PaymentURL) {
    throw new Error(
      `T-Bank Init error (${data.ErrorCode || 'unknown'}): ${data.Message || data.Details || 'No PaymentURL'}`
    );
  }

  const providerPaymentId = String(data.PaymentId);
  let sbpQrPayload: string | undefined;

  // If user chose SBP, request an SBP QR payload from T-Bank; gracefully fallback to PaymentURL
  if (order.paymentMethod === 'sbp') {
    try {
      const qrPayload: Record<string, unknown> = {
        TerminalKey: creds.terminalKey,
        PaymentId: providerPaymentId,
        DataType: 'PAYLOAD',
      };
      qrPayload.Token = generateTbankToken(qrPayload, creds.password);

      const qrData = await tbankPost<{
        Success?: boolean;
        Data?: string;
      }>('GetQr', qrPayload);

      if (qrData.Success && typeof qrData.Data === 'string' && qrData.Data.startsWith('https://')) {
        sbpQrPayload = qrData.Data;
      }
    } catch {
      // Non-fatal: PaymentURL from Init already supports SBP on the hosted T-Bank page
    }
  }

  return {
    providerPaymentId,
    confirmationUrl: data.PaymentURL,
    sbpQrPayload,
  };
}

async function syncTbankOrderStatus(order: OrderRecord): Promise<void> {
  if (order.provider !== 'tbank' || order.status !== 'pending' || !order.providerPaymentId) {
    return;
  }

  const creds = getTbankCredentials();
  if (!creds) return;

  const statePayload: Record<string, unknown> = {
    TerminalKey: creds.terminalKey,
    PaymentId: order.providerPaymentId,
  };
  statePayload.Token = generateTbankToken(statePayload, creds.password);

  const state = await tbankPost<{
    Success?: boolean;
    Status?: string;
    Amount?: number;
  }>('GetState', statePayload);

  if (!state.Success) return;

  if (state.Status === 'CONFIRMED' && Number(state.Amount) === order.amountRub * 100) {
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
  } else if (
    state.Status === 'CANCELED' ||
    state.Status === 'REJECTED' ||
    state.Status === 'DEADLINE_EXPIRED'
  ) {
    order.status = 'cancelled';
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Larger body parsers mounted BEFORE global 64kb JSON limit for admin bulk catalog uploads
  const adminBulkJsonParser = express.json({ limit: '25mb' });
  const adminItemJsonParser = express.json({ limit: '2mb' });

  app.get('/api/catalog/custom', (req: Request, res: Response) => {
    const { json, gzip } = getCatalogResponseBuffers();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    if (acceptEncoding.includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.send(gzip);
      return;
    }
    res.send(json);
  });

  app.post('/api/admin/catalog/import', adminBulkJsonParser, async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }

    const body = (req.body || {}) as { items?: unknown; flush?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Передан пустой список товаров для импорта.' });
      return;
    }

    let importedCount = 0;
    for (const rawItem of body.items) {
      const existing =
        rawItem && typeof rawItem === 'object' && 'id' in rawItem && typeof rawItem.id === 'string'
          ? customCatalogMap.get(rawItem.id)
          : undefined;
      const sanitized = sanitizeServerCatalogItem(rawItem, adminUser.uid, existing);
      if (sanitized) {
        customCatalogMap.set(sanitized.id, sanitized);
        firestoreProductCache.delete(sanitized.id);
        importedCount++;
      }
    }

    const shouldFlush = body.flush !== false;
    if (shouldFlush) {
      persistCustomCatalog();
    } else {
      invalidateCatalogResponseCache();
    }

    res.json({
      ok: true,
      importedCount,
      totalCustomCount: customCatalogMap.size,
    });
  });

  app.post('/api/admin/catalog/item', adminItemJsonParser, async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }

    const rawItem = req.body as Record<string, unknown> | undefined;
    const existing =
      rawItem && typeof rawItem.id === 'string' ? customCatalogMap.get(rawItem.id) : undefined;
    const sanitized = sanitizeServerCatalogItem(rawItem, adminUser.uid, existing);
    if (!sanitized) {
      res.status(400).json({ error: 'Некорректные данные товара.' });
      return;
    }

    customCatalogMap.set(sanitized.id, sanitized);
    firestoreProductCache.delete(sanitized.id);
    persistCustomCatalog();
    res.json({ ok: true, item: sanitized });
  });

  app.delete('/api/admin/catalog/item/:id', async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }

    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) {
      res.status(400).json({ error: 'Некорректный ID товара.' });
      return;
    }

    customCatalogMap.delete(id);
    firestoreProductCache.delete(id);
    persistCustomCatalog();
    res.json({ ok: true });
  });

  app.get('/api/admin/sales', async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }
    res.json({ sales: Array.from(serverSalesMap.values()) });
  });

  app.post('/api/admin/sales/item', adminItemJsonParser, async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }
    const rawSale = req.body as Record<string, unknown> | undefined;
    const existing =
      rawSale && typeof rawSale.id === 'string' ? serverSalesMap.get(rawSale.id) : undefined;
    const sanitized = sanitizeServerSaleRecord(rawSale, adminUser.uid, existing);
    if (!sanitized) {
      res.status(400).json({ error: 'Некорректные данные продажи.' });
      return;
    }
    serverSalesMap.set(sanitized.id, sanitized);
    persistServerSales();
    res.json({ ok: true, sale: sanitized });
  });

  app.post('/api/admin/sales/batch', adminItemJsonParser, async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }
    const body = (req.body || {}) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Передан пустой список продаж.' });
      return;
    }
    let savedCount = 0;
    for (const rawSale of body.items) {
      const existing =
        rawSale && typeof rawSale === 'object' && 'id' in rawSale && typeof rawSale.id === 'string'
          ? serverSalesMap.get(rawSale.id)
          : undefined;
      const sanitized = sanitizeServerSaleRecord(rawSale, adminUser.uid, existing);
      if (sanitized) {
        serverSalesMap.set(sanitized.id, sanitized);
        savedCount++;
      }
    }
    persistServerSales();
    res.json({ ok: true, savedCount, sales: Array.from(serverSalesMap.values()) });
  });

  app.delete('/api/admin/sales/item/:id', async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{2,80}$/.test(id)) {
      res.status(400).json({ error: 'Некорректный ID заказа.' });
      return;
    }
    serverSalesMap.delete(id);
    persistServerSales();
    res.json({ ok: true });
  });

  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/payments/config', (_req: Request, res: Response) => {
    const config = getProviderConfig();
    res.json({
      activeProvider: config.activeProvider,
      providerLabel: config.providerLabel,
      isSandbox: config.isSandbox,
      supportedMethods: [
        { id: 'sbp', label: 'СБП', note: 'QR-код или приложение банка' },
        { id: 'card', label: 'Карта РФ', note: 'Мир, Visa, Mastercard' },
      ],
    });
  });

  app.post('/api/payments/create', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        items?: Array<{ productId?: unknown; variantId?: unknown; quantity?: unknown }>;
        customerName?: unknown;
        contact?: unknown;
        accountStatus?: unknown;
        turkAccountEmail?: unknown;
        paymentMethod?: unknown;
      };

      if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 30) {
        res.status(400).json({ error: 'Корзина пуста или содержит недопустимое количество позиций.' });
        return;
      }

      const customerName =
        typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 120) : '';
      const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 160) : '';
      const accountStatus =
        typeof body.accountStatus === 'string'
          ? body.accountStatus.trim().slice(0, 140)
          : 'Есть свой турецкий аккаунт';
      const turkAccountEmail =
        typeof body.turkAccountEmail === 'string'
          ? body.turkAccountEmail.trim().slice(0, 160)
          : undefined;

      if (customerName.length < 2 || contact.length < 3) {
        res.status(400).json({ error: 'Укажите ваше имя и контакт (Telegram или Email).' });
        return;
      }

      const paymentMethod: PaymentMethod = body.paymentMethod === 'sbp' ? 'sbp' : 'card';

      const verifiedItems: OrderItemRecord[] = [];
      let totalAmountRub = 0;

      for (const rawItem of body.items) {
        if (
          typeof rawItem?.productId !== 'string' ||
          typeof rawItem?.variantId !== 'string' ||
          typeof rawItem?.quantity !== 'number' ||
          !Number.isInteger(rawItem.quantity) ||
          rawItem.quantity < 1 ||
          rawItem.quantity > 20
        ) {
          res.status(400).json({ error: 'Некорректные данные товара в заказе.' });
          return;
        }

        const entry = await resolveCatalogEntry(rawItem.productId, rawItem.variantId);
        if (!entry || !entry.variant.inStock) {
          res.status(400).json({ error: 'Один из выбранных товаров не найден или недоступен.' });
          return;
        }

        totalAmountRub += entry.variant.priceRub * rawItem.quantity;
        verifiedItems.push({
          productId: rawItem.productId,
          variantId: rawItem.variantId,
          title: entry.productTitle,
          platformLabel: entry.platformLabel,
          variantLabel: entry.variant.label,
          unitPriceRub: entry.variant.priceRub,
          quantity: rawItem.quantity,
        });
      }

      if (totalAmountRub <= 0) {
        res.status(400).json({ error: 'Неверная сумма заказа.' });
        return;
      }

      const config = getProviderConfig();
      const orderId = `CGS-${crypto.randomInt(100000, 999999)}`;
      const accessToken = crypto.randomBytes(24).toString('hex');

      const order: OrderRecord = {
        id: orderId,
        accessToken,
        status: 'pending',
        provider: config.activeProvider,
        paymentMethod,
        amountRub: totalAmountRub,
        items: verifiedItems,
        customerName,
        contact,
        accountStatus,
        turkAccountEmail: turkAccountEmail || undefined,
        createdAt: new Date().toISOString(),
      };

      const tbankCreds = getTbankCredentials();
      if (tbankCreds) {
        const baseUrl = resolvePublicBaseUrl(req);
        const returnUrl = `${baseUrl}/?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.accessToken)}`;
        const result = await createTbankPayment(order, baseUrl, returnUrl, tbankCreds);
        order.providerPaymentId = result.providerPaymentId;
        order.confirmationUrl = result.confirmationUrl;
        order.sbpQrPayload = result.sbpQrPayload;
      }

      pruneOrdersIfNeeded();
      orders.set(order.id, order);

      res.json({
        mode: config.isSandbox ? 'sandbox' : 'live',
        provider: config.activeProvider,
        providerLabel: config.providerLabel,
        orderId: order.id,
        accessToken: order.accessToken,
        amountRub: order.amountRub,
        paymentMethod: order.paymentMethod,
        confirmationUrl: order.confirmationUrl,
        sbpQrPayload: order.sbpQrPayload,
        items: order.items,
      });
    } catch (error) {
      console.error('Payment creation failed:', error);
      res.status(502).json({
        error:
          'Не удалось создать платёж в Т-Банк Эквайринг. Проверьте настройки терминала или напишите менеджеру в Telegram.',
      });
    }
  });

  app.get('/api/orders/:orderId', async (req: Request, res: Response) => {
    const orderId = String(req.params.orderId || '');
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const order = orders.get(orderId);

    if (!order || !token || !safeCompareStrings(token, order.accessToken)) {
      res.status(404).json({ error: 'Заказ не найден.' });
      return;
    }

    if (order.provider === 'tbank' && order.status === 'pending') {
      await syncTbankOrderStatus(order).catch((err) =>
        console.error('T-Bank GetState sync error:', err)
      );
    }

    res.json(sanitizeOrderForClient(order));
  });

  app.get('/api/admin/checkout-orders', async (req: Request, res: Response) => {
    const adminUser = await verifyAdminBearerToken(req);
    if (!adminUser) {
      res.status(403).json({ error: 'Доступ разрешён только администратору.' });
      return;
    }

    const list = Array.from(orders.values()).map((order) => ({
      ...sanitizeOrderForClient(order),
      contact: order.contact,
    }));
    res.json({ orders: list });
  });

  app.post('/api/payments/sandbox/confirm', (req: Request, res: Response) => {
    const config = getProviderConfig();
    if (!config.isSandbox) {
      res.status(403).json({ error: 'Тестовое подтверждение отключено в боевом режиме.' });
      return;
    }

    const { orderId, accessToken, action } = (req.body || {}) as {
      orderId?: unknown;
      accessToken?: unknown;
      action?: unknown;
    };

    if (typeof orderId !== 'string' || typeof accessToken !== 'string') {
      res.status(400).json({ error: 'Некорректные параметры запроса.' });
      return;
    }

    const order = orders.get(orderId);
    if (!order || !safeCompareStrings(accessToken, order.accessToken) || order.provider !== 'sandbox') {
      res.status(404).json({ error: 'Заказ не найден.' });
      return;
    }

    if (action === 'cancel') {
      order.status = 'cancelled';
    } else if (order.status === 'pending') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
    }

    res.json(sanitizeOrderForClient(order));
  });

  // T-Bank (Tinkoff) Acquiring NotificationURL webhook with SHA-256 Token verification
  app.post('/api/payments/webhook/tbank', (req: Request, res: Response) => {
    const creds = getTbankCredentials();
    if (!creds) {
      res.status(503).send('Not configured');
      return;
    }

    const payload = (req.body || {}) as Record<string, unknown>;
    const receivedToken = typeof payload.Token === 'string' ? payload.Token.toLowerCase() : '';
    const terminalKey = typeof payload.TerminalKey === 'string' ? payload.TerminalKey : '';

    if (!receivedToken || !safeCompareStrings(terminalKey, creds.terminalKey)) {
      res.status(403).send('Invalid terminal');
      return;
    }

    const expectedToken = generateTbankToken(payload, creds.password).toLowerCase();
    if (!safeCompareStrings(receivedToken, expectedToken)) {
      res.status(403).send('Invalid token');
      return;
    }

    const orderId = typeof payload.OrderId === 'string' ? payload.OrderId : '';
    const order = orders.get(orderId);
    if (order && order.provider === 'tbank') {
      const status = typeof payload.Status === 'string' ? payload.Status : '';
      const amountKopecks = Number(payload.Amount || 0);
      if (
        payload.Success === true &&
        status === 'CONFIRMED' &&
        amountKopecks === order.amountRub * 100
      ) {
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
      } else if (status === 'CANCELED' || status === 'REJECTED' || status === 'DEADLINE_EXPIRED') {
        order.status = 'cancelled';
      }
    }

    // T-Bank Acquiring strictly expects plain text "OK" with HTTP 200
    res.status(200).send('OK');
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CyberGameStore server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
