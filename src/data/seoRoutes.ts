export type SeoAppRoute =
  | 'home'
  | 'catalog'
  | 'delivery'
  | 'about'
  | 'privacy'
  | 'terms'
  | 'contacts'
  | 'admin';

export type SeoPlatformFilter = 'all' | 'xbox' | 'ps' | 'subscriptions';

export const SITE_ORIGIN_FALLBACK = 'https://cybergamestore.ru';
export const SITE_LOGO_PATH = '/assets/aistudio/image_7c19fec9.png';

export interface ParsedRouteState {
  route: SeoAppRoute;
  platform: SeoPlatformFilter;
  productId?: string;
}

export function parsePathname(pathname: string, hash = ''): ParsedRouteState {
  const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';
  const lower = cleanPath.toLowerCase();

  if (lower.startsWith('/admin') || hash === '#admin') {
    return { route: 'admin', platform: 'all' };
  }
  if (lower === '/xbox') {
    return { route: 'catalog', platform: 'xbox' };
  }
  if (lower === '/playstation' || lower === '/ps5' || lower === '/ps') {
    return { route: 'catalog', platform: 'ps' };
  }
  if (lower === '/subscriptions' || lower === '/ps-plus' || lower === '/game-pass') {
    return { route: 'catalog', platform: 'subscriptions' };
  }
  if (lower === '/catalog') {
    return { route: 'catalog', platform: 'all' };
  }
  if (lower === '/delivery') {
    return { route: 'delivery', platform: 'all' };
  }
  if (lower === '/about') {
    return { route: 'about', platform: 'all' };
  }
  if (lower === '/privacy') {
    return { route: 'privacy', platform: 'all' };
  }
  if (lower === '/terms') {
    return { route: 'terms', platform: 'all' };
  }
  if (lower === '/contacts') {
    return { route: 'contacts', platform: 'all' };
  }
  if (lower.startsWith('/game/')) {
    const rawId = cleanPath.slice('/game/'.length).split('/')[0] || '';
    try {
      const decoded = decodeURIComponent(rawId).trim();
      if (decoded) {
        return { route: 'home', platform: 'all', productId: decoded };
      }
    } catch {
      if (rawId) {
        return { route: 'home', platform: 'all', productId: rawId };
      }
    }
  }

  return { route: 'home', platform: 'all' };
}

export function buildRoutePath(
  route: SeoAppRoute,
  platform: SeoPlatformFilter = 'all',
  productId?: string
): string {
  if (productId) {
    return `/game/${encodeURIComponent(productId)}`;
  }
  if (route === 'admin') return '/admin';
  if (route === 'delivery') return '/delivery';
  if (route === 'about') return '/about';
  if (route === 'privacy') return '/privacy';
  if (route === 'terms') return '/terms';
  if (route === 'contacts') return '/contacts';
  if (route === 'catalog') {
    if (platform === 'xbox') return '/xbox';
    if (platform === 'ps') return '/playstation';
    if (platform === 'subscriptions') return '/subscriptions';
    return '/catalog';
  }
  if (platform === 'xbox') return '/xbox';
  if (platform === 'ps') return '/playstation';
  if (platform === 'subscriptions') return '/subscriptions';
  return '/';
}

export interface RouteSeoMetadata {
  title: string;
  description: string;
  canonicalPath: string;
  robots: string;
  breadcrumbName?: string;
}

