import { useMemo, useState } from 'react';
import {
  Bell,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import {
  formatRub,
  type SaleChannel,
  type SalePaymentMethod,
  type SaleRecord,
  type SaleStatus,
} from '../../data/adminCatalog';

interface TelegramStatusInfo {
  available: boolean;
  hasBotToken: boolean;
  configured: boolean;
  chatCount: number;
  hasOnlyBotSelfId: boolean;
  notifyOnCreate: boolean;
}

interface AdminSalesTabProps {
  sales: SaleRecord[];
  syncingCheckout: boolean;
  syncNotice: string | null;
  telegramStatus: TelegramStatusInfo | null;
  testingTelegram: boolean;
  detectingTelegram: boolean;
  detectedTelegramChats: Array<{ id: string; label: string; type: string }>;
  telegramNotice: { ok: boolean; text: string } | null;
  onAddSale: () => void;
  onEditSale: (sale: SaleRecord) => void;
  onUpdateStatus: (sale: SaleRecord, nextStatus: SaleStatus) => Promise<void>;
  onDeleteSale: (saleId: string) => Promise<void>;
  onSyncServerOrders: () => Promise<void>;
  onTestTelegram: () => Promise<void>;
  onDetectTelegramChats: () => Promise<void>;
}

const STATUS_LABELS: Record<SaleStatus, { label: string; colorClass: string }> = {
  paid: { label: 'Оплачен', colorClass: 'text-emerald-700' },
  pending: { label: 'В обработке', colorClass: 'text-amber-700' },
  refunded: { label: 'Возврат', colorClass: 'text-red-700' },
  cancelled: { label: 'Отменён', colorClass: 'text-neutral-500' },
};

const CHANNEL_LABELS: Record<SaleChannel, string> = {
  site: 'Сайт',
  telegram: 'Telegram',
  avito: 'Avito',
  wildberries: 'Wildberries',
};

const METHOD_LABELS: Record<SalePaymentMethod, string> = {
  sbp: 'СБП',
  card: 'Карта РФ',
  transfer: 'Перевод',
};

function formatDateRu(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function AdminSalesTab({
  sales,
  syncingCheckout,
  syncNotice,
  telegramStatus,
  testingTelegram,
  detectingTelegram,
  detectedTelegramChats,
  telegramNotice,
  onAddSale,
  onEditSale,
  onUpdateStatus,
  onDeleteSale,
  onSyncServerOrders,
  onTestTelegram,
  onDetectTelegramChats,
}: AdminSalesTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatus>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | SaleChannel>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (channelFilter !== 'all' && s.channel !== channelFilter) return false;
        if (!q) return true;
        return (
          s.id.toLowerCase().includes(q) ||
          s.productTitle.toLowerCase().includes(q) ||
          s.customerName.toLowerCase().includes(q) ||
          s.customerContact.toLowerCase().includes(q) ||
          s.note.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id.localeCompare(a.id));
  }, [sales, statusFilter, channelFilter, search]);

  const summary = useMemo(() => {
    const paid = filtered.filter((s) => s.status === 'paid');
    const revenue = paid.reduce((acc, s) => acc + s.totalRub, 0);
    return { count: filtered.length, paidCount: paid.length, revenue };
  }, [filtered]);

  const handleExportCsv = () => {
    const headers = [
      'Заказ',
      'Дата',
      'Товар',
      'Кол-во',
      'Цена (₽)',
      'Сумма (₽)',
      'Статус',
      'Канал',
      'Оплата',
      'Покупатель',
      'Контакт',
      'Комментарий',
    ];
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = filtered.map((s) => [
      s.id,
      s.orderDate,
      s.productTitle,
      s.quantity,
      s.unitPriceRub,
      s.totalRub,
      STATUS_LABELS[s.status].label,
      CHANNEL_LABELS[s.channel],
      METHOD_LABELS[s.paymentMethod],
      s.customerName,
      s.customerContact,
      s.note,
    ]);
    const csv =
      '\uFEFF' + [headers.map(escape).join(';'), ...rows.map((r) => r.map(escape).join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cybergamestore-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Actions Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру, товару, клиенту..."
            className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:border-[#52c44c]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncingCheckout}
            onClick={() => void onSyncServerOrders()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-800 bg-white border border-neutral-200 hover:border-[#52c44c] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingCheckout ? 'animate-spin' : ''}`} />
            <span>Синхронизировать с кассой</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-800 bg-white border border-neutral-200 hover:border-neutral-400 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Экспорт CSV</span>
          </button>

          <button
            type="button"
            onClick={onAddSale}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить продажу</span>
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="px-4 py-2.5 rounded-lg bg-white border border-neutral-200 text-xs text-neutral-700">
          {syncNotice}
        </div>
      )}

      {telegramStatus && (
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Bell
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  telegramStatus.configured ? 'text-[#52c44c]' : 'text-amber-600'
                }`}
              />
              <div className="space-y-1 text-xs">
                <div className="font-semibold text-neutral-900">
                  Оповещения о покупках в Telegram:{' '}
                  <span
                    className={
                      telegramStatus.configured ? 'text-emerald-700' : 'text-amber-700'
                    }
                  >
                    {telegramStatus.configured
                      ? `подключены (получателей: ${telegramStatus.chatCount})`
                      : telegramStatus.hasOnlyBotSelfId
                        ? 'указан ID самого бота вместо вашего личного ID'
                        : telegramStatus.available
                          ? 'не настроены'
                          : 'доступны при запуске Node-сервера'}
                  </span>
                </div>
                {telegramStatus.configured ? (
                  <p className="text-neutral-600 leading-relaxed">
                    Бот автоматически присылает заказ, сумму, контакты покупателя и состав корзины
                    сразу после оплаты
                    {telegramStatus.notifyOnCreate
                      ? ' (а также при создании нового заказа).'
                      : '.'}
                  </p>
                ) : telegramStatus.hasOnlyBotSelfId ? (
                  <p className="text-neutral-600 leading-relaxed">
                    В <code className="font-mono">TELEGRAM_CHAT_ID</code> сейчас вписан ID самого
                    бота (число из начала токена), а бот не может писать сам себе. Откройте бота в
                    Telegram, нажмите <code className="font-mono">/start</code> и нажмите «Найти
                    мой Chat ID», затем впишите найденный ID в{' '}
                    <code className="font-mono">TELEGRAM_CHAT_ID</code>.
                  </p>
                ) : telegramStatus.available ? (
                  <p className="text-neutral-600 leading-relaxed">
                    1) Создайте бота у <code className="font-mono">@BotFather</code> и задайте{' '}
                    <code className="font-mono">TELEGRAM_BOT_TOKEN</code>. 2) Нажмите{' '}
                    <code className="font-mono">/start</code> в своём боте и узнайте ваш ID через{' '}
                    <code className="font-mono">@userinfobot</code> (или кнопку «Найти мой Chat
                    ID»). 3) Задайте <code className="font-mono">TELEGRAM_CHAT_ID</code> в секретах
                    сервера.
                  </p>
                ) : (
                  <p className="text-neutral-600 leading-relaxed">
                    На статическом хостинге без backend (/api) токен бота нельзя хранить в
                    браузере. Запустите сайт с Node-сервером и задайте{' '}
                    <code className="font-mono">TELEGRAM_BOT_TOKEN</code> и{' '}
                    <code className="font-mono">TELEGRAM_CHAT_ID</code>.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {telegramStatus.hasBotToken && !telegramStatus.configured && (
                <button
                  type="button"
                  disabled={detectingTelegram}
                  onClick={() => void onDetectTelegramChats()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[#52c44c]" />
                  <span>{detectingTelegram ? 'Поиск...' : 'Найти мой Chat ID'}</span>
                </button>
              )}

              {telegramStatus.configured && (
                <button
                  type="button"
                  disabled={testingTelegram}
                  onClick={() => void onTestTelegram()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 text-[#52c44c]" />
                  <span>{testingTelegram ? 'Отправка...' : 'Отправить тест'}</span>
                </button>
              )}
            </div>
          </div>

          {detectedTelegramChats.length > 0 && (
            <div className="px-3 py-2.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-1.5 text-xs">
              <div className="font-semibold text-neutral-800">
                Найденные чаты (вставьте нужное значение в секрет{' '}
                <code className="font-mono">TELEGRAM_CHAT_ID</code>):
              </div>
              <div className="flex flex-wrap gap-2">
                {detectedTelegramChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-white border border-neutral-200"
                  >
                    <span className="text-neutral-700">{chat.label}:</span>
                    <code className="font-mono font-bold text-neutral-900 select-all">
                      {chat.id}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {telegramNotice && (
            <div
              className={`px-3 py-2 rounded-md text-xs border ${
                telegramNotice.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {telegramNotice.text}
            </div>
          )}
        </div>
      )}

      {/* Filters & Summary Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-200/70 rounded-lg">
            {(
              [
                { id: 'all', label: 'Все статусы' },
                { id: 'paid', label: 'Оплачен' },
                { id: 'pending', label: 'В обработке' },
                { id: 'refunded', label: 'Возврат' },
                { id: 'cancelled', label: 'Отменён' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Фильтр по каналу"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value as 'all' | SaleChannel)}
            className="px-3 py-1.5 text-xs font-semibold bg-white border border-neutral-200 rounded-lg text-neutral-700 focus:outline-none focus:border-[#52c44c] cursor-pointer"
          >
            <option value="all">Все каналы</option>
            <option value="site">Сайт</option>
            <option value="telegram">Telegram</option>
            <option value="avito">Avito</option>
            <option value="wildberries">Wildberries</option>
          </select>
        </div>

        <div className="text-xs text-neutral-600 font-mono tabular-nums">
          Записей: {summary.count} · Оплачено ({summary.paidCount}):{' '}
          <span className="font-bold text-neutral-900">{formatRub(summary.revenue)}</span>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-neutral-900">Продаж по фильтру не найдено</p>
            <p className="text-xs text-neutral-500">
              Добавьте заказ вручную или синхронизируйте новые оплаты с кассы магазина.
            </p>
            <button
              type="button"
              onClick={onAddSale}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg cursor-pointer"
            >
              Добавить продажу
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                  <th className="py-3 px-4">Заказ и дата</th>
                  <th className="py-3 px-3">Товар</th>
                  <th className="py-3 px-3">Покупатель и канал</th>
                  <th className="py-3 px-3 text-right">Сумма</th>
                  <th className="py-3 px-3">Статус</th>
                  <th className="py-3 px-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-xs">
                {filtered.map((sale) => (
                  <tr key={sale.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono font-semibold text-neutral-900 tabular-nums">
                        {sale.id}
                      </div>
                      <div className="font-mono text-[11px] text-neutral-500 tabular-nums">
                        {formatDateRu(sale.orderDate)}
                      </div>
                    </td>

                    <td className="py-3 px-3 min-w-[220px]">
                      <div className="font-semibold text-neutral-900 line-clamp-1">
                        {sale.productTitle}
                      </div>
                      <div className="text-[11px] text-neutral-500 tabular-nums">
                        {sale.quantity} шт. × {formatRub(sale.unitPriceRub)}
                        {sale.note ? ` · ${sale.note}` : ''}
                      </div>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="font-medium text-neutral-900">{sale.customerName}</div>
                      <div className="text-[11px] text-neutral-500">
                        {CHANNEL_LABELS[sale.channel]} · {METHOD_LABELS[sale.paymentMethod]}
                        {sale.customerContact ? ` · ${sale.customerContact}` : ''}
                      </div>
                    </td>

                    <td className="py-3 px-3 text-right font-mono font-bold text-neutral-900 whitespace-nowrap tabular-nums">
                      {formatRub(sale.totalRub)}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <select
                        aria-label={`Статус заказа ${sale.id}`}
                        value={sale.status}
                        onChange={(e) => void onUpdateStatus(sale, e.target.value as SaleStatus)}
                        className={`px-2 py-1 text-xs font-semibold bg-white border border-neutral-200 rounded-md focus:outline-none focus:border-[#52c44c] cursor-pointer ${
                          STATUS_LABELS[sale.status].colorClass
                        }`}
                      >
                        <option value="paid">Оплачен</option>
                        <option value="pending">В обработке</option>
                        <option value="refunded">Возврат</option>
                        <option value="cancelled">Отменён</option>
                      </select>
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {confirmDeleteId === sale.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              void onDeleteSale(sale.id);
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
                            onClick={() => onEditSale(sale)}
                            title="Редактировать продажу"
                            className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sale.id)}
                            title="Удалить запись"
                            className="p-1.5 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-md cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
