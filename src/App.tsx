import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  RotateCcw,
  Search,
  ShoppingBag,
  Star,
} from 'lucide-react';
import {
  FAQ_ITEMS,
  type DeliveryFormatFilter,
  type PlatformFilter,
  type ProductVariant,
  type StoreProduct,
} from './data/storeData';
import {
  combineProductOverrides,
  computeCatalogStats,
  DEFAULT_DELTA_CUTOFF_ISO,
  loadStaticExtraCatalog,
  mergeCatalogProducts,
  type FirestoreProductDoc,
} from './data/adminCatalog';
import { db, isQuotaExceededError } from './firebase';
import { Header, type AppRoute } from './components/Header';
import { ResilientImage } from './components/ResilientImage';
import { ProductModal } from './components/ProductModal';
import { LegalViews } from './components/LegalViews';
import { CartDrawer, type CartItem } from './components/CartDrawer';
import { PaymentModal, type OrderReceipt } from './components/PaymentModal';
import { MyOrdersModal } from './components/MyOrdersModal';
import { AdminPanel } from './components/admin/AdminPanel';
import { loadSavedOrders, upsertSavedOrder } from './data/orderHistory';
import {
  buildRoutePath,
  getRouteSeoMetadata,
  parsePathname,
  SITE_LOGO_PATH,
  type SeoPlatformFilter,
} from './data/seoRoutes';

type SortOption = 'featured' | 'price-asc' | 'price-desc' | 'discount' | 'title-asc';
type PriceRangeFilter = 'all' | 'under-2000' | '2000-5000' | 'over-5000';

const ITEMS_PER_PAGE = 24;

function getInitialParsedUrl() {
  if (typeof window === 'undefined') {
    return { route: 'home' as AppRoute, platform: 'all' as PlatformFilter, productId: undefined };
  }
  return parsePathname(window.location.pathname, window.location.hash);
}