export function getRouteSeoMetadata(
  route: SeoAppRoute,
  platform: SeoPlatformFilter = 'all'
): RouteSeoMetadata {
  if (route === 'admin') {
    return {
      title: 'Панель управления — CyberGameStore',
      description: 'Административная панель магазина CyberGameStore.',
      canonicalPath: '/admin',
      robots: 'noindex, nofollow',
    };
  }
  if (route === 'delivery') {
    return {
      title: 'Оплата и доставка игр за 5–15 минут — CyberGameStore',
      description:
        'Как купить игры и подписки Xbox и PlayStation на турецкий аккаунт с оплатой по СБП и картой РФ. Пошаговая инструкция и гарантии.',
      canonicalPath: '/delivery',
      robots: 'index, follow',
      breadcrumbName: 'Оплата и доставка',
    };
  }
  if (route === 'about') {
    return {
      title: 'О магазине CyberGameStore — отзывы и гарантии',
      description:
        'Информация о магазине цифровых игр CyberGameStore: более 1 480 отзывов, официальная покупка на турецкие аккаунты Xbox и PlayStation.',
      canonicalPath: '/about',
      robots: 'index, follow',
      breadcrumbName: 'О магазине',
    };
  }
  if (route === 'contacts') {
    return {
      title: 'Контакты и поддержка в Telegram — CyberGameStore',
      description:
        'Связь с поддержкой CyberGameStore в Telegram @GyberGameStore, канал скидок и реквизиты магазина. Работаем ежедневно с 10:00 до 23:00 МСК.',
      canonicalPath: '/contacts',
      robots: 'index, follow',
      breadcrumbName: 'Контакты',
    };
  }
  if (route === 'privacy') {
    return {
      title: 'Политика конфиденциальности — CyberGameStore',
      description: 'Политика обработки персональных данных интернет-магазина CyberGameStore.',
      canonicalPath: '/privacy',
      robots: 'index, follow',
      breadcrumbName: 'Политика конфиденциальности',
    };
  }
  if (route === 'terms') {
    return {
      title: 'Публичная оферта и условия покупки — CyberGameStore',
      description: 'Пользовательское соглашение, условия оплаты и возврата цифровых товаров CyberGameStore.',
      canonicalPath: '/terms',
      robots: 'index, follow',
      breadcrumbName: 'Правовая информация',
    };
  }
  if (platform === 'xbox') {
    return {
      title: 'Игры Xbox One и Series X|S (Турция и ключи) — CyberGameStore',
      description:
        'Купить игры для Xbox One и Xbox Series X|S на турецкий аккаунт или ключом активации. Низкие цены, проверка русского языка, быстрая выдача.',
      canonicalPath: '/xbox',
      robots: 'index, follow',
      breadcrumbName: 'Игры Xbox',
    };
  }
  if (platform === 'ps') {
    return {
      title: 'Игры PlayStation 4 и PS5 на турецкий аккаунт — CyberGameStore',
      description:
        'Купить цифровые игры для PS4 и PlayStation 5 в турецком PS Store по выгодным ценам. Официальное оформление за 5–15 минут.',
      canonicalPath: '/playstation',
      robots: 'index, follow',
      breadcrumbName: 'Игры PlayStation',
    };
  }
  if (platform === 'subscriptions') {
    return {
      title: 'Подписки PS Plus и Xbox Game Pass Ultimate — CyberGameStore',
      description:
        'Оформить подписку PlayStation Plus (Essential, Extra, Deluxe) и Xbox Game Pass Ultimate на 1, 3 и 12 месяцев с оплатой из России.',
      canonicalPath: '/subscriptions',
      robots: 'index, follow',
      breadcrumbName: 'Подписки PS Plus и Game Pass',
    };
  }
  if (route === 'catalog') {
    return {
      title: 'Каталог игр и подписок Xbox и PlayStation — CyberGameStore',
      description:
        'Полный каталог цифровых игр и подписок для PlayStation 5, PS4 и Xbox на турецкие аккаунты с быстрой доставкой.',
      canonicalPath: '/catalog',
      robots: 'index, follow',
      breadcrumbName: 'Каталог',
    };
  }

  return {
    title: 'Игры Xbox и PlayStation (Турция) — CyberGameStore',
    description:
      'Цифровой магазин игр и подписок PS Plus и Xbox Game Pass на турецкие аккаунты. Официальная покупка за 5–15 минут, оплата по СБП и картой РФ.',
    canonicalPath: '/',
    robots: 'index, follow',
  };
}
