import { RAW_CATALOG_ITEMS, type RawCatalogItem } from './catalogRaw.ts';

export type PlatformFilter = 'all' | 'xbox' | 'ps' | 'subscriptions';
export type DeliveryFormatFilter = 'all' | 'account' | 'key' | 'subscription' | 'preorder';

export interface ProductVariant {
  id: string;
  label: string;
  editionNote: string;
  oldPriceRub: number;
  priceRub: number;
  discountPercent: number;
  deliveryNote: string;
  inStock: boolean;
}

export interface StoreProduct {
  id: string;
  sku: string;
  slug: string;
  title: string;
  rawTitle: string;
  editionLabel: string;
  seriesKey: string;
  platformLabel: string;
  platformGroup: 'ps' | 'xbox';
  categoryType: 'games' | 'subscriptions';
  deliveryType: 'account' | 'key' | 'subscription';
  deliveryLabel: string;
  regionLabel: string;
  isPreorder: boolean;
  hasRussian: boolean;
  brand: string;
  genre: string;
  releaseYear: string;
  releaseDate?: string;
  language: string;
  rating: number;
  featuredScore: number;
  image: string;
  fallbackTone: string;
  shortDescription: string;
  fullDescription: string;
  activationSteps: string[];
  variants: ProductVariant[];
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const GENRE_TRANSLATIONS: Record<string, string> = {
  Action: 'Экшен',
  Adventure: 'Приключения',
  Arcade: 'Аркада',
  'Brain Training': 'Головоломка',
  Casual: 'Казуальная',
  'Driving/Racing': 'Гонки',
  Educational: 'Обучающая',
  Family: 'Семейная',
  Fighting: 'Файтинг',
  Horror: 'Хоррор',
  Party: 'Для компании',
  Puzzle: 'Головоломка',
  'Role Playing Games': 'RPG',
  Shooter: 'Шутер',
  Simulation: 'Симулятор',
  Simulator: 'Симулятор',
  Strategy: 'Стратегия',
  Unique: 'Инди',
};

const FEATURED_TITLE_SCORES: [RegExp, number][] = [
  [/xbox game pass ultimate/i, 100],
  [/play\s*station\s*plus|\bps\s*plus\b/i, 99],
  [/^gta 6\b/i, 98],
  [/^forza horizon 6\b/i, 96],
  [/^battlefield 6\b/i, 95],
  [/^fc 27\b/i, 94],
  [/^doom:\s*the dark ages/i, 93],
  [/^assassin[’']?s creed shadows/i, 92],
  [/^kingdom come:\s*deliverance ii/i, 91],
  [/^clair obscur:\s*expedition 33/i, 90],
  [/^hollow knight:\s*silksong/i, 89],
  [/^call of duty black ops 7/i, 88],
  [/^mafia:\s*the old country/i, 87],
  [/^silent hill f/i, 86],
  [/^borderlands 4/i, 85],
  [/^split fiction/i, 84],
  [/^ea sports fc 26/i, 83],
  [/^dying light:\s*the beast/i, 82],
  [/^gears of war:\s*reloaded/i, 81],
  [/^little nightmares iii/i, 80],
  [/^jurassic world evolution 3/i, 79],
  [/^painkiller/i, 78],
  [/^the precinct/i, 77],
  [/^mortal kombat 11/i, 76],
  [/^doom eternal/i, 75],
  [/^fallout 4\b/i, 74],
  [/^choochoo charles/i, 88],
  [/^shogun showdown/i, 86],
  [/^lost in play/i, 84],
  [/^project tower/i, 82],
  [/^copycat\b/i, 81],
  [/^crossy road castle/i, 80],
  [/^ebenezer and the invisible world/i, 79],
  [/^frontier hunter/i, 78],
  [/^adam wolfe/i, 76],
  [/^tekken 7/i, 73],
  [/^need for speed heat/i, 72],
  [/^wolfenstein ii/i, 71],
  [/^dishonored 2/i, 70],
  [/^prey\b/i, 69],
  [/^deathloop/i, 68],
  [/^ghostwire:\s*tokyo/i, 67],
  [/^deus ex/i, 66],
  [/^overcooked/i, 65],
];

function slugify(value: string, fallbackId: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return clean ? `${clean}-${fallbackId}` : `item-${fallbackId}`;
}

function detectSubscription(raw: RawCatalogItem): boolean {
  return (
    raw.category === 'Subscriptions' ||
    /подписка|game pass|ps plus/i.test(raw.title)
  );
}

function detectKey(raw: RawCatalogItem): boolean {
  return /\bключ\b/i.test(raw.title) || /работает на ваш акк/i.test(raw.title);
}

function detectPreorder(raw: RawCatalogItem): boolean {
  return /предзаказ/i.test(raw.title) || /^предзаказ\b/i.test(raw.description.trim());
}

function cleanDisplayTitle(raw: RawCatalogItem, isSubscription: boolean): string {
  let t = raw.title.trim();

  if (isSubscription) {
    const durationMatch = t.match(/(\d+\s*(?:месяц(?:а|ев)?|мес\.?))/i);
    const duration = durationMatch ? durationMatch[1] : '';
    const isPsPlus = raw.platform === 'PlayStation' || /ps\s*plus|playstation\s*plus/i.test(t);
    if (isPsPlus) {
      const tierMatch = t.match(/\b(Deluxe|Extra|Essential)\b/i);
      const tier = tierMatch
        ? tierMatch[1].charAt(0).toUpperCase() + tierMatch[1].slice(1).toLowerCase()
        : '';
      return `PlayStation Plus${tier ? ` ${tier}` : ''}${duration ? ` — ${duration}` : ''} (Турция)`;
    }
    const hasPc = /ПК/i.test(t);
    return duration
      ? `Xbox Game Pass Ultimate — ${duration}${hasPc ? ' (Xbox + ПК)' : ''}`
      : t.replace(/\s*\(Россия,\s*без ВПН\)/i, '').trim();
  }

  // Strip marketing suffixes separated by "|"
  t = t.split('|')[0].trim();

  // Strip trailing "(Любой аккаунт)", "(Турция)", "/ Предзаказ"
  t = t
    .replace(/\s*\/\s*Предзаказ$/i, '')
    .replace(/\s*\((?:Любой аккаунт|Турция)\)\s*/gi, ' ')
    .replace(/\s*для\s+Sony\s+PlayStation\b.*$/i, '')
    .replace(/\s*для\s+Xbox(?:\s+One|\s+Series|\s+X\|S|\s+и\s+Series|\s*\|\s*Series)*\s*$/i, '')
    .replace(/\s*\[Xbox(?:\s+X\|S)?\]\s*$/i, '')
    .replace(/\s*XBOX\s+(?:ONE|X\/S|X\|S|SERIES).*$/i, '')
    .replace(/\s*XBOX\s*$/i, '')
    .replace(/\bStandart\b/g, 'Standard')
    .replace(/\bСТАНДАРТ\b/g, 'Standard Edition')
    .replace(/\s+Full Game$/i, '')
    .replace(/\s+Standard$/i, ' Standard Edition')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-:]+$/, '')
    .trim();

  // Convert ALL-CAPS Xbox key titles into readable Title Case
  const letters = t.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
  const upperLetters = letters.replace(/[^A-ZА-ЯЁ]/g, '');
  if (letters.length > 4 && upperLetters.length / letters.length > 0.78) {
    t = t
      .toLowerCase()
      .replace(/(^|[\s:\-\/(])([a-zа-яё])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
      .replace(/\b(Ii|Iii|Iv|Vi|Vii|Nfs|Dlc|Pc|Xbox|Ps5|Ps4)\b/g, (m) => m.toUpperCase());
  }

  return t;
}

function extractPlatformLabel(raw: RawCatalogItem, isSubscription: boolean): string {
  if (raw.platform === 'PlayStation') {
    if (/PS4/i.test(raw.title) && /PS5/i.test(raw.title)) return 'PS4 / PS5';
    if (/PS4/i.test(raw.title)) return 'PlayStation 4';
    return 'PlayStation 5';
  }
  if (isSubscription) {
    return /ПК/i.test(raw.title) ? 'Xbox One / Series X|S / ПК' : 'Xbox One / Series X|S';
  }
  if (/PC|WINDOWS/i.test(raw.title)) {
    return 'Xbox Series X|S / ПК';
  }
  if (/Xbox One/i.test(raw.title)) {
    return 'Xbox One / Series X|S';
  }
  return 'Xbox Series X|S';
}

function extractEditionLabel(cleanTitle: string, raw: RawCatalogItem, isSubscription: boolean): string {
  if (isSubscription) {
    const m = raw.title.match(/(\d+\s*месяц(?:а|ев)?)/i);
    const isPsPlus = raw.platform === 'PlayStation' || /ps\s*plus|playstation\s*plus/i.test(raw.title);
    if (isPsPlus) {
      const tierMatch = raw.title.match(/\b(Deluxe|Extra|Essential)\b/i);
      const tier = tierMatch
        ? tierMatch[1].charAt(0).toUpperCase() + tierMatch[1].slice(1).toLowerCase()
        : '';
      const base = tier ? `PS Plus ${tier}` : 'PS Plus';
      return m ? `${base} · ${m[1]}` : base;
    }
    return m ? `Подписка ${m[1]}` : 'Подписка Ultimate';
  }
  const patterns: [RegExp, string][] = [
    [/Ultimate Plus Edition/i, 'Ultimate Plus Edition'],
    [/Super Deluxe Edition/i, 'Super Deluxe Edition'],
    [/Digital Deluxe Edition/i, 'Digital Deluxe Edition'],
    [/Ultimate Edition/i, 'Ultimate Edition'],
    [/Premium Edition/i, 'Premium Edition'],
    [/Phantom Edition/i, 'Phantom Edition'],
    [/Vault Edition/i, 'Vault Edition'],
    [/Gold Edition/i, 'Gold Edition'],
    [/Gourmet Edition/i, 'Gourmet Edition'],
    [/Deluxe Edition/i, 'Deluxe Edition'],
    [/\bDeluxe\b/i, 'Deluxe Edition'],
    [/Cross-Gen Bundle/i, 'Cross-Gen Bundle'],
    [/Year One Pass/i, 'Year One Pass (DLC)'],
    [/Duo Bundle/i, 'Duo Bundle'],
    [/Standard Edition/i, 'Standard Edition'],
  ];
  for (const [re, label] of patterns) {
    if (re.test(cleanTitle)) return label;
  }
  if (detectKey(raw)) return 'Цифровой ключ (Standard)';
  return 'Standard Edition';
}

function extractSeriesKey(cleanTitle: string, isSubscription: boolean): string {
  if (isSubscription) {
    return /ps\s*plus|playstation\s*plus/i.test(cleanTitle)
      ? 'playstation-plus'
      : 'xbox-game-pass-ultimate';
  }
  return cleanTitle
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(
      /\s*[-:]?\s*(?:ultimate plus|super deluxe|digital deluxe|ultimate|premium|phantom|vault|gold|deluxe|standard|cross-gen bundle|gourmet|majorariatto duo bundle|duo bundle)\s*(?:edition)?$/i,
      ''
    )
    .replace(/\s*[-:]?\s*(?:edition|bundle)$/i, '')
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
    .trim();
}

function parseGenre(raw: RawCatalogItem, cleanTitle: string, isSubscription: boolean): string {
  if (isSubscription) return 'Подписка · Каталог 400+ игр';

  const psMatch = raw.description.match(/Жанр:\s*([^\n]+?)(?:\s+Локализация:|$)/);
  if (psMatch) {
    const parts = psMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((g) => GENRE_TRANSLATIONS[g] || g);
    const unique = Array.from(new Set(parts)).slice(0, 2);
    if (unique.length > 0) return unique.join(' · ');
  }

  const lower = `${cleanTitle} ${raw.description}`.toLowerCase();
  if (/forza|need for speed|nfs|trackmania|racing/.test(lower)) return 'Гонки';
  if (/fc 27|fc 26|футбол/.test(lower)) return 'Спорт · Футбол';
  if (/mortal kombat|tekken|injustice/.test(lower)) return 'Файтинг';
  if (/silent hill|little nightmares|dying light/.test(lower)) return 'Хоррор · Выживание';
  if (/doom|battlefield|call of duty|wolfenstein|painkiller|quake|rage 2|borderlands|gears of war/.test(lower)) {
    return 'Шутер · Экшен';
  }
  if (/kingdom come|clair obscur|fallout|deus ex|surge 2|dishonored|prey/.test(lower)) {
    return 'RPG · Экшен';
  }
  if (/gta 6|mafia|assassin|precinct|ghostwire|deathloop/.test(lower)) {
    return 'Экшен · Приключения';
  }
  if (/jurassic world/.test(lower)) return 'Стратегия · Симулятор';
  if (/silksong|split fiction|arise|overcooked|gungeon|huntdown|ghostbusters|masters of anima|indie bundle/.test(lower)) {
    return 'Приключения · Инди';
  }
  return 'Экшен · Приключения';
}

function parseReleaseInfo(raw: RawCatalogItem): { year: string; date?: string } {
  const isoMatch = raw.description.match(/Дата выхода:\s*(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return {
      year: isoMatch[1],
      date: `${isoMatch[3]}.${isoMatch[2]}.${isoMatch[1]}`,
    };
  }
  const ruDateMatch = raw.description.match(/(?:Дата выхода|Выход игры)[^0-9]*(\d{2})\.(\d{2})\.(\d{4})/i);
  if (ruDateMatch) {
    return {
      year: ruDateMatch[3],
      date: `${ruDateMatch[1]}.${ruDateMatch[2]}.${ruDateMatch[3]}`,
    };
  }
  if (/gta 6|fc 27|forza horizon 6/i.test(raw.title)) {
    return { year: '2026' };
  }
  return { year: '2025' };
}

function parseLocalization(raw: RawCatalogItem, isSubscription: boolean): {
  hasRussian: boolean;
  label: string;
} {
  if (isSubscription) {
    return { hasRussian: true, label: 'Интерфейс на русском (зависит от игры)' };
  }
  if (/отсутствует русская локализация/i.test(raw.description)) {
    return { hasRussian: false, label: 'Английский (без русской локализации)' };
  }
  if (/полностью на русском/i.test(raw.title)) {
    return { hasRussian: true, label: 'Полная русская локализация' };
  }
  if (/интерфейс \+ субтитры на русском|субтитры на русском/i.test(raw.title)) {
    return { hasRussian: true, label: 'Русские субтитры и интерфейс' };
  }

  const locMatch = raw.description.match(/Локализация:\s*([A-Za-z,\s]+)/);
  if (locMatch) {
    const locRaw = locMatch[1].trim();
    const hasRu = raw.hasRussian || /russian/i.test(locRaw);
    return {
      hasRussian: hasRu,
      label: hasRu ? 'Русский и английский' : 'Английский (English)',
    };
  }

  if (raw.hasRussian) {
    return { hasRussian: true, label: 'Русский язык подтверждён' };
  }
  return { hasRussian: false, label: 'Английский / уточняется по региону' };
}

function cleanDescription(raw: RawCatalogItem): { shortDesc: string; fullDesc: string } {
  let text = raw.description.trim();

  // Strip PS5 metadata header block ("... Платформа: PS5 Дата выхода: ... Локализация: English")
  const psHeaderRegex =
    /^.*?Платформа:\s*[^\n]+?Дата выхода:\s*\d{4}-\d{2}-\d{2}\s+Издатель:\s*[^\n]+?Жанр:\s*[^\n]+?Локализация:\s*(?:English(?:,\s*Russian)?|Russian(?:,\s*English)?)\s*/i;
  if (psHeaderRegex.test(text)) {
    text = text.replace(psHeaderRegex, '').trim();
  }

  // Strip duplicate title prefix if present
  if (text.startsWith(raw.title)) {
    text = text.slice(raw.title.length).replace(/^[\s.]+/, '').trim();
  }

  // Replace "no account data required" subscription boilerplate so customers know personal account top-up is available
  text = text.replace(
    /^(?:Подписка\s+Ps\s+Plus\s+Турция\s*)?Никакие\s+данные\s+от\s+ваших\s+аккаунтов\s+не\s+просим\..*?Все\s+сохранения\s+и\s+достижения\s+у\s+вас\s+будут\s+работать\s+на\s+старом\s+аккаунте!\s*/i,
    'Оформляем подписку прямо на ваш личный аккаунт или с выдачей готового профиля на выбор. '
  );

  // Strip trailing email-code boilerplate ("Инструкция:1. Скопируйте код с почты...")
  text = text.replace(/\s*Инструкция:\s*1\..*$/i, '').trim();

  // Remove any remaining mentions of contacting via email in raw descriptions
  text = text
    .replace(/(?:на\s+)?электронную?\s+почт[уые]|по\s+email|через\s+e-?mail/gi, 'в Telegram (https://t.me/GyberGameStore)')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!text) {
    text = 'Быстрое официальное оформление за 5–15 минут.';
  }

  const shortDesc =
    text.length > 155 ? `${text.slice(0, 152).replace(/[\s,.;:]+$/, '')}…` : text;

  const fullDesc = /t\.me\/GyberGameStore/i.test(text)
    ? text
    : `${text}\n\nСвязь и оформление заказа в Telegram: https://t.me/GyberGameStore`;

  return { shortDesc, fullDesc };
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

function computeFeaturedScore(
  cleanTitle: string,
  hasRussian: boolean,
  discountPercent: number,
  isSubscription: boolean,
  isPreorder: boolean,
  price: number
): number {
  let score = 20;
  for (const [re, bonus] of FEATURED_TITLE_SCORES) {
    if (re.test(cleanTitle)) {
      score = Math.max(score, bonus);
      break;
    }
  }
  if (isSubscription) score += 15;
  if (discountPercent > 0) score += 10;
  if (hasRussian && score < 70) score += 28;
  if (isPreorder) score += 4;
  // Slightly deprioritize repetitive ultra-budget clones unless searched/filtered
  if (/^cazzarion\b/i.test(cleanTitle)) score -= 12;
  if (price >= 3500 && score < 50) score += 6;
  return score;
}

export function mapRawToProduct(raw: RawCatalogItem): StoreProduct {
  const isSubscription = detectSubscription(raw);
  const isKey = detectKey(raw);
  const isPreorder = detectPreorder(raw);
  const platformGroup: 'ps' | 'xbox' = raw.platform === 'PlayStation' ? 'ps' : 'xbox';
  const categoryType: 'games' | 'subscriptions' = isSubscription ? 'subscriptions' : 'games';
  const deliveryType: 'account' | 'key' | 'subscription' = isSubscription
    ? 'subscription'
    : isKey
      ? 'key'
      : 'account';

  const title = cleanDisplayTitle(raw, isSubscription);
  const platformLabel = extractPlatformLabel(raw, isSubscription);
  const editionLabel = extractEditionLabel(title, raw, isSubscription);
  const seriesKey = extractSeriesKey(title, isSubscription);
  const genre = parseGenre(raw, title, isSubscription);
  const releaseInfo = parseReleaseInfo(raw);
  const loc = parseLocalization(raw, isSubscription);
  const { shortDesc, fullDesc } = cleanDescription(raw);

  const regionLabel = isSubscription
    ? platformGroup === 'ps'
      ? 'Турция'
      : 'Россия, без ВПН'
    : raw.region === 'Турция'
      ? 'Турция'
      : raw.region === 'Global'
        ? 'Global'
        : isKey
          ? 'Любой аккаунт'
          : 'Любой аккаунт';

  const deliveryLabel =
    deliveryType === 'subscription'
      ? 'На ваш аккаунт или готовый профиль'
      : deliveryType === 'key'
        ? 'Ключ на ваш аккаунт'
        : platformGroup === 'ps'
          ? 'Покупка на турецкий аккаунт'
          : 'Покупка на любой аккаунт';

  const oldPriceRub =
    typeof raw.oldPrice === 'number' && Number.isFinite(raw.oldPrice) && raw.oldPrice > raw.price
      ? Math.round(raw.oldPrice)
      : 0;
  const discountPercent =
    oldPriceRub > raw.price ? Math.round((1 - raw.price / oldPriceRub) * 100) : 0;

  const variantNote = isPreorder
    ? `${deliveryLabel} · Предзаказ`
    : deliveryLabel;

  const deliveryTimeNote =
    deliveryType === 'key'
      ? 'Цифровой ключ · 5–15 мин'
      : deliveryType === 'subscription'
        ? 'Оформление подписки · 5–15 мин'
        : platformGroup === 'ps'
          ? 'Покупка в турецком PS Store · 5–15 мин'
          : 'Оформление на аккаунт Xbox · 5–15 мин';

  const fallbackTone =
    platformGroup === 'ps'
      ? 'from-slate-900 via-blue-950 to-zinc-900'
      : isSubscription
        ? 'from-emerald-950 via-zinc-900 to-neutral-950'
        : 'from-zinc-900 via-neutral-900 to-stone-900';

  const featuredScore = computeFeaturedScore(
    title,
    loc.hasRussian,
    discountPercent,
    isSubscription,
    isPreorder,
    raw.price
  );

  return {
    id: raw.id,
    sku: raw.sku,
    slug: slugify(title, raw.id),
    title,
    rawTitle: raw.title,
    editionLabel,
    seriesKey,
    platformLabel,
    platformGroup,
    categoryType,
    deliveryType,
    deliveryLabel,
    regionLabel,
    isPreorder,
    hasRussian: loc.hasRussian,
    brand: raw.brand || (platformGroup === 'ps' ? 'PlayStation' : 'Xbox'),
    genre,
    releaseYear: releaseInfo.year,
    releaseDate: releaseInfo.date,
    language: loc.label,
    rating: 5.0,
    featuredScore,
    image: raw.image,
    fallbackTone,
    shortDescription: shortDesc,
    fullDescription: fullDesc,
    activationSteps: buildActivationSteps(platformGroup, deliveryType),
    variants: [
      {
        id: `sku-${raw.sku}`,
        label: `${editionLabel} · ${regionLabel}`,
        editionNote: variantNote,
        oldPriceRub,
        priceRub: Math.round(raw.price),
        discountPercent,
        deliveryNote: deliveryTimeNote,
        inStock: true,
      },
    ],
  };
}

export const STORE_PRODUCTS: StoreProduct[] = RAW_CATALOG_ITEMS.map(mapRawToProduct).sort(
  (a, b) => b.featuredScore - a.featuredScore || a.title.localeCompare(b.title, 'ru')
);

export const CATALOG_STATS = {
  total: STORE_PRODUCTS.length,
  xboxGames: STORE_PRODUCTS.filter((p) => p.platformGroup === 'xbox' && p.categoryType === 'games').length,
  psGames: STORE_PRODUCTS.filter((p) => p.platformGroup === 'ps').length,
  subscriptions: STORE_PRODUCTS.filter((p) => p.categoryType === 'subscriptions').length,
  keys: STORE_PRODUCTS.filter((p) => p.deliveryType === 'key').length,
  preorders: STORE_PRODUCTS.filter((p) => p.isPreorder).length,
  withRussian: STORE_PRODUCTS.filter((p) => p.hasRussian).length,
  discounted: STORE_PRODUCTS.filter((p) => p.variants[0].discountPercent > 0).length,
};

export function getRelatedEditions(product: StoreProduct): StoreProduct[] {
  if (!product.seriesKey) return [];
  const siblings = STORE_PRODUCTS.filter(
    (item) =>
      item.platformGroup === product.platformGroup &&
      item.seriesKey === product.seriesKey
  );
  if (siblings.length <= 1) return [];
  return siblings.sort((a, b) => a.variants[0].priceRub - b.variants[0].priceRub);
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-delivery',
    question: 'Как быстро игра или подписка появляется на аккаунте?',
    answer:
      'Оформление покупки в PlayStation Store, Microsoft Store или выдача ключа занимает от 5 до 15 минут в рабочее время поддержки (ежедневно с 10:00 до 23:00 МСК). После оплаты вы получаете подтверждение и сразу ставите игру на загрузку.',
  },
  {
    id: 'faq-new-account',
    question: 'Что делать, если у меня ещё нет турецкого аккаунта PlayStation или Xbox?',
    answer:
      'При оформлении заказа отметьте в корзине пункт «Нужно помочь создать турецкий аккаунт». Мы бесплатно зарегистрируем личный турецкий профиль, передадим данные в Telegram (@GyberGameStore) и купим на него выбранную игру или подписку.',
  },
  {
    id: 'faq-russian-profile',
    question: 'Смогу ли я играть и получать достижения на своём основном российском аккаунте?',
    answer:
      'Да. После загрузки игры или активации подписки Game Pass включите функцию «Общий доступ к консоли» (на PS4/PS5) или «Домашняя консоль» (на Xbox). После этого запускайте игры с основного российского профиля — все трофеи и сохранения останутся на нём.',
  },
  {
    id: 'faq-keys',
    question: 'Чем отличается ключ Xbox от покупки игры на аккаунт?',
    answer:
      'Игры с пометкой «Ключ на ваш аккаунт» активируются цифровым 25-значным кодом прямо на ваш личный профиль Microsoft. Игры с пометкой «Покупка на аккаунт» официально приобретаются менеджером напрямую в магазине Sony или Microsoft на ваш профиль навсегда.',
  },
  {
    id: 'faq-refund',
    question: 'Какие условия возврата действуют на заказ?',
    answer:
      'Вы можете отказаться от заказа и получить 100% возврат средств в любой момент до фактической оплаты игры в магазине или отправки цифрового ключа.',
  },
];