function setHeadMetaTag(attr: 'name' | 'property', key: string, content: string) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonicalLink(href: string) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export default function App() {
  const initialParsed = useMemo(() => getInitialParsedUrl(), []);
  const [route, setRoute] = useState<AppRoute>(initialParsed.route);
  const [staticExtraProducts, setStaticExtraProducts] = useState<StoreProduct[]>([]);
  const [staticExtraIdSet, setStaticExtraIdSet] = useState<Set<string>>(() => new Set());
  const [deltaCutoffIso, setDeltaCutoffIso] = useState<string>(DEFAULT_DELTA_CUTOFF_ISO);
  const [firestoreProducts, setFirestoreProducts] = useState<FirestoreProductDoc[]>([]);
  const [serverProducts, setServerProducts] = useState<FirestoreProductDoc[]>([]);
  const [activeProduct, setActiveProduct] = useState<StoreProduct | null>(null);
  const [pendingUrlProductId, setPendingUrlProductId] = useState<string | null>(
    initialParsed.productId || null
  );

  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(initialParsed.platform);
  const latestPlatformRef = useRef<SeoPlatformFilter>(initialParsed.platform);
  const [formatFilter, setFormatFilter] = useState<DeliveryFormatFilter>('all');
  const [priceRange, setPriceRange] = useState<PriceRangeFilter>('all');
  const [onlyRussian, setOnlyRussian] = useState(false);
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('featured');
  const [currentPage, setCurrentPage] = useState(1);
  const [openFaqId, setOpenFaqId] = useState<string>(FAQ_ITEMS[0].id);

  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [lastAddedTitle, setLastAddedTitle] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<OrderReceipt | null>(null);
  const [savedOrders, setSavedOrders] = useState<OrderReceipt[]>(() => loadSavedOrders());
  const [myOrdersOpen, setMyOrdersOpen] = useState(false);
  const [recentPaidBannerId, setRecentPaidBannerId] = useState<string | null>(null);

  const recordOrder = useCallback((order: OrderReceipt) => {
    setSavedOrders((prev) => upsertSavedOrder(prev, order));
  }, []);

  const recordOrdersBatch = useCallback((ordersToSave: OrderReceipt[]) => {
    setSavedOrders((prev) => {
      let next = prev;
      for (const ord of ordersToSave) {
        next = upsertSavedOrder(next, ord);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('orderId');
    const token = params.get('token');
    if (!orderId || !token) return;

    fetch(`/api/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((order: OrderReceipt | null) => {
        if (order) {
          const withToken = { ...order, accessToken: token };
          setActiveOrder(withToken);
          recordOrder(withToken);
          if (order.status === 'paid') {
            setCartItems([]);
          }
        }
      })
      .catch(() => {
        // Ignore network error on return URL sync
      })
      .finally(() => {
        window.history.replaceState({}, '', window.location.pathname);
      });
  }, [recordOrder]);

  useEffect(() => {
    const syncRoute = () => {
      const parsed = parsePathname(window.location.pathname, window.location.hash);
      setRoute(parsed.route);
      latestPlatformRef.current = parsed.platform;
      if (parsed.route === 'catalog' || parsed.route === 'home') {
        setPlatformFilter(parsed.platform);
      }
      if (parsed.productId) {
        setPendingUrlProductId(parsed.productId);
      } else {
        setPendingUrlProductId(null);
        setActiveProduct(null);
      }
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  const refreshServerProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/catalog/custom');
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) return;
      const data = (await res.json()) as { products?: FirestoreProductDoc[] };
      if (Array.isArray(data.products)) {
        setServerProducts(data.products);
      }
    } catch {
      // Non-fatal: static hosting or offline backend falls back to Firestore + static catalog
    }
  }, []);

  // Load server-persisted custom/imported catalog on mount (when Node backend is running)
  useEffect(() => {
    void refreshServerProducts();
  }, [refreshServerProducts]);

  // Load 27k pre-built static catalog chunks in parallel (0 Firestore reads)
  useEffect(() => {
    let cancelled = false;
    void loadStaticExtraCatalog().then((loaded) => {
      if (cancelled) return;
      if (loaded.products.length > 0) {
        setStaticExtraProducts(loaded.products);
        setStaticExtraIdSet(loaded.idSet);
      }
      if (loaded.deltaCutoffIso) {
        setDeltaCutoffIso(loaded.deltaCutoffIso);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real-time stream ONLY for delta Firestore overrides & newly added items after cutoff
  useEffect(() => {
    const parsedMs = Date.parse(deltaCutoffIso);
    const cutoffTs = Timestamp.fromDate(
      new Date(Number.isFinite(parsedMs) ? parsedMs : Date.parse(DEFAULT_DELTA_CUTOFF_ISO))
    );
    const q = query(collection(db, 'products'), where('updatedAt', '>', cutoffTs));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setFirestoreProducts(snapshot.docs.map((d) => d.data() as FirestoreProductDoc));
      },
      (err) => {
        if (!isQuotaExceededError(err)) {
          console.warn('Public products snapshot notice:', err);
        }
      }
    );
    return () => unsubscribe();
  }, [deltaCutoffIso]);

  const combinedOverrides = useMemo(
    () => combineProductOverrides(firestoreProducts, serverProducts),
    [firestoreProducts, serverProducts]
  );

  const storefrontProducts = useMemo(
    () =>
      mergeCatalogProducts(
        combinedOverrides,
        false,
        staticExtraProducts,
        staticExtraIdSet
      ),
    [combinedOverrides, staticExtraProducts, staticExtraIdSet]
  );

  const catalogStats = useMemo(
    () => computeCatalogStats(storefrontProducts),
    [storefrontProducts]
  );

  // Resolve /game/:id deep link once catalog products are ready
  useEffect(() => {
    if (!pendingUrlProductId || storefrontProducts.length === 0) return;
    const match = storefrontProducts.find((p) => p.id === pendingUrlProductId);
    if (match) {
      setActiveProduct(match);
      setPendingUrlProductId(null);
    }
  }, [pendingUrlProductId, storefrontProducts]);

  // Dynamically update document <head> SEO tags, canonical URL, OG image, and Product/Breadcrumb JSON-LD
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    const defaultImage = `${origin}${SITE_LOGO_PATH}`;

    if (activeProduct) {
      const firstVariant = activeProduct.variants[0];
      const minPrice = activeProduct.variants.reduce(
        (min, v) => (v.priceRub < min ? v.priceRub : min),
        firstVariant?.priceRub || 0
      );
      const title = `${activeProduct.title} (${activeProduct.platformLabel}) — купить | CyberGameStore`;
      const descSource =
        activeProduct.shortDescription ||
        `${activeProduct.title} для ${activeProduct.platformLabel} на турецкий аккаунт за ${minPrice.toLocaleString('ru-RU')} ₽. Быстрая официальная доставка за 5–15 минут.`;
      const description = descSource.length > 160 ? `${descSource.slice(0, 157)}...` : descSource;
      const canonicalUrl = `${origin}${buildRoutePath('home', 'all', activeProduct.id)}`;
      const ogImage = activeProduct.image?.startsWith('http')
        ? activeProduct.image
        : activeProduct.image?.startsWith('/')
          ? `${origin}${activeProduct.image}`
          : defaultImage;

      document.title = title;
      setHeadMetaTag('name', 'description', description);
      setHeadMetaTag('name', 'robots', 'index, follow');
      setCanonicalLink(canonicalUrl);
      setHeadMetaTag('property', 'og:type', 'product');
      setHeadMetaTag('property', 'og:title', title);
      setHeadMetaTag('property', 'og:description', description);
      setHeadMetaTag('property', 'og:url', canonicalUrl);
      setHeadMetaTag('property', 'og:image', ogImage);
      setHeadMetaTag('name', 'twitter:title', title);
      setHeadMetaTag('name', 'twitter:description', description);
      setHeadMetaTag('name', 'twitter:image', ogImage);

      const catPath =
        activeProduct.categoryType === 'subscriptions'
          ? '/subscriptions'
          : activeProduct.platformGroup === 'ps'
            ? '/playstation'
            : '/xbox';
      const catName =
        activeProduct.categoryType === 'subscriptions'
          ? 'Подписки'
          : activeProduct.platformGroup === 'ps'
            ? 'Игры PlayStation'
            : 'Игры Xbox';

      let ldScript = document.getElementById('cgs-dynamic-jsonld') as HTMLScriptElement | null;
      if (!ldScript) {
        ldScript = document.createElement('script');
        ldScript.id = 'cgs-dynamic-jsonld';
        ldScript.type = 'application/ld+json';
        document.head.appendChild(ldScript);
      }
      ldScript.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Product',
            name: activeProduct.title,
            description,
            image: ogImage,
            sku: activeProduct.id,
            brand: { '@type': 'Brand', name: activeProduct.brand || activeProduct.platformLabel },
            offers: {
              '@type': 'Offer',
              url: canonicalUrl,
              priceCurrency: 'RUB',
              price: String(minPrice),
              availability: activeProduct.variants.some((v) => v.inStock)
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            },
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Главная', item: `${origin}/` },
              { '@type': 'ListItem', position: 2, name: catName, item: `${origin}${catPath}` },
              { '@type': 'ListItem', position: 3, name: activeProduct.title, item: canonicalUrl },
            ],
          },
        ],
      });
      return;
    }

    const meta = getRouteSeoMetadata(route, platformFilter);
    const canonicalUrl = `${origin}${meta.canonicalPath}`;
    document.title = meta.title;
    setHeadMetaTag('name', 'description', meta.description);
    setHeadMetaTag('name', 'robots', meta.robots);
    setCanonicalLink(canonicalUrl);
    setHeadMetaTag('property', 'og:type', 'website');
    setHeadMetaTag('property', 'og:title', meta.title);
    setHeadMetaTag('property', 'og:description', meta.description);
    setHeadMetaTag('property', 'og:url', canonicalUrl);
    setHeadMetaTag('property', 'og:image', defaultImage);
    setHeadMetaTag('name', 'twitter:title', meta.title);
    setHeadMetaTag('name', 'twitter:description', meta.description);
    setHeadMetaTag('name', 'twitter:image', defaultImage);

    let ldScript = document.getElementById('cgs-dynamic-jsonld') as HTMLScriptElement | null;
    if (meta.breadcrumbName) {
      if (!ldScript) {
        ldScript = document.createElement('script');
        ldScript.id = 'cgs-dynamic-jsonld';
        ldScript.type = 'application/ld+json';
        document.head.appendChild(ldScript);
      }
      ldScript.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: `${origin}/` },
          { '@type': 'ListItem', position: 2, name: meta.breadcrumbName, item: canonicalUrl },
        ],
      });
    } else if (ldScript) {
      ldScript.remove();
    }
  }, [route, platformFilter, activeProduct]);

  // Reset pagination whenever filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [platformFilter, formatFilter, priceRange, onlyRussian, onlyDiscount, searchQuery, sortBy]);

  const handleNavigate = (nextRoute: AppRoute, sectionId?: string) => {
    setRoute(nextRoute);
    setActiveProduct(null);
    setPendingUrlProductId(null);

    if (nextRoute === 'admin') {
      window.history.pushState({}, '', '/admin');
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    const nextPath = buildRoutePath(nextRoute, latestPlatformRef.current);
    if (window.location.pathname !== nextPath || window.location.hash) {
      window.history.pushState({}, '', nextPath);
    }

    if (sectionId) {
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectPlatform = (platform: PlatformFilter) => {
    latestPlatformRef.current = platform;
    setPlatformFilter(platform);
    setFormatFilter('all');
    if (route === 'home' || route === 'catalog') {
      const nextPath = buildRoutePath(route, platform);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
    }
  };

  const openProductModal = (product: StoreProduct) => {
    setPendingUrlProductId(null);
    setActiveProduct(product);
    const nextPath = buildRoutePath(route, latestPlatformRef.current, product.id);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  };

  const closeProductModal = () => {
    setPendingUrlProductId(null);
    setActiveProduct(null);
    const backPath = buildRoutePath(route, latestPlatformRef.current);
    if (window.location.pathname !== backPath) {
      window.history.pushState({}, '', backPath);
    }
  };

  const resetAllFilters = () => {
    setPlatformFilter('all');
    setFormatFilter('all');
    setPriceRange('all');
    setOnlyRussian(false);
    setOnlyDiscount(false);
    setSearchQuery('');
    setSortBy('featured');
    setCurrentPage(1);
  };

  const hasActiveFilters =
    platformFilter !== 'all' ||
    formatFilter !== 'all' ||
    priceRange !== 'all' ||
    onlyRussian ||
    onlyDiscount ||
    searchQuery.trim().length > 0;

  const handleAddToCart = (product: StoreProduct, variant: ProductVariant) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.variant.id === variant.id);
      if (existing) {
        return prev.map((item) =>
          item.variant.id === variant.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, variant, quantity: 1 }];
    });
    setLastAddedTitle(`${product.title} — ${variant.label}`);
    setCartOpen(true);
  };

  const handleUpdateQty = (variantId: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.variant.id === variantId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (variantId: string) => {
    setCartItems((prev) => prev.filter((item) => item.variant.id !== variantId));
  };

  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = storefrontProducts.filter((product) => {
      const price = product.variants[0].priceRub;
      const discount = product.variants[0].discountPercent;

      const matchesPlatform =
        platformFilter === 'all' ||
        (platformFilter === 'ps' && product.platformGroup === 'ps') ||
        (platformFilter === 'xbox' &&
          product.platformGroup === 'xbox' &&
          product.categoryType === 'games') ||
        (platformFilter === 'subscriptions' && product.categoryType === 'subscriptions');

      const matchesFormat =
        formatFilter === 'all' ||
        (formatFilter === 'account' && product.deliveryType === 'account') ||
        (formatFilter === 'key' && product.deliveryType === 'key') ||
        (formatFilter === 'subscription' && product.deliveryType === 'subscription') ||
        (formatFilter === 'preorder' && product.isPreorder);

      const matchesPrice =
        priceRange === 'all' ||
        (priceRange === 'under-2000' && price <= 2000) ||
        (priceRange === '2000-5000' && price > 2000 && price <= 5000) ||
        (priceRange === 'over-5000' && price > 5000);

      const matchesRussian = !onlyRussian || product.hasRussian;
      const matchesDiscount = !onlyDiscount || discount > 0;

      const matchesQuery =
        !query ||
        product.title.toLowerCase().includes(query) ||
        product.rawTitle.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query) ||
        product.brand.toLowerCase().includes(query) ||
        product.genre.toLowerCase().includes(query) ||
        product.platformLabel.toLowerCase().includes(query);

      return (
        matchesPlatform &&
        matchesFormat &&
        matchesPrice &&
        matchesRussian &&
        matchesDiscount &&
        matchesQuery
      );
    });

    if (sortBy === 'price-asc') {
      return [...list].sort((a, b) => a.variants[0].priceRub - b.variants[0].priceRub);
    }
    if (sortBy === 'price-desc') {
      return [...list].sort((a, b) => b.variants[0].priceRub - a.variants[0].priceRub);
    }
    if (sortBy === 'discount') {
      return [...list].sort(
        (a, b) =>
          b.variants[0].discountPercent - a.variants[0].discountPercent ||
          b.featuredScore - a.featuredScore
      );
    }
    if (sortBy === 'title-asc') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    }
    return list;
  }, [storefrontProducts, platformFilter, formatFilter, priceRange, onlyRussian, onlyDiscount, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const paginatedProducts = useMemo(
    () => filteredProducts.slice(pageStartIndex, pageStartIndex + ITEMS_PER_PAGE),
    [filteredProducts, pageStartIndex]
  );

  const handlePageChange = (nextPage: number) => {
    const clamped = Math.max(1, Math.min(totalPages, nextPage));
    setCurrentPage(clamped);
    const catalogEl = document.getElementById('catalog-section');
    if (catalogEl) {
      catalogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (safePage > 3) pages.push('ellipsis');
    const start = Math.max(2, safePage - 1);
    const end = Math.min(totalPages - 1, safePage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (safePage < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }, [safePage, totalPages]);

  const filterTabs: { id: PlatformFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все товары', count: catalogStats.total },
    { id: 'xbox', label: 'Игры Xbox', count: catalogStats.xboxGames },
    { id: 'ps', label: 'PlayStation 5', count: catalogStats.psGames },
    { id: 'subscriptions', label: 'Подписки', count: catalogStats.subscriptions },
  ];

  const catalogHeading = useMemo(() => {
    if (formatFilter === 'key') return 'Ключи активации Xbox';
    if (formatFilter === 'preorder') return 'Предзаказы 2025–2026';
    if (platformFilter === 'xbox') return 'Игры для Xbox One и Series X|S';
    if (platformFilter === 'ps') return 'Игры для PlayStation 5 (Турция)';
    if (platformFilter === 'subscriptions') return 'Подписки PS Plus и Xbox Game Pass';
    return 'Каталог игр и подписок';
  }, [platformFilter, formatFilter]);

  const renderTrustBadgeCard = () => (
    <div className="bg-[#373737] text-white rounded-lg p-4 border border-neutral-700 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-sm tracking-tight">CyberGameStore</span>
        <span className="text-xs font-mono text-[#52c44c] font-semibold tabular-nums">
          5.00 / 5
        </span>
      </div>
      <div className="flex items-center gap-1" aria-label="Рейтинг 5 из 5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
        ))}
        <span className="text-xs text-neutral-300 ml-1.5 tabular-nums">1 484 отзыва</span>
      </div>
      <p className="text-xs text-neutral-300 leading-relaxed">
        Игры, ключи и подписки Xbox и PlayStation · Быстрая официальная доставка
      </p>
    </div>
  );

  const renderCatalogWithSidebar = (standalone: boolean) => (
    <section
      id="catalog-section"
      className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 sm:py-10"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Column (9 cols) */}
        <div className="lg:col-span-9 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-neutral-200">
            <div>
              {standalone ? (
                <h1 className="text-2xl sm:text-3xl font-bold italic text-neutral-900">
                  {catalogHeading}
                </h1>
              ) : (
                <h2 className="text-2xl sm:text-3xl font-bold italic text-neutral-900">
                  {catalogHeading}
                </h2>
              )}
              <p className="text-xs sm:text-sm text-neutral-500 mt-1 tabular-nums">
                {filteredProducts.length > 0
                  ? `Показано ${pageStartIndex + 1}–${Math.min(
                      pageStartIndex + ITEMS_PER_PAGE,
                      filteredProducts.length
                    )} из ${filteredProducts.length} товаров`
                  : 'Товары по выбранным параметрам не найдены'}
              </p>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Сортировка товаров"
              className="px-3.5 py-2 text-sm bg-white border border-neutral-200 rounded-lg text-neutral-700 focus:outline-none focus:border-[#52c44c] cursor-pointer w-fit"
            >
              <option value="featured">По популярности</option>
              <option value="price-asc">Сначала дешевле</option>
              <option value="price-desc">Сначала дороже</option>
              <option value="discount">Сначала со скидкой</option>
              <option value="title-asc">По названию (А–Я)</option>
            </select>
          </div>

          {/* Platform Tabs + Active Filter Reset */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-200/70 rounded-lg w-fit">
              {filterTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectPlatform(tab.id)}
                  className={`px-3.5 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    platformFilter === tab.id && formatFilter === 'all'
                      ? 'bg-white text-neutral-900 shadow-xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="ml-1.5 text-[11px] font-mono text-neutral-400 tabular-nums">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить фильтры</span>
              </button>
            )}
          </div>

          {filteredProducts.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-base font-semibold text-neutral-900">
                По вашему запросу ничего не найдено
              </p>
              <p className="text-sm text-neutral-500">
                Попробуйте сбросить фильтры платформы, цены или изменить поисковую фразу.
              </p>
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#52c44c] rounded-lg hover:bg-[#44ad3f] transition-colors cursor-pointer"
              >
                Сбросить все фильтры
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {paginatedProducts.map((product) => {
                  const defaultVariant = product.variants[0];
                  const hasDiscount =
                    defaultVariant.oldPriceRub > defaultVariant.priceRub &&
                    defaultVariant.discountPercent > 0;

                  return (
                    <article
                      key={product.id}
                      className="group bg-white border border-neutral-200 rounded-lg overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[#52c44c]"
                    >
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-900">
                        <button
                          type="button"
                          onClick={() => openProductModal(product)}
                          className="w-full h-full block text-left cursor-pointer"
                        >
                          <ResilientImage
                            src={product.image}
                            alt={product.title}
                            title={product.title}
                            fallbackTone={product.fallbackTone}
                            className="w-full h-full"
                            imgClassName="transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        </button>
                        {hasDiscount ? (
                          <span className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 text-[11px] font-bold text-black bg-[#52c44c] rounded-md tabular-nums">
                            Скидка -{defaultVariant.discountPercent}%
                          </span>
                        ) : product.isPreorder ? (
                          <span className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 text-[11px] font-bold text-white bg-black/85 border border-neutral-700 rounded-md">
                            Предзаказ
                          </span>
                        ) : product.deliveryType === 'key' ? (
                          <span className="absolute top-2.5 left-2.5 z-10 px-2.5 py-1 text-[11px] font-semibold text-white bg-black/80 rounded-md">
                            Ключ Xbox
                          </span>
                        ) : null}
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between gap-3.5">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                            <span className="truncate font-medium text-neutral-600">
                              {product.platformLabel} · {product.regionLabel}
                            </span>
                            <span className="font-mono text-neutral-400 shrink-0 tabular-nums">
                              #{product.sku}
                            </span>
                          </div>

                          <h3 className="text-sm sm:text-[15px] font-semibold text-neutral-900 leading-snug line-clamp-2 min-h-[2.6rem]">
                            <button
                              type="button"
                              onClick={() => openProductModal(product)}
                              className="text-left hover:text-[#52c44c] transition-colors cursor-pointer"
                            >
                              {product.title}
                            </button>
                          </h3>

                          <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                            <span className="truncate">{product.genre}</span>
                            {product.hasRussian && (
                              <span
                                title={product.language}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 shrink-0"
                              >
                                <Globe className="w-3 h-3" />
                                <span>RU</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-neutral-100 flex items-center justify-between gap-2">
                          <div>
                            {hasDiscount && (
                              <span className="font-mono text-xs text-neutral-400 line-through block tabular-nums">
                                {defaultVariant.oldPriceRub.toLocaleString('ru-RU')} ₽
                              </span>
                            )}
                            <span className="font-mono text-base font-bold text-neutral-900 tabular-nums">
                              {defaultVariant.priceRub.toLocaleString('ru-RU')} ₽
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleAddToCart(product, defaultVariant)}
                            aria-label={`Добавить ${product.title} в корзину`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>В корзину</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <nav
                  aria-label="Навигация по страницам каталога"
                  className="pt-4 flex flex-wrap items-center justify-between gap-4 border-t border-neutral-200"
                >
                  <div className="text-xs text-neutral-500 tabular-nums">
                    Страница {safePage} из {totalPages}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => handlePageChange(safePage - 1)}
                      aria-label="Предыдущая страница"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-neutral-200 rounded-md text-neutral-700 hover:border-[#52c44c] disabled:opacity-45 disabled:pointer-events-none cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Назад</span>
                    </button>

                    {pageNumbers.map((entry, idx) =>
                      entry === 'ellipsis' ? (
                        <span
                          key={`ellipsis-${idx}`}
                          className="px-2 text-xs text-neutral-400 select-none"
                        >
                          …
                        </span>
                      ) : (
                        <button
                          key={entry}
                          type="button"
                          onClick={() => handlePageChange(entry)}
                          aria-current={entry === safePage ? 'page' : undefined}
                          className={`min-w-[34px] h-[32px] px-2 text-xs font-mono font-semibold rounded-md transition-colors tabular-nums cursor-pointer ${
                            entry === safePage
                              ? 'bg-[#52c44c] text-white'
                              : 'bg-white border border-neutral-200 text-neutral-700 hover:border-[#52c44c]'
                          }`}
                        >
                          {entry}
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => handlePageChange(safePage + 1)}
                      aria-label="Следующая страница"
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white border border-neutral-200 rounded-md text-neutral-700 hover:border-[#52c44c] disabled:opacity-45 disabled:pointer-events-none cursor-pointer"
                    >
                      <span className="hidden sm:inline">Вперёд</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </nav>
              )}
            </>
          )}
        </div>

        {/* Right Sticky Sidebar (3 cols) */}
        <aside className="lg:col-span-3 space-y-5 lg:sticky lg:top-24">
          {/* Search box */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
            <div className="text-sm font-bold italic text-neutral-900">Поиск по каталогу</div>
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Название, жанр или SKU..."
                aria-label="Поиск товаров"
                className="w-full pl-9 pr-3 py-2 text-sm bg-[#e5e5e5]/70 border border-neutral-200 rounded-md text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:bg-white focus:border-[#52c44c]"
              />
            </div>
          </div>

          {/* Categories Widget */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
            <div className="text-sm font-bold italic text-neutral-900 pb-2 border-b border-neutral-100">
              Разделы каталога
            </div>
            <ul className="space-y-1 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('all');
                    setFormatFilter('all');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    platformFilter === 'all' && formatFilter === 'all'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Все товары</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.total}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('xbox');
                    setFormatFilter('all');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    platformFilter === 'xbox' && formatFilter === 'all'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Игры Xbox</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.xboxGames}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('ps');
                    setFormatFilter('all');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    platformFilter === 'ps' && formatFilter === 'all'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Игры PlayStation 5</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.psGames}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('subscriptions');
                    setFormatFilter('all');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    platformFilter === 'subscriptions'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Подписки PS Plus / Game Pass</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.subscriptions}
                  </span>
                </button>
              </li>
              <li className="pt-1.5 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('all');
                    setFormatFilter('key');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    formatFilter === 'key'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Ключи активации Xbox</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.keys}
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFilter('all');
                    setFormatFilter('preorder');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                    formatFilter === 'preorder'
                      ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                      : 'text-neutral-700 hover:text-[#52c44c]'
                  }`}
                >
                  <span>Предзаказы</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">
                    {catalogStats.preorders}
                  </span>
                </button>
              </li>
            </ul>
          </div>

          {/* Language, Discount & Price Filters */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-4">
            <div className="text-sm font-bold italic text-neutral-900 pb-2 border-b border-neutral-100">
              Фильтры
            </div>

            <div className="space-y-2.5 text-sm">
              <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                <span className="flex items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={onlyRussian}
                    onChange={(e) => setOnlyRussian(e.target.checked)}
                    className="w-4 h-4 accent-[#52c44c] rounded cursor-pointer"
                  />
                  <span>Русский язык</span>
                </span>
                <span className="font-mono text-xs text-neutral-400 tabular-nums">
                  {catalogStats.withRussian}
                </span>
              </label>

              <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                <span className="flex items-center gap-2 text-neutral-700">
                  <input
                    type="checkbox"
                    checked={onlyDiscount}
                    onChange={(e) => setOnlyDiscount(e.target.checked)}
                    className="w-4 h-4 accent-[#52c44c] rounded cursor-pointer"
                  />
                  <span>Со скидкой</span>
                </span>
                <span className="font-mono text-xs text-neutral-400 tabular-nums">
                  {catalogStats.discounted}
                </span>
              </label>
            </div>

            <div className="pt-3 border-t border-neutral-100 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Бюджет
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                {(
                  [
                    { id: 'all', label: 'Любая цена' },
                    { id: 'under-2000', label: 'До 2 000 ₽' },
                    { id: '2000-5000', label: '2 000 – 5 000 ₽' },
                    { id: 'over-5000', label: 'От 5 000 ₽' },
                  ] as { id: PriceRangeFilter; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPriceRange(opt.id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                      priceRange === opt.id
                        ? 'bg-[#52c44c]/15 text-neutral-900 font-semibold'
                        : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Store Rating Badge */}
          {renderTrustBadgeCard()}

          {/* Quick Telegram Support */}
          <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-2.5">
            <div className="text-sm font-bold italic text-neutral-900">Связь в Telegram</div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Поможем с выбором игры, подбором издания или созданием турецкого аккаунта.
            </p>
            <div className="flex flex-col gap-2 pt-1 text-xs font-semibold">
              <a
                href="https://t.me/GyberGameStore"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-3.5 py-2 text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-md transition-colors"
              >
                Написать менеджеру (@GyberGameStore)
              </a>
              <a
                href="https://t.me/cyber_game_store"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-3.5 py-2 text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors"
              >
                Канал скидок (@cyber_game_store)
              </a>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );

  if (route === 'admin') {
    return (
      <AdminPanel
        staticExtraProducts={staticExtraProducts}
        staticExtraIdSet={staticExtraIdSet}
        firestoreProducts={firestoreProducts}
        serverProducts={serverProducts}
        onRefreshServerProducts={refreshServerProducts}
        onBackToStore={() => handleNavigate('home')}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F6F8] text-[#1a1a1a]">
      <Header
        activeRoute={route}
        activePlatform={platformFilter}
        cartCount={cartCount}
        savedOrdersCount={savedOrders.length}
        onNavigate={handleNavigate}
        onSelectPlatform={handleSelectPlatform}
        onOpenCart={() => setCartOpen(true)}
        onOpenMyOrders={() => setMyOrdersOpen(true)}
      />

      {recentPaidBannerId && !activeOrder && (
        <div className="bg-[#111111] text-white text-xs py-2.5 px-4 text-center border-b border-neutral-800 flex flex-wrap items-center justify-center gap-2">
          <span className="text-neutral-200">
            Покупка <strong className="font-mono text-[#52c44c]">#{recentPaidBannerId}</strong>{' '}
            сохранена в разделе «Мои покупки».
          </span>
          <button
            type="button"
            onClick={() => {
              setRecentPaidBannerId(null);
              setMyOrdersOpen(true);
            }}
            className="text-[#52c44c] underline font-semibold hover:text-white cursor-pointer"
          >
            Открыть чек
          </button>
          <button
            type="button"
            onClick={() => setRecentPaidBannerId(null)}
            className="text-neutral-400 hover:text-white ml-1 cursor-pointer"
          >
            Скрыть
          </button>
        </div>
      )}

      {lastAddedTitle && !cartOpen && (
        <div className="bg-[#141414] text-white text-xs py-2 px-4 text-center border-b border-neutral-800">
          <span className="text-neutral-300">Добавлено в корзину: {lastAddedTitle}.</span>{' '}
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="text-[#52c44c] underline font-semibold ml-1 hover:text-white cursor-pointer"
          >
            Открыть корзину
          </button>
        </div>
      )}

      {route === 'home' && (
        <main className="flex-1">
          {/* Compact Storefront Intro Banner (Black & Green brand bar) */}
          <section className="bg-[#111111] text-white border-b border-neutral-800">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2.5 max-w-2xl">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#52c44c]">
                  Xbox Series X|S · PlayStation 5 · Game Pass Ultimate · {catalogStats.total}{' '}
                  товаров в наличии
                </div>
                <h1 className="text-3xl sm:text-4xl font-bold italic text-white leading-tight">
                  Игры, ключи и подписки для Xbox и PlayStation
                </h1>
                <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
                  Официальная покупка на турецкие и любые личные аккаунты, цифровые ключи Xbox и
                  подписки Game Pass без VPN. Выдача и активация за 5–15 минут.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    handleSelectPlatform('subscriptions');
                    handleNavigate('catalog');
                  }}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Game Pass от 1 547 ₽
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigate('delivery')}
                  className="px-5 py-2.5 text-sm font-semibold text-white border border-neutral-700 hover:border-[#52c44c] hover:text-[#52c44c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Оплата и доставка
                </button>
              </div>
            </div>
          </section>

          {/* Main 2-column Storefront + Right Sidebar */}
          {renderCatalogWithSidebar(false)}

          {/* How It Works + FAQ Section */}
          <section className="bg-white border-t border-neutral-200 py-12 sm:py-14">
            <div className="max-w-[1200px] mx-auto px-4 sm:px-6 space-y-12">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-[#F5F6F8] border border-neutral-200 rounded-lg p-5 space-y-2">
                  <div className="font-mono text-xs font-semibold text-[#52c44c]">01. Выбор</div>
                  <h2 className="text-lg font-bold italic text-neutral-900">
                    Выберите игру, ключ или подписку
                  </h2>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    Добавьте нужные позиции для PlayStation или Xbox в корзину. Если турецкого
                    профиля ещё нет — бесплатно поможем зарегистрировать его и передадим данные в Telegram.
                  </p>
                </div>

                <div className="bg-[#F5F6F8] border border-neutral-200 rounded-lg p-5 space-y-2">
                  <div className="font-mono text-xs font-semibold text-[#52c44c]">02. Оплата</div>
                  <h2 className="text-lg font-bold italic text-neutral-900">
                    Официальное оформление за 5–15 минут
                  </h2>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    Оплачивайте заказ через СБП или карту РФ. Менеджер купит игру напрямую в
                    PlayStation / Microsoft Store или выдаст цифровой ключ активации.
                  </p>
                </div>

                <div className="bg-[#F5F6F8] border border-neutral-200 rounded-lg p-5 space-y-2">
                  <div className="font-mono text-xs font-semibold text-[#52c44c]">03. Игра</div>
                  <h2 className="text-lg font-bold italic text-neutral-900">
                    Запуск с основного профиля
                  </h2>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    Включите общий доступ или «Домашнюю консоль» и запускайте игры и подписку со
                    своего основного российского аккаунта с сохранением всех достижений.
                  </p>
                </div>
              </div>

              <div id="faq-section" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-4 space-y-3">
                  <h2 className="text-2xl font-bold italic text-neutral-900">
                    Вопросы покупателей
                  </h2>
                  <p className="text-sm text-neutral-600 leading-relaxed">
                    Подробно отвечаем на частые вопросы о покупке игр, цифровых ключей и подписок
                    Xbox и PlayStation.
                  </p>
                  <a
                    href="https://t.me/GyberGameStore"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#52c44c] hover:underline"
                  >
                    <span>Написать в Telegram (@GyberGameStore)</span>
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>

                <div className="lg:col-span-8 divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden bg-white">
                  {FAQ_ITEMS.map((item) => {
                    const isOpen = openFaqId === item.id;
                    return (
                      <div key={item.id}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpenFaqId(isOpen ? '' : item.id)}
                          className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors cursor-pointer"
                        >
                          <span className="text-sm sm:text-base font-semibold text-neutral-900">
                            {item.question}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-neutral-500 shrink-0 transition-transform duration-200 ${
                              isOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4 text-sm text-neutral-600 leading-relaxed">
                            {item.answer}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      {route === 'catalog' && <main className="flex-1">{renderCatalogWithSidebar(true)}</main>}

      {(route === 'delivery' ||
        route === 'about' ||
        route === 'privacy' ||
        route === 'terms' ||
        route === 'contacts') && (
        <div className="flex-1">
          <LegalViews route={route} onNavigate={handleNavigate} />
        </div>
      )}

      {/* Original Black Footer */}
      <footer className="bg-black text-white border-t border-neutral-800 mt-auto">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pb-10 border-b border-neutral-800">
            {/* Col 1: Trust Badge */}
            <div className="space-y-3">
              <div className="text-sm font-bold italic text-white">В наличии игры</div>
              {renderTrustBadgeCard()}
            </div>

            {/* Col 2: Customer links */}
            <div className="space-y-3">
              <div className="text-sm font-bold italic text-white">Покупателю</div>
              <ul className="space-y-2 text-sm text-neutral-300">
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('home')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Домашняя страница
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('delivery')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Оплата и доставка
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('about')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    О магазине
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('privacy')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Политика конфиденциальности
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('terms')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Правовая информация
                  </button>
                </li>
                <li>
                  <a
                    href="https://www.avito.ru/user/4593425aa2be258d60d2767c806a7cbd/profile?src=sharing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#52c44c] transition-colors"
                  >
                    Отзывы на Avito
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.wildberries.ru/seller/624826"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#52c44c] transition-colors"
                  >
                    Отзывы на Wildberries
                  </a>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('contacts')}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Контакты
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setMyOrdersOpen(true)}
                    className="hover:text-[#52c44c] transition-colors cursor-pointer"
                  >
                    Мои покупки{savedOrders.length > 0 ? ` (${savedOrders.length})` : ''}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleNavigate('admin')}
                    className="text-[#52c44c] hover:underline transition-colors cursor-pointer"
                  >
                    Админ-панель
                  </button>
                </li>
              </ul>
            </div>

            {/* Col 3: Contacts & Legal details */}
            <div className="space-y-2.5 text-sm text-neutral-300">
              <div className="text-sm font-bold italic text-white">Контакты</div>
              <div>
                <a
                  href="mailto:info@cybergamestore.ru"
                  className="hover:text-[#52c44c] transition-colors"
                >
                  info@cybergamestore.ru
                </a>
              </div>
              <div>
                Менеджер Telegram:{' '}
                <a
                  href="https://t.me/GyberGameStore"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#52c44c] hover:underline"
                >
                  @GyberGameStore
                </a>
              </div>
              <div>
                Канал скидок:{' '}
                <a
                  href="https://t.me/cyber_game_store"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#52c44c] hover:underline"
                >
                  @cyber_game_store
                </a>
              </div>
              <div>
                VK:{' '}
                <a
                  href="https://vk.com/cyber_game_store"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#52c44c] transition-colors"
                >
                  vk.com/cyber_game_store
                </a>
              </div>
              <div className="font-mono text-xs text-neutral-300">
                Телефон:{' '}
                <a href="tel:+79969249761" className="hover:text-[#52c44c] transition-colors">
                  +7 (996) 924-97-61
                </a>
              </div>
              <div className="text-xs text-neutral-400 pt-1">
                ИНН 245731461374 · ОГРНИП 322774600008543
              </div>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-400">
            <div>© 2026 CyberGameStore (cybergamestore.ru)</div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="px-2 py-0.5 rounded-sm bg-neutral-900 border border-neutral-800 text-neutral-300 font-medium">
                Т-Банк Эквайринг
              </span>
              <span className="px-2 py-0.5 rounded-sm bg-neutral-900 border border-neutral-800 text-neutral-300 font-medium">
                СБП
              </span>
              <span className="px-2 py-0.5 rounded-sm bg-neutral-900 border border-neutral-800 text-neutral-300 font-medium">
                Мир
              </span>
              <span className="px-2 py-0.5 rounded-sm bg-neutral-900 border border-neutral-800 text-neutral-300 font-medium">
                Visa / Mastercard
              </span>
            </div>
          </div>
        </div>
      </footer>

      <ProductModal
        product={activeProduct}
        allProducts={storefrontProducts}
        onClose={closeProductModal}
        onSelectProduct={(nextProduct) => openProductModal(nextProduct)}
        onAddToCart={handleAddToCart}
      />

      <CartDrawer
        isOpen={cartOpen}
        items={cartItems}
        savedOrders={savedOrders}
        onClose={() => setCartOpen(false)}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onClearCart={() => setCartItems([])}
        onOpenPaymentModal={(order) => setActiveOrder(order)}
        onOrderSaved={recordOrder}
        onOpenMyOrders={() => setMyOrdersOpen(true)}
      />

      <PaymentModal
        order={activeOrder}
        onClose={() => {
          if (activeOrder?.status === 'paid') {
            setRecentPaidBannerId(activeOrder.id);
          }
          setActiveOrder(null);
        }}
        onOrderUpdated={(updated) => {
          setActiveOrder(updated);
          recordOrder(updated);
          if (updated.status === 'paid') {
            setCartItems([]);
          }
        }}
      />

      <MyOrdersModal
        isOpen={myOrdersOpen}
        orders={savedOrders}
        onClose={() => setMyOrdersOpen(false)}
        onSelectOrder={(order) => setActiveOrder(order)}
        onOrdersSynced={recordOrdersBatch}
      />
    </div>
  );
}
