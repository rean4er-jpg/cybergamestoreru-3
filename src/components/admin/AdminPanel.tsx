import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ExternalLink,
  FileJson,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAP_ADMIN_EMAIL,
  checkIsAdminUser,
  db,
  FIRESTORE_CONSOLE_UPGRADE_URL,
  FIRESTORE_PRICING_URL,
  handleFirestoreError,
  isQuotaExceededError,
  OperationType,
  signInWithGoogle,
  signOutAdmin,
  withTimeout,
} from '../../firebase';
import {
  buildInitialMonthlySales,
  BUILTIN_PRODUCT_IDS,
  combineProductOverrides,
  getTimestampMs,
  mergeCatalogProducts,
  storeProductToEditorDraft,
  type FirestoreProductDoc,
  type SaleRecord,
  type SaleStatus,
} from '../../data/adminCatalog';
import type { StoreProduct } from '../../data/storeData';
import { AdminOverview } from './AdminOverview';
import { AdminProductsTab } from './AdminProductsTab';
import { AdminSalesTab } from './AdminSalesTab';
import { ProductEditorModal, type ProductDraft } from './ProductEditorModal';
import { SaleEditorModal, type SaleDraft } from './SaleEditorModal';
import { CatalogImportModal } from './CatalogImportModal';

type AdminTab = 'overview' | 'products' | 'sales';

interface AdminPanelProps {
  firestoreProducts: FirestoreProductDoc[];
  serverProducts: FirestoreProductDoc[];
  onRefreshServerProducts: () => Promise<void>;
  onBackToStore: () => void;
}

interface ServerCheckoutOrder {
  id: string;
  status: 'pending' | 'paid' | 'cancelled';
  paymentMethod: 'sbp' | 'card';
  amountRub: number;
  customerName: string;
  contact?: string;
  accountStatus: string;
  createdAt: string;
  items: Array<{
    productId: string;
    title: string;
    platformLabel: string;
    unitPriceRub: number;
    quantity: number;
  }>;
}

