import { useState } from 'react';
import { Menu, Receipt, ShoppingBag, X } from 'lucide-react';
import type { PlatformFilter } from '../data/storeData';

export type AppRoute =
  | 'home'
  | 'catalog'
  | 'delivery'
  | 'about'
  | 'privacy'
  | 'terms'
  | 'contacts'
  | 'admin';

interface HeaderProps {
  activeRoute: AppRoute;
  activePlatform?: PlatformFilter;
  cartCount: number;
  savedOrdersCount: number;
  onNavigate: (route: AppRoute, sectionId?: string) => void;
  onSelectPlatform: (platform: PlatformFilter) => void;
  onOpenCart: () => void;
  onOpenMyOrders: () => void;
}

export function Header({
  activeRoute,
  activePlatform,
  cartCount,
  savedOrdersCount,
  onNavigate,
  onSelectPlatform,
  onOpenCart,
  onOpenMyOrders,
}: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (route: AppRoute, platform?: PlatformFilter) => {
    setMobileMenuOpen(false);
    if (platform) {
      onSelectPlatform(platform);
    }
    onNavigate(route);
  };

  return (
    <header className="sticky top-0 z-40 bg-black text-white border-b border-neutral-800">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand logo + wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleLinkClick('home', 'all');
          }}
          className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight text-white hover:text-[#52c44c] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#52c44c] focus-visible:outline-offset-4 rounded-sm"
        >
          <img
            src="/assets/aistudio/image_7c19fec9.png"
            alt="CyberGameStore"
            width={32}
            height={32}
            className="w-8 h-8 rounded-lg object-contain shrink-0"
          />
          <span>CyberGameStore</span>
        </a>

        {/* Zone 2: 5 concise single-line nav links */}
        <nav
          aria-label="Основная навигация"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-200"
        >
          <a
            href="/xbox"
            onClick={(e) => {
              e.preventDefault();
              handleLinkClick('catalog', 'xbox');
            }}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-[#52c44c] hover:underline underline-offset-4 ${
              activeRoute === 'catalog' && activePlatform === 'xbox' ? 'text-[#52c44c] underline' : ''
            }`}
          >
            Игры Xbox
          </a>
          <a
            href="/playstation"
            onClick={(e) => {
              e.preventDefault();
              handleLinkClick('catalog', 'ps');
            }}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-[#52c44c] hover:underline underline-offset-4 ${
              activeRoute === 'catalog' && activePlatform === 'ps' ? 'text-[#52c44c] underline' : ''
            }`}
          >
            PlayStation
          </a>
          <a
            href="/subscriptions"
            onClick={(e) => {
              e.preventDefault();
              handleLinkClick('catalog', 'subscriptions');
            }}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-[#52c44c] hover:underline underline-offset-4 ${
              activeRoute === 'catalog' && activePlatform === 'subscriptions'
                ? 'text-[#52c44c] underline'
                : ''
            }`}
          >
            Подписки
          </a>
          <a
            href="/delivery"
            onClick={(e) => {
              e.preventDefault();
              handleLinkClick('delivery');
            }}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-[#52c44c] hover:underline underline-offset-4 ${
              activeRoute === 'delivery' ? 'text-[#52c44c] underline' : ''
            }`}
          >
            Доставка
          </a>
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              handleLinkClick('admin');
            }}
            className={`whitespace-nowrap shrink-0 py-1 transition-colors hover:text-[#52c44c] hover:underline underline-offset-4 ${
              activeRoute === 'admin' ? 'text-[#52c44c] underline' : ''
            }`}
          >
            Админка
          </a>
        </nav>

        {/* Zone 3: Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {savedOrdersCount > 0 && (
            <button
              type="button"
              onClick={onOpenMyOrders}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-100 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5 text-[#52c44c]" />
              <span className="tabular-nums">Мои покупки ({savedOrdersCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCart}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2"
          >
            <ShoppingBag className="w-4 h-4" strokeWidth={2} />
            <span className="tabular-nums">Корзина{cartCount > 0 ? ` (${cartCount})` : ''}</span>
          </button>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-neutral-700 text-white hover:bg-neutral-900 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation panel */}
      {mobileMenuOpen && (
        <nav
          aria-label="Мобильное меню"
          className="md:hidden border-t border-neutral-800 bg-black px-4 py-3 flex flex-col gap-1"
        >
          <button
            type="button"
            onClick={() => handleLinkClick('catalog', 'xbox')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Игры Xbox
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('catalog', 'ps')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Игры PlayStation
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('catalog', 'subscriptions')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Подписки Game Pass
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('delivery')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Оплата и доставка
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('contacts')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Контакты
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('about')}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            О магазине и документы
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenMyOrders();
            }}
            className="text-left px-3 py-2.5 text-sm font-medium text-neutral-100 rounded-lg hover:bg-neutral-900 cursor-pointer flex items-center justify-between"
          >
            <span>Мои покупки</span>
            {savedOrdersCount > 0 && (
              <span className="font-mono text-xs text-[#52c44c] tabular-nums">
                {savedOrdersCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('admin')}
            className="text-left px-3 py-2.5 text-sm font-semibold text-[#52c44c] rounded-lg hover:bg-neutral-900 cursor-pointer"
          >
            Админ-панель
          </button>
        </nav>
      )}
    </header>
  );
}
