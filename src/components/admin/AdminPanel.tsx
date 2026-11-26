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
  Copy,
  Check,
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
  checkIsAdminUser,
  consumeGoogleRedirectResult,
  db,
  FIREBASE_AUTH_SETTINGS_URL,
  FIRESTORE_CONSOLE_UPGRADE_URL,
  FIRESTORE_PRICING_URL,
  handleFirestoreError,
  isBootstrapAdminEmail,
  isQuotaExceededError,
  OperationType,
  signInWithGoogle,
  signInWithGoogleRedirect,
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
  staticExtraProducts: StoreProduct[];
  staticExtraIdSet: Set<string>;
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

async function fetchOptionalJsonApi<T>(
  url: string,
  init?: RequestInit
): Promise<{ available: boolean; ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || res.status === 405 || !contentType.includes('application/json')) {
      return { available: false, ok: false, status: res.status };
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return {
      available: true,
      ok: res.ok,
      status: res.status,
      data,
      error: typeof data?.error === 'string' ? data.error : undefined,
    };
  } catch {
    return { available: false, ok: false, status: 0 };
  }
}

export function AdminPanel({
  staticExtraProducts,
  staticExtraIdSet,
  firestoreProducts,
  serverProducts,
  onRefreshServerProducts,
  onBackToStore,
}: AdminPanelProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorKind, setAuthErrorKind] = useState<'generic' | 'unauthorized-domain' | 'popup-blocked'>('generic');
  const [copiedDomain, setCopiedDomain] = useState(false);
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
  const [telegramStatus, setTelegramStatus] = useState<{
    available: boolean;
    hasBotToken: boolean;
    configured: boolean;
    chatCount: number;
    hasOnlyBotSelfId: boolean;
    notifyOnCreate: boolean;
  } | null>(null);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [detectingTelegram, setDetectingTelegram] = useState(false);
  const [detectedTelegramChats, setDetectedTelegramChats] = useState<
    Array<{ id: string; label: string; type: string }>
  >([]);
  const [telegramNotice, setTelegramNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    void consumeGoogleRedirectResult();
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

  // Load sales from server store (if running) + Firestore listener with quota/timeout failsafe
  useEffect(() => {
    if (!authReady || !user || !isAdmin) {
      setFirestoreSales([]);
      setServerSales([]);
      setSalesLoaded(false);
      setTelegramStatus(null);
      return;
    }

    let cancelled = false;
    let serverReady = false;
    let firestoreReady = false;
    let serverAvailable = false;
    let latestServerCount = 0;
    let latestFirestoreCount = 0;

    const maybeSeedInitialSales = async () => {
      if (cancelled || !serverReady || !firestoreReady || seededRef.current) return;
      if (latestServerCount > 0 || latestFirestoreCount > 0) return;

      seededRef.current = true;
      const initialRows = buildInitialMonthlySales(user.uid);

      // Seed to Firestore first so static hosting & all domains receive initial analytics
      try {
        const batch = writeBatch(db);
        for (const item of initialRows) {
          batch.set(doc(db, 'sales', item.id), {
            ...item,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        await withTimeout(batch.commit(), 8000);
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setFirestoreQuotaExceeded(true);
        }
      }

      if (serverAvailable && !cancelled) {
        try {
          const idToken = await user.getIdToken();
          const result = await fetchOptionalJsonApi<{ sales?: SaleRecord[] }>(
            '/api/admin/sales/batch',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ items: initialRows }),
            }
          );
          if (result.ok && Array.isArray(result.data?.sales) && !cancelled) {
            setServerSales(result.data.sales);
          }
        } catch {
          // Non-fatal
        }
      }
    };

    const loadServerSales = async () => {
      try {
        const idToken = await user.getIdToken();
        const result = await fetchOptionalJsonApi<{ sales?: SaleRecord[] }>('/api/admin/sales', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        serverAvailable = result.available;
        if (result.ok && !cancelled) {
          const rows = Array.isArray(result.data?.sales) ? result.data.sales : [];
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

    const loadTelegramStatus = async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetchOptionalJsonApi<{
          hasBotToken?: boolean;
          configured?: boolean;
          chatCount?: number;
          hasOnlyBotSelfId?: boolean;
          notifyOnCreate?: boolean;
        }>('/api/admin/telegram/status', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!cancelled) {
          setTelegramStatus({
            available: res.available,
            hasBotToken: Boolean(res.ok && res.data?.hasBotToken),
            configured: Boolean(res.ok && res.data?.configured),
            chatCount: typeof res.data?.chatCount === 'number' ? res.data.chatCount : 0,
            hasOnlyBotSelfId: Boolean(res.ok && res.data?.hasOnlyBotSelfId),
            notifyOnCreate: Boolean(res.data?.notifyOnCreate),
          });
        }
      } catch {
        if (!cancelled) {
          setTelegramStatus({
            available: false,
            hasBotToken: false,
            configured: false,
            chatCount: 0,
            hasOnlyBotSelfId: false,
            notifyOnCreate: false,
          });
        }
      }
    };

    void loadServerSales();
    void loadTelegramStatus();

    // Failsafe so Firestore backoff can never stall dashboard loading
    const failsafeTimer = window.setTimeout(() => {
      if (!cancelled && !firestoreReady) {
        firestoreReady = true;
        setSalesLoaded(true);
        void maybeSeedInitialSales();
      }
    }, 3500);

    const isBootstrap = isBootstrapAdminEmail(user.email);
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

  useEffect(() => {
    if (!authReady || !user || !isAdmin) return;
    if (activeTab !== 'overview' && activeTab !== 'sales') return;
    let cancelled = false;
    void user.getIdToken().then((idToken) =>
      fetchOptionalJsonApi<{ sales?: SaleRecord[] }>('/api/admin/sales', {
        headers: { Authorization: `Bearer ${idToken}` },
      }).then((result) => {
        if (!cancelled && result.ok && Array.isArray(result.data?.sales)) {
          setServerSales(result.data.sales);
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [activeTab, authReady, user, isAdmin]);

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
    () =>
      mergeCatalogProducts(
        combinedOverrides,
        true,
        staticExtraProducts,
        staticExtraIdSet
      ),
    [combinedOverrides, staticExtraProducts, staticExtraIdSet]
  );

  const existingCatalogIdSet = useMemo(
    () => new Set(allAdminProducts.map((p) => p.id)),
    [allAdminProducts]
  );

  const activeCatalogCount = useMemo(() => {
    let active = 0;
    for (const p of allAdminProducts) {
      if (!overrideMap.get(p.id)?.isHidden) active++;
    }
    return active;
  }, [allAdminProducts, overrideMap]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setAuthErrorKind('generic');
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      const msg = err instanceof Error ? err.message : String(err);

      if (code === 'auth/popup-closed-by-user' || msg.includes('popup-closed-by-user')) {
        return;
      }

      if (
        code === 'auth/unauthorized-domain' ||
        msg.includes('unauthorized-domain')
      ) {
        setAuthErrorKind('unauthorized-domain');
        setAuthError(
          `Домен «${window.location.hostname}» не добавлен в список разрешённых доменов Firebase Authentication.`
        );
        return;
      }

      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        msg.includes('popup-blocked')
      ) {
        setAuthErrorKind('popup-blocked');
        setAuthError(
          'Браузер заблокировал всплывающее окно Google. Разрешите всплывающие окна или используйте вход через перенаправление.'
        );
        return;
      }

      setAuthError(
        code
          ? `Ошибка входа через Google (${code}). Попробуйте ещё раз.`
          : 'Ошибка входа через Google. Попробуйте ещё раз.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleRedirectSignIn = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithGoogleRedirect();
    } catch {
      setSigningIn(false);
      setAuthError('Не удалось запустить перенаправление Google. Попробуйте обычный вход.');
    }
  };

  const handleCopyHostname = async () => {
    try {
      await navigator.clipboard.writeText(window.location.hostname);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSaveProduct = async (draft: ProductDraft) => {
    if (!user) return;
    const existing = overrideMap.get(draft.id);
    const idToken = await user.getIdToken();
    let savedInFirestore = false;
    let quotaHit = false;

    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(
          setDoc(doc(db, 'products', draft.id), {
            ...draft,
            createdBy: existing?.createdBy || user.uid,
            createdAt: existing?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          12000
        );
        savedInFirestore = true;
      } catch (error) {
        if (isQuotaExceededError(error)) {
          quotaHit = true;
          setFirestoreQuotaExceeded(true);
        } else {
          handleFirestoreError(
            error,
            existing ? OperationType.UPDATE : OperationType.CREATE,
            `products/${draft.id}`
          );
        }
      }
    } else {
      quotaHit = true;
    }

    // Also mirror to Express server if available (silently skipped on static hosting)
    const serverRes = await fetchOptionalJsonApi<{ ok?: boolean }>('/api/admin/catalog/item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(draft),
    });

    if (serverRes.available && !serverRes.ok) {
      throw new Error(serverRes.error || 'Не удалось сохранить товар на сервере.');
    }
    if (serverRes.ok) {
      await onRefreshServerProducts();
    }

    if (!savedInFirestore && !serverRes.ok) {
      if (quotaHit) {
        throw new Error(
          'Исчерпана дневная квота записей Firebase Firestore. Лимит обновится завтра — или увеличьте тариф базы данных в консоли Firebase.'
        );
      }
      throw new Error('Не удалось сохранить товар.');
    }

    showToast(
      existing ? `Товар «${draft.title}» обновлён` : `Товар «${draft.title}» добавлен на витрину`
    );
  };

  const handleImportProductsBatch = async (
    drafts: ProductDraft[],
    onProgress: (completed: number, total: number) => void
  ) => {
    if (!user || drafts.length === 0) return;
    const idToken = await user.getIdToken();

    // Probe whether Express backend exists (true in AI Studio / Node server, false on static hosting)
    const healthProbe = await fetchOptionalJsonApi<{ ok?: boolean }>('/api/health');
    const hasServerApi = healthProbe.available && healthProbe.ok;

    // For large catalogs on Node server, route via server to protect Firestore daily Spark quota.
    // For static hosting OR <= 450 items, write directly to Firestore so products appear everywhere.
    const shouldWriteFirestore = !hasServerApi || (drafts.length <= 450 && !firestoreQuotaExceeded);
    let completed = 0;
    let quotaHit = false;

    if (shouldWriteFirestore) {
      const FS_CHUNK = 150;
      for (let i = 0; i < drafts.length; i += FS_CHUNK) {
        const chunk = drafts.slice(i, i + FS_CHUNK);
        const batch = writeBatch(db);
        for (const draft of chunk) {
          const existing = overrideMap.get(draft.id);
          batch.set(doc(db, 'products', draft.id), {
            ...draft,
            createdBy: existing?.createdBy || user.uid,
            createdAt: existing?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        try {
          await withTimeout(batch.commit(), 15000);
          completed += chunk.length;
          onProgress(completed, drafts.length);
        } catch (error) {
          if (isQuotaExceededError(error)) {
            quotaHit = true;
            setFirestoreQuotaExceeded(true);
            break;
          }
          handleFirestoreError(error, OperationType.WRITE, 'products');
        }
      }
    }

    if (hasServerApi) {
      const SERVER_CHUNK = 1000;
      for (let i = 0; i < drafts.length; i += SERVER_CHUNK) {
        const chunk = drafts.slice(i, i + SERVER_CHUNK);
        const isLastChunk = i + SERVER_CHUNK >= drafts.length;
        const serverRes = await fetchOptionalJsonApi<{ ok?: boolean }>('/api/admin/catalog/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ items: chunk, flush: isLastChunk }),
        });

        if (!serverRes.ok) {
          throw new Error(serverRes.error || 'Ошибка сервера при импорте каталога.');
        }

        if (!shouldWriteFirestore || quotaHit) {
          completed = Math.max(completed, Math.min(drafts.length, i + chunk.length));
          onProgress(completed, drafts.length);
        }
      }
      await onRefreshServerProducts();
    } else if (quotaHit && completed < drafts.length) {
      throw new Error(
        `Загружено в Firestore: ${completed} из ${drafts.length}. Далее исчерпана дневная квота бесплатной базы Firebase Firestore (сбросится завтра).`
      );
    }

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
    if (!user || BUILTIN_PRODUCT_IDS.has(productId) || staticExtraIdSet.has(productId)) return;
    const idToken = await user.getIdToken();

    let deletedInFirestore = false;
    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(deleteDoc(doc(db, 'products', productId)), 10000);
        deletedInFirestore = true;
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setFirestoreQuotaExceeded(true);
        } else {
          handleFirestoreError(err, OperationType.DELETE, `products/${productId}`);
        }
      }
    }

    const serverRes = await fetchOptionalJsonApi<{ ok?: boolean }>(
      `/api/admin/catalog/item/${encodeURIComponent(productId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      }
    );
    if (serverRes.ok) {
      await onRefreshServerProducts();
    }

    if (!deletedInFirestore && !serverRes.ok) {
      showToast('Не удалось удалить товар: превышена дневная квота Firestore');
      return;
    }

    showToast('Товар удалён из каталога');
  };

  const persistSaleToServer = async (
    salePayload: Omit<SaleRecord, 'createdAt' | 'updatedAt'>
  ): Promise<boolean> => {
    if (!user) return false;
    const idToken = await user.getIdToken();
    const res = await fetchOptionalJsonApi<{ sale?: SaleRecord }>('/api/admin/sales/item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(salePayload),
    });

    if (!res.available) return false;
    if (!res.ok) {
      throw new Error(res.error || 'Не удалось сохранить продажу на сервере.');
    }
    if (res.data?.sale) {
      setServerSales((prev) => {
        const next = prev.filter((item) => item.id !== res.data!.sale!.id);
        return [...next, res.data!.sale!];
      });
    }
    return true;
  };

  const handleSaveSale = async (draft: SaleDraft, isEdit: boolean) => {
    if (!user) return;
    const existing = sales.find((s) => s.id === draft.id);
    const createdBy = existing?.createdBy || user.uid;
    let savedInFirestore = false;

    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(
          setDoc(doc(db, 'sales', draft.id), {
            ...draft,
            createdBy,
            createdAt: existing?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          10000
        );
        savedInFirestore = true;
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        } else {
          handleFirestoreError(
            error,
            isEdit ? OperationType.UPDATE : OperationType.CREATE,
            `sales/${draft.id}`
          );
        }
      }
    }

    const savedOnServer = await persistSaleToServer({ ...draft, createdBy });
    if (!savedInFirestore && !savedOnServer) {
      throw new Error('Исчерпана дневная квота Firebase Firestore. Попробуйте завтра.');
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

    let savedInFirestore = false;
    if (!firestoreQuotaExceeded) {
      try {
        await withTimeout(
          setDoc(doc(db, 'sales', sale.id), {
            ...updatedPayload,
            createdAt: sale.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          10000
        );
        savedInFirestore = true;
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        } else {
          handleFirestoreError(error, OperationType.UPDATE, `sales/${sale.id}`);
        }
      }
    }

    const savedOnServer = await persistSaleToServer(updatedPayload);
    if (!savedInFirestore && !savedOnServer) {
      showToast('Не удалось обновить статус: превышена дневная квота Firestore');
      return;
    }

    showToast(`Статус заказа ${sale.id} обновлён`);
  };

  const handleDeleteSale = async (saleId: string) => {
    if (!user) return;
    const idToken = await user.getIdToken();

    let deletedInFirestore = false;
    if (!firestoreQuotaExceeded && firestoreSales.some((s) => s.id === saleId)) {
      try {
        await withTimeout(deleteDoc(doc(db, 'sales', saleId)), 10000);
        deletedInFirestore = true;
      } catch (error) {
        if (isQuotaExceededError(error)) {
          setFirestoreQuotaExceeded(true);
        } else {
          handleFirestoreError(error, OperationType.DELETE, `sales/${saleId}`);
        }
      }
    }

    const serverRes = await fetchOptionalJsonApi<{ ok?: boolean }>(
      `/api/admin/sales/item/${encodeURIComponent(saleId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      }
    );
    if (serverRes.ok) {
      setServerSales((prev) => prev.filter((item) => item.id !== saleId));
    }

    if (!deletedInFirestore && !serverRes.ok) {
      showToast('Не удалось удалить запись: превышена дневная квота Firestore');
      return;
    }

    showToast(`Запись ${saleId} удалена`);
  };

  const handleSyncServerOrders = async () => {
    if (!user || syncingCheckout) return;
    setSyncingCheckout(true);
    setSyncNotice(null);
    try {
      const idToken = await user.getIdToken();
      const serverRes = await fetchOptionalJsonApi<{ orders?: ServerCheckoutOrder[] }>(
        '/api/admin/checkout-orders',
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      if (!serverRes.available) {
        setSyncNotice(
          'Сайт размещён на статическом хостинге без Node-сервера (/api). Заказы можно добавлять вручную.'
        );
        return;
      }
      if (!serverRes.ok) {
        setSyncNotice('Не удалось получить заказы с кассы сервера.');
        return;
      }
      const serverOrders = serverRes.data?.orders || [];
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

      const batchRes = await fetchOptionalJsonApi<{ sales?: SaleRecord[] }>(
        '/api/admin/sales/batch',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ items: freshSalePayloads }),
        }
      );
      if (batchRes.ok && Array.isArray(batchRes.data?.sales)) {
        setServerSales(batchRes.data.sales);
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
          await withTimeout(batch.commit(), 8000);
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

  const handleTestTelegram = async () => {
    if (!user || testingTelegram) return;
    setTestingTelegram(true);
    setTelegramNotice(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetchOptionalJsonApi<{ ok?: boolean; sentCount?: number; totalChats?: number }>(
        '/api/admin/telegram/test',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
      if (!res.available) {
        setTelegramNotice({
          ok: false,
          text: 'Сервер оплаты (/api) не подключён на этом хостинге.',
        });
        return;
      }
      if (!res.ok) {
        setTelegramNotice({
          ok: false,
          text: res.error || 'Не удалось отправить тестовое сообщение в Telegram.',
        });
        return;
      }
      setTelegramNotice({
        ok: true,
        text: `Тестовое уведомление доставлено в Telegram (чатов: ${res.data?.sentCount ?? 1}).`,
      });
    } catch {
      setTelegramNotice({
        ok: false,
        text: 'Ошибка соединения при отправке теста в Telegram.',
      });
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleDetectTelegramChats = async () => {
    if (!user || detectingTelegram) return;
    setDetectingTelegram(true);
    setTelegramNotice(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetchOptionalJsonApi<{
        chats?: Array<{ id: string; label: string; type: string }>;
      }>('/api/admin/telegram/detect-chat', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.available) {
        setTelegramNotice({ ok: false, text: 'Сервер оплаты (/api) не подключён.' });
        return;
      }
      if (!res.ok) {
        setTelegramNotice({
          ok: false,
          text: res.error || 'Не удалось опросить Telegram API.',
        });
        return;
      }
      const chats = Array.isArray(res.data?.chats) ? res.data.chats : [];
      setDetectedTelegramChats(chats);
      if (chats.length === 0) {
        setTelegramNotice({
          ok: false,
          text: 'Пока никто не писал боту. Откройте своего бота в Telegram, нажмите Start (/start) и повторите поиск.',
        });
      }
    } catch {
      setTelegramNotice({
        ok: false,
        text: 'Ошибка соединения при поиске Chat ID.',
      });
    } finally {
      setDetectingTelegram(false);
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
          <div className="bg-[#111111] text-white px-6 py-5 border-b border-neutral-800 flex items-center gap-3">
            <img
              src="/assets/aistudio/image_7c19fec9.png"
              alt="CyberGameStore"
              width={36}
              height={36}
              className="w-9 h-9 rounded-lg object-contain shrink-0"
            />
            <div>
              <div className="text-lg font-bold tracking-tight">CyberGameStore</div>
              <div className="text-xs text-neutral-400 mt-0.5">
                Панель управления магазином
              </div>
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
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-2.5">
                <p className="font-medium leading-relaxed">{authError}</p>

                {authErrorKind === 'unauthorized-domain' && (
                  <div className="space-y-2 pt-1 border-t border-red-200/80 text-neutral-800">
                    <p className="text-[11px] leading-relaxed">
                      Добавьте этот домен в Firebase Console (Authentication → Settings → Authorized domains):
                    </p>
                    <div className="flex items-center justify-between gap-2 bg-white border border-red-200 rounded px-2.5 py-1.5">
                      <code className="font-mono text-[11px] text-neutral-900 truncate">
                        {window.location.hostname}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopyHostname()}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-700 hover:text-black shrink-0 cursor-pointer"
                      >
                        {copiedDomain ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#52c44c]" />
                            <span>Скопировано</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Копировать</span>
                          </>
                        )}
                      </button>
                    </div>
                    <a
                      href={FIREBASE_AUTH_SETTINGS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-900 underline hover:text-black"
                    >
                      <span>Открыть настройки доменов Firebase Auth</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {authErrorKind === 'popup-blocked' && (
                  <button
                    type="button"
                    disabled={signingIn}
                    onClick={() => void handleGoogleRedirectSignIn()}
                    className="w-full py-2 px-3 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 rounded-md cursor-pointer"
                  >
                    Войти через перенаправление Google
                  </button>
                )}
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
    setEditingIsBuiltin(BUILTIN_PRODUCT_IDS.has(product.id) || staticExtraIdSet.has(product.id));
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
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/assets/aistudio/image_7c19fec9.png"
            alt="CyberGameStore"
            width={28}
            height={28}
            className="w-7 h-7 rounded-md object-contain shrink-0"
          />
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-white truncate">CyberGameStore</div>
            <div className="text-[11px] text-neutral-400">Панель управления</div>
          </div>
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
                  staticExtraIdSet={staticExtraIdSet}
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
                  telegramStatus={telegramStatus}
                  testingTelegram={testingTelegram}
                  detectingTelegram={detectingTelegram}
                  detectedTelegramChats={detectedTelegramChats}
                  telegramNotice={telegramNotice}
                  onAddSale={openCreateSale}
                  onEditSale={openEditSale}
                  onUpdateStatus={handleUpdateSaleStatus}
                  onDeleteSale={handleDeleteSale}
                  onSyncServerOrders={handleSyncServerOrders}
                  onTestTelegram={handleTestTelegram}
                  onDetectTelegramChats={handleDetectTelegramChats}
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