export function AdminPanel({
  firestoreProducts,
  serverProducts,
  onRefreshServerProducts,
  onBackToStore,
}: AdminPanelProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [firestoreSales, setFirestoreSales] = useState<SaleRecord[]>([]);
  const [serverSales, setServerSales] = useState<SaleRecord[]>([]);
  const [salesLoaded, setSalesLoaded] = useState(false);
  const [firestoreQuotaExceeded, setFirestoreQuotaExceeded] = useState(false);
  const seededRef = useRef(false);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProductDraft, setEditingProductDraft] = useState<ProductDraft | null>(null);
  const [editingIsBuiltin, setEditingIsBuiltin] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);

  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [editingSaleDraft, setEditingSaleDraft] = useState<SaleDraft | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [syncingCheckout, setSyncingCheckout] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        const ok = await checkIsAdminUser(nextUser);
        setIsAdmin(ok);
      } else {
        setIsAdmin(false);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Load sales from server store + Firestore listener with quota/timeout failsafe
  useEffect(() => {
    if (!authReady || !user || !isAdmin) {
      setFirestoreSales([]);
      setServerSales([]);
      setSalesLoaded(false);
      return;
    }

    let cancelled = false;
    let serverReady = false;
    let firestoreReady = false;
    let latestServerCount = 0;
    let latestFirestoreCount = 0;

    const maybeSeedInitialSales = async () => {
      if (cancelled || !serverReady || !firestoreReady || seededRef.current) return;
      if (latestServerCount > 0 || latestFirestoreCount > 0) return;

      seededRef.current = true;
      const initialRows = buildInitialMonthlySales(user.uid);
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/admin/sales/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ items: initialRows }),
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { sales?: SaleRecord[] };
          if (Array.isArray(data.sales)) {
            setServerSales(data.sales);
          }
        }
      } catch {
        // Non-fatal: admin can still create sales manually
      }
    };

    const loadServerSales = async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/admin/sales', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { sales?: SaleRecord[] };
          const rows = Array.isArray(data.sales) ? data.sales : [];
          latestServerCount = rows.length;
          setServerSales(rows);
        }
      } catch {
        // Ignore transient network error
      } finally {
        if (!cancelled) {
          serverReady = true;
          setSalesLoaded(true);
          void maybeSeedInitialSales();
        }
      }
    };

    void loadServerSales();

    // Failsafe so Firestore backoff can never stall dashboard loading
    const failsafeTimer = window.setTimeout(() => {
      if (!cancelled && !firestoreReady) {
        firestoreReady = true;
        setSalesLoaded(true);
        void maybeSeedInitialSales();
      }
    }, 3500);

    const isBootstrap = user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
    const salesRef = isBootstrap
      ? collection(db, 'sales')
      : query(collection(db, 'sales'), where('createdBy', '==', user.uid));

    const unsubscribe = onSnapshot(
      salesRef,
      (snapshot) => {
        if (cancelled) return;
        const rows: SaleRecord[] = snapshot.docs.map((d) => d.data() as SaleRecord);
        latestFirestoreCount = rows.length;
        firestoreReady = true;
        setFirestoreSales(rows);
        setSalesLoaded(true);
        void maybeSeedInitialSales();
      },
      (error) => {
        if (cancelled) return;
        firestoreReady = true;
        setSalesLoaded(true);
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
          void maybeSeedInitialSales();
          return;
        }
        handleFirestoreError(error, OperationType.LIST, 'sales');
      }
    );

    return () => {
      cancelled = true;
      window.clearTimeout(failsafeTimer);
      unsubscribe();
    };
  }, [authReady, user, isAdmin]);

  const sales = useMemo(() => {
    const byId = new Map<string, SaleRecord>();
    for (const s of firestoreSales) {
      byId.set(s.id, s);
    }
    for (const s of serverSales) {
      const existing = byId.get(s.id);
      if (!existing || getTimestampMs(s.updatedAt) >= getTimestampMs(existing.updatedAt)) {
        byId.set(s.id, s);
      }
    }
    return Array.from(byId.values());
  }, [firestoreSales, serverSales]);

  const combinedOverrides = useMemo(
    () => combineProductOverrides(firestoreProducts, serverProducts),
    [firestoreProducts, serverProducts]
  );

  const overrideMap = useMemo(() => {
    const m = new Map<string, FirestoreProductDoc>();
    for (const docData of combinedOverrides) {
      m.set(docData.id, docData);
    }
    return m;
  }, [combinedOverrides]);

  const allAdminProducts = useMemo(
    () => mergeCatalogProducts(combinedOverrides, true),
    [combinedOverrides]
  );

  const existingCatalogIdSet = useMemo(
    () => new Set(allAdminProducts.map((p) => p.id)),
    [allAdminProducts]
  );

  const activeCatalogCount = useMemo(
    () => mergeCatalogProducts(combinedOverrides, false).length,
    [combinedOverrides]
  );

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось выполнить вход.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Ошибка входа через Google. Попробуйте ещё раз.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSaveProduct = async (draft: ProductDraft) => {
    if (!user) return;
    const existing = overrideMap.get(draft.id);
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/catalog/item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Не удалось сохранить товар на сервере.');
    }
    await onRefreshServerProducts();
    showToast(existing ? `Товар «${draft.title}» обновлён` : `Товар «${draft.title}» добавлен на витрину`);
  };

  const handleImportProductsBatch = async (
    drafts: ProductDraft[],
    onProgress: (completed: number, total: number) => void
  ) => {
    if (!user || drafts.length === 0) return;
    const idToken = await user.getIdToken();
    const CHUNK_SIZE = 1000;
    let completed = 0;

    for (let i = 0; i < drafts.length; i += CHUNK_SIZE) {
      const chunk = drafts.slice(i, i + CHUNK_SIZE);
      const isLastChunk = i + CHUNK_SIZE >= drafts.length;
      const res = await fetch('/api/admin/catalog/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ items: chunk, flush: isLastChunk }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Ошибка сервера при импорте каталога.');
      }

      completed += chunk.length;
      onProgress(completed, drafts.length);
    }

    await onRefreshServerProducts();
    showToast(`Импортировано товаров из JSON: ${drafts.length.toLocaleString('ru-RU')}`);
  };

  const handleQuickPriceSave = async (
    product: StoreProduct,
    nextPrice: number,
    nextOldPrice: number
  ) => {
    const baseDraft = storeProductToEditorDraft(product, overrideMap.get(product.id));
    await handleSaveProduct({
      ...baseDraft,
      priceRub: nextPrice,
      oldPriceRub: nextOldPrice,
    });
  };

  const handleToggleHidden = async (product: StoreProduct, nextHidden: boolean) => {
    const baseDraft = storeProductToEditorDraft(product, overrideMap.get(product.id));
    await handleSaveProduct({
      ...baseDraft,
      isHidden: nextHidden,
    });
  };

  const handleDeleteCustomProduct = async (productId: string) => {
    if (!user || BUILTIN_PRODUCT_IDS.has(productId)) return;
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/admin/catalog/item/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(body.error || 'Не удалось удалить товар');
      return;
    }

    // Best-effort cleanup if the custom item had been saved earlier in Firestore
    if (!firestoreQuotaExceeded && firestoreProducts.some((p) => p.id === productId)) {
      void withTimeout(deleteDoc(doc(db, 'products', productId)), 4000).catch((err) => {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true);
      });
    }

    await onRefreshServerProducts();
    showToast('Товар удалён из каталога');
  };

  const persistSaleToServer = async (salePayload: Omit<SaleRecord, 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    const idToken = await user.getIdToken();
    const res = await fetch('/api/admin/sales/item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(salePayload),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Не удалось сохранить продажу на сервере.');
    }
    const data = (await res.json()) as { sale?: SaleRecord };
    if (data.sale) {
      setServerSales((prev) => {
        const next = prev.filter((item) => item.id !== data.sale!.id);
        return [...next, data.sale!];
      });
    }
  };

  const handleSaveSale = async (draft: SaleDraft, isEdit: boolean) => {
    if (!user) return;
    const existing = sales.find((s) => s.id === draft.id);
    const createdBy = existing?.createdBy || user.uid;

    // 1. Always save to server store immediately (works even when Firestore daily quota is exhausted)
    await persistSaleToServer({ ...draft, createdBy });

    // 2. Mirror to Firestore when daily quota is available
    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(
          setDoc(doc(db, 'sales', draft.id), {
            ...draft,
            createdBy,
            createdAt: existing?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          5000
        );
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        }
      }
    }

    showToast(isEdit ? `Заказ ${draft.id} обновлён` : `Продажа ${draft.id} добавлена`);
  };

  const handleUpdateSaleStatus = async (sale: SaleRecord, nextStatus: SaleStatus) => {
    if (!user) return;
    const updatedPayload: Omit<SaleRecord, 'createdAt' | 'updatedAt'> = {
      id: sale.id,
      orderDate: sale.orderDate,
      productId: sale.productId,
      productTitle: sale.productTitle,
      platformGroup: sale.platformGroup,
      categoryType: sale.categoryType,
      quantity: sale.quantity,
      unitPriceRub: sale.unitPriceRub,
      totalRub: sale.totalRub,
      status: nextStatus,
      channel: sale.channel,
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName,
      customerContact: sale.customerContact,
      note: sale.note,
      createdBy: sale.createdBy,
    };

    await persistSaleToServer(updatedPayload);

    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(
          setDoc(doc(db, 'sales', sale.id), {
            ...updatedPayload,
            createdAt: sale.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          5000
        );
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        }
      }
    }

    showToast(`Статус заказа ${sale.id} обновлён`);
  };

  const handleDeleteSale = async (saleId: string) => {
    if (!user) return;
    const idToken = await user.getIdToken();
    await fetch(`/api/admin/sales/item/${encodeURIComponent(saleId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    setServerSales((prev) => prev.filter((item) => item.id !== saleId));

    if (!firestoreQuotaExceeded && firestoreSales.some((s) => s.id === saleId)) {
      try {
        await withTimeout(deleteDoc(doc(db, 'sales', saleId)), 5000);
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        }
      }
    }

    showToast(`Запись ${saleId} удалена`);
  };

  const handleSyncServerOrders = async () => {
    if (!user || syncingCheckout) return;
    setSyncingCheckout(true);
    setSyncNotice(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/checkout-orders', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        setSyncNotice('Не удалось получить заказы с кассы сервера.');
        return;
      }
      const data = (await res.json()) as { orders?: ServerCheckoutOrder[] };
      const serverOrders = data.orders || [];
      const existingIds = new Set(sales.map((s) => s.id));
      const freshOrders = serverOrders.filter((o) => !existingIds.has(o.id));

      if (freshOrders.length === 0) {
        setSyncNotice('Все заказы из кассы сайта уже синхронизированы.');
        return;
      }

      const freshSalePayloads: Omit<SaleRecord, 'createdAt' | 'updatedAt'>[] = freshOrders.map(
        (ord) => {
          const firstItem = ord.items[0];
          const totalQty = ord.items.reduce((sum, i) => sum + i.quantity, 0);
          const title =
            ord.items.length > 1
              ? `${firstItem?.title || 'Заказ'} (+ ещё ${ord.items.length - 1})`
              : firstItem?.title || 'Заказ с сайта';
          const isPs = /playstation|ps4|ps5/i.test(firstItem?.platformLabel || '');
          const isSub = /game pass|подписк/i.test(title);

          return {
            id: ord.id,
            orderDate: (ord.createdAt || new Date().toISOString()).slice(0, 10),
            productId: firstItem?.productId || 'site-order',
            productTitle: title.slice(0, 160),
            platformGroup: isPs ? 'ps' : 'xbox',
            categoryType: isSub ? 'subscriptions' : 'games',
            quantity: Math.max(1, Math.min(100, totalQty)),
            unitPriceRub: Math.max(1, Math.round(ord.amountRub / Math.max(1, totalQty))),
            totalRub: Math.max(1, Math.round(ord.amountRub)),
            status: ord.status,
            channel: 'site',
            paymentMethod: ord.paymentMethod,
            customerName: (ord.customerName || 'Покупатель').slice(0, 120),
            customerContact: (ord.contact || '').slice(0, 160),
            note: (ord.accountStatus || 'Заказ через корзину сайта').slice(0, 400),
            createdBy: user.uid,
          };
        }
      );

      const batchRes = await fetch('/api/admin/sales/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ items: freshSalePayloads }),
      });
      if (batchRes.ok) {
        const saved = (await batchRes.json()) as { sales?: SaleRecord[] };
        if (Array.isArray(saved.sales)) {
          setServerSales(saved.sales);
        }
      }

      if (!firestoreQuotaExceeded) {
        try {
          const batch = writeBatch(db);
          for (const item of freshSalePayloads) {
            batch.set(doc(db, 'sales', item.id), {
              ...item,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          await withTimeout(batch.commit(), 5000);
        } catch (err) {
          if (isQuotaExceededError(err)) {
            setFirestoreQuotaExceeded(true);
          }
        }
      }

      setSyncNotice(`Импортировано новых заказов с сайта: ${freshOrders.length}`);
    } catch {
      setSyncNotice('Не удалось синхронизировать заказы с сервером.');
    } finally {
      setSyncingCheckout(false);
    }
  };

  // Loading auth state
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-neutral-600">
          <Loader2 className="w-5 h-5 text-[#52c44c] animate-spin" />
          <span>Проверка прав администратора...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Sign-In Gate
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-xs">
          <div className="bg-[#111111] text-white px-6 py-5 border-b border-neutral-800">
            <div className="text-lg font-bold tracking-tight">CyberGameStore</div>
            <div className="text-xs text-neutral-400 mt-0.5">
              Панель управления магазином
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold italic text-neutral-900">
                Вход для администратора
              </h1>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Авторизуйтесь через Google-аккаунт владельца магазина, чтобы добавлять и редактировать
                товары, загружать обложки, менять цены и смотреть статистику выручки.
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {authError}
              </div>
            )}

            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleGoogleSignIn()}
              className="w-full py-3 px-5 inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>{signingIn ? 'Выполняется вход...' : 'Войти через Google'}</span>
            </button>

            <button
              type="button"
              onClick={onBackToStore}
              className="w-full py-2.5 px-4 inline-flex items-center justify-center gap-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Вернуться на витрину магазина</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Signed in, but not an authorized admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F6F8] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-neutral-900">Доступ ограничен</h1>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Аккаунт <span className="font-mono font-semibold text-neutral-900">{user.email}</span>{' '}
                не имеет прав администратора CyberGameStore. Войдите с аккаунта владельца магазина.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
            <button
              type="button"
              onClick={async () => {
                await signOutAdmin();
                await handleGoogleSignIn();
              }}
              className="flex-1 py-2.5 px-4 text-sm font-semibold text-white bg-[#111111] hover:bg-neutral-800 rounded-lg cursor-pointer"
            >
              Сменить аккаунт
            </button>
            <button
              type="button"
              onClick={onBackToStore}
              className="py-2.5 px-4 text-sm font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
            >
              На витрину
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: typeof BarChart3;
    count?: number;
  }> = [
    { id: 'overview', label: 'Обзор и выручка', icon: BarChart3 },
    { id: 'products', label: 'Товары и цены', icon: Package, count: allAdminProducts.length },
    { id: 'sales', label: 'Продажи и заказы', icon: Receipt, count: sales.length },
  ];

  const activeBreadcrumb =
    activeTab === 'overview'
      ? 'Обзор и выручка за месяц'
      : activeTab === 'products'
        ? 'Управление товарами и ценами'
        : 'Продажи и заказы';

  const openCreateProduct = () => {
    setEditingProductDraft(null);
    setEditingIsBuiltin(false);
    setProductModalOpen(true);
  };

  const openEditProduct = (product: StoreProduct) => {
    setEditingProductDraft(storeProductToEditorDraft(product, overrideMap.get(product.id)));
    setEditingIsBuiltin(BUILTIN_PRODUCT_IDS.has(product.id));
    setProductModalOpen(true);
  };

  const openCreateSale = () => {
    setEditingSaleDraft(null);
    setSaleModalOpen(true);
  };

  const openEditSale = (sale: SaleRecord) => {
    setEditingSaleDraft({
      id: sale.id,
      orderDate: sale.orderDate,
      productId: sale.productId,
      productTitle: sale.productTitle,
      platformGroup: sale.platformGroup,
      categoryType: sale.categoryType,
      quantity: sale.quantity,
      unitPriceRub: sale.unitPriceRub,
      totalRub: sale.totalRub,
      status: sale.status,
      channel: sale.channel,
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName,
      customerContact: sale.customerContact,
      note: sale.note,
    });
    setSaleModalOpen(true);
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#111111] text-white">
      <div className="px-5 h-16 flex items-center justify-between border-b border-neutral-800 shrink-0">
        <div>
          <div className="text-base font-bold tracking-tight text-white">CyberGameStore</div>
          <div className="text-[11px] text-neutral-400">Панель управления</div>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Закрыть боковое меню"
          className="lg:hidden p-1.5 text-neutral-400 hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav aria-label="Разделы админки" className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-[#52c44c] text-black font-semibold'
                  : 'text-neutral-300 hover:bg-neutral-800/80 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.count === 'number' && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-black/80' : 'text-neutral-500'
                  }`}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-neutral-800 space-y-2">
        <button
          type="button"
          onClick={onBackToStore}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-neutral-200 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-[#52c44c]" />
          <span>Открыть витрину магазина</span>
        </button>

        <div className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-neutral-200 font-medium truncate">
              <ShieldCheck className="w-3.5 h-3.5 text-[#52c44c] shrink-0" />
              <span className="truncate">{user.displayName || 'Администратор'}</span>
            </div>
            <div className="text-[11px] text-neutral-500 truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => void signOutAdmin()}
            title="Выйти из аккаунта"
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F6F8] text-[#1a1a1a] flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen border-r border-neutral-800">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-black/60"
          onClick={() => setMobileNavOpen(false)}
        >
          <div className="w-64 h-full" onClick={(e) => e.stopPropagation()}>
            {renderSidebarContent()}
          </div>
        </div>
      )}

      {/* Main Workspace Canvas */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Contextual Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-neutral-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Открыть меню админки"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-neutral-400 hidden sm:inline whitespace-nowrap">
                Панель управления
              </span>
              <span className="text-neutral-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-bold italic text-neutral-900 truncate">{activeBreadcrumb}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold text-neutral-800 bg-white border border-neutral-200 hover:border-[#52c44c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileJson className="w-4 h-4 text-[#52c44c]" />
              <span className="hidden sm:inline">Импорт JSON</span>
            </button>
            <button
              type="button"
              onClick={openCreateProduct}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить товар</span>
            </button>
          </div>
        </header>

        {toastMessage && (
          <div className="bg-[#111111] text-white text-xs px-6 py-2.5 border-b border-neutral-800 flex items-center justify-between">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-neutral-400 hover:text-white cursor-pointer"
            >
              Закрыть
            </button>
          </div>
        )}

        {firestoreQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-3 text-xs text-amber-950">
            <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong className="font-semibold">
                    Исчерпана дневная бесплатная квота записей Firebase Firestore.
                  </strong>{' '}
                  Лимит обновится завтра. Массовый импорт JSON, редактирование товаров и учёт продаж
                  продолжают работать без задержек через хранилище сервера.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0 font-semibold">
                <a
                  href={FIRESTORE_CONSOLE_UPGRADE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-amber-900 underline hover:text-black whitespace-nowrap"
                >
                  <span>Увеличить лимит БД</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <a
                  href={FIRESTORE_PRICING_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-amber-800 underline hover:text-black whitespace-nowrap"
                >
                  <span>Квоты Spark / Enterprise</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {!salesLoaded ? (
            <div className="py-16 flex items-center justify-center gap-3 text-sm text-neutral-500">
              <Loader2 className="w-5 h-5 text-[#52c44c] animate-spin" />
              <span>Загрузка данных магазина...</span>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <AdminOverview
                  sales={sales}
                  activeCatalogCount={activeCatalogCount}
                  customOverridesCount={combinedOverrides.length}
                  onOpenAddProduct={openCreateProduct}
                  onOpenAddSale={openCreateSale}
                  onSwitchTab={(next) => setActiveTab(next)}
                />
              )}

              {activeTab === 'products' && (
                <AdminProductsTab
                  allProducts={allAdminProducts}
                  overrideMap={overrideMap}
                  onAddProduct={openCreateProduct}
                  onImportJson={() => setImportModalOpen(true)}
                  onEditProduct={openEditProduct}
                  onQuickPriceSave={handleQuickPriceSave}
                  onToggleHidden={handleToggleHidden}
                  onDeleteCustomProduct={handleDeleteCustomProduct}
                />
              )}

              {activeTab === 'sales' && (
                <AdminSalesTab
                  sales={sales}
                  syncingCheckout={syncingCheckout}
                  syncNotice={syncNotice}
                  onAddSale={openCreateSale}
                  onEditSale={openEditSale}
                  onUpdateStatus={handleUpdateSaleStatus}
                  onDeleteSale={handleDeleteSale}
                  onSyncServerOrders={handleSyncServerOrders}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Product Add / Edit Modal */}
      <ProductEditorModal
        isOpen={productModalOpen}
        initialDraft={editingProductDraft}
        isEditingBuiltin={editingIsBuiltin}
        onClose={() => setProductModalOpen(false)}
        onSave={handleSaveProduct}
      />

      {/* Bulk JSON Catalog Import Modal */}
      <CatalogImportModal
        isOpen={importModalOpen}
        existingProductIds={existingCatalogIdSet}
        onClose={() => setImportModalOpen(false)}
        onImportBatch={handleImportProductsBatch}
      />

      {/* Sale Add / Edit Modal */}
      <SaleEditorModal
        isOpen={saleModalOpen}
        initialSale={editingSaleDraft}
        catalogProducts={allAdminProducts}
        onClose={() => setSaleModalOpen(false)}
        onSave={handleSaveSale}
      />
    </div>
  );
}
