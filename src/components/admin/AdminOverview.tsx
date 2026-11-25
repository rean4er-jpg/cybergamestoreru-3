import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowUpRight, Plus } from 'lucide-react';
import { formatRub, type SaleChannel, type SaleRecord } from '../../data/adminCatalog';

interface AdminOverviewProps {
  sales: SaleRecord[];
  activeCatalogCount: number;
  customOverridesCount: number;
  onOpenAddProduct: () => void;
  onOpenAddSale: () => void;
  onSwitchTab: (tab: 'overview' | 'products' | 'sales') => void;
}

const MONTH_NAMES_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

const CHANNEL_LABELS: Record<SaleChannel, string> = {
  site: 'Сайт',
  telegram: 'Telegram',
  avito: 'Avito',
  wildberries: 'Wildberries',
};

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return ym;
  return `${MONTH_NAMES_RU[m - 1]} ${y}`;
}

export function AdminOverview({
  sales,
  activeCatalogCount,
  customOverridesCount,
  onOpenAddProduct,
  onOpenAddSale,
  onSwitchTab,
}: AdminOverviewProps) {
  const currentYm = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const availableMonths = useMemo(() => {
    const set = new Set<string>([currentYm]);
    for (const s of sales) {
      if (s.orderDate && s.orderDate.length >= 7) {
        set.add(s.orderDate.slice(0, 7));
      }
    }
    return Array.from(set).sort().reverse();
  }, [sales, currentYm]);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentYm);
  const [channelFilter, setChannelFilter] = useState<'all' | SaleChannel>('all');
  const [chartMetric, setChartMetric] = useState<'revenue' | 'orders'>('revenue');

  const monthSales = useMemo(() => {
    return sales.filter((s) => {
      const matchesMonth = s.orderDate.startsWith(selectedMonth);
      const matchesChannel = channelFilter === 'all' || s.channel === channelFilter;
      return matchesMonth && matchesChannel;
    });
  }, [sales, selectedMonth, channelFilter]);

  const paidSales = useMemo(
    () => monthSales.filter((s) => s.status === 'paid'),
    [monthSales]
  );

  const pendingSales = useMemo(
    () => monthSales.filter((s) => s.status === 'pending'),
    [monthSales]
  );

  const metrics = useMemo(() => {
    const totalRevenue = paidSales.reduce((acc, s) => acc + s.totalRub, 0);
    const totalOrders = paidSales.length;
    const totalUnits = paidSales.reduce((acc, s) => acc + s.quantity, 0);
    const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const activeDays = new Set(paidSales.map((s) => s.orderDate)).size;
    const avgDailyRevenue = activeDays > 0 ? Math.round(totalRevenue / activeDays) : 0;
    const pendingRevenue = pendingSales.reduce((acc, s) => acc + s.totalRub, 0);

    return {
      totalRevenue,
      totalOrders,
      totalUnits,
      avgCheck,
      avgDailyRevenue,
      pendingCount: pendingSales.length,
      pendingRevenue,
    };
  }, [paidSales, pendingSales]);

  // Build full daily series for the selected month (1 .. daysInMonth)
  const dailySeries = useMemo(() => {
    const [yearNum, monthNum] = selectedMonth.split('-').map(Number);
    const daysInMonth =
      yearNum && monthNum ? new Date(yearNum, monthNum, 0).getDate() : 30;
    const mm = String(monthNum || 1).padStart(2, '0');

    const map = new Map<
      string,
      { revenue: number; orders: number; units: number }
    >();
    for (const s of paidSales) {
      const existing = map.get(s.orderDate) || { revenue: 0, orders: 0, units: 0 };
      existing.revenue += s.totalRub;
      existing.orders += 1;
      existing.units += s.quantity;
      map.set(s.orderDate, existing);
    }

    const rows: Array<{
      date: string;
      dayLabel: string;
      fullDateLabel: string;
      revenue: number;
      orders: number;
      units: number;
      avgCheck: number;
    }> = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, '0');
      const iso = `${selectedMonth}-${dd}`;
      const bucket = map.get(iso) || { revenue: 0, orders: 0, units: 0 };
      rows.push({
        date: iso,
        dayLabel: `${dd}.${mm}`,
        fullDateLabel: `${dd}.${mm}.${yearNum}`,
        revenue: bucket.revenue,
        orders: bucket.orders,
        units: bucket.units,
        avgCheck: bucket.orders > 0 ? Math.round(bucket.revenue / bucket.orders) : 0,
      });
    }
    return rows;
  }, [selectedMonth, paidSales]);

  // Top-selling products for the selected month
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      {
        title: string;
        platform: string;
        units: number;
        orders: number;
        revenue: number;
      }
    >();

    for (const s of paidSales) {
      const key = s.productTitle;
      const item = map.get(key) || {
        title: s.productTitle,
        platform:
          s.categoryType === 'subscriptions'
            ? 'Подписка'
            : s.platformGroup === 'ps'
              ? 'PlayStation'
              : 'Xbox',
        units: 0,
        orders: 0,
        revenue: 0,
      };
      item.units += s.quantity;
      item.orders += 1;
      item.revenue += s.totalRub;
      map.set(key, item);
    }

    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [paidSales]);

  // Breakdown by Channel
  const channelBreakdown = useMemo(() => {
    const totals: Record<SaleChannel, { revenue: number; orders: number }> = {
      site: { revenue: 0, orders: 0 },
      telegram: { revenue: 0, orders: 0 },
      avito: { revenue: 0, orders: 0 },
      wildberries: { revenue: 0, orders: 0 },
    };
    for (const s of paidSales) {
      totals[s.channel].revenue += s.totalRub;
      totals[s.channel].orders += 1;
    }
    const maxRev = Math.max(1, metrics.totalRevenue);
    return (Object.keys(totals) as SaleChannel[])
      .map((ch) => ({
        channel: ch,
        label: CHANNEL_LABELS[ch],
        revenue: totals[ch].revenue,
        orders: totals[ch].orders,
        sharePct: Math.round((totals[ch].revenue / maxRev) * 100),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [paidSales, metrics.totalRevenue]);

  // Breakdown by Platform/Category
  const platformBreakdown = useMemo(() => {
    const groups = [
      { id: 'xbox', label: 'Игры Xbox', revenue: 0, units: 0 },
      { id: 'ps', label: 'Игры PlayStation', revenue: 0, units: 0 },
      { id: 'subs', label: 'Подписки Game Pass', revenue: 0, units: 0 },
    ];
    for (const s of paidSales) {
      if (s.categoryType === 'subscriptions') {
        groups[2].revenue += s.totalRub;
        groups[2].units += s.quantity;
      } else if (s.platformGroup === 'ps') {
        groups[1].revenue += s.totalRub;
        groups[1].units += s.quantity;
      } else {
        groups[0].revenue += s.totalRub;
        groups[0].units += s.quantity;
      }
    }
    const total = Math.max(1, metrics.totalRevenue);
    return groups
      .map((g) => ({ ...g, sharePct: Math.round((g.revenue / total) * 100) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [paidSales, metrics.totalRevenue]);

  return (
    <div className="space-y-6">
      {/* Period & Channel Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Выбор месяца"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3.5 py-2 text-sm font-semibold bg-white border border-neutral-200 rounded-lg text-neutral-900 focus:outline-none focus:border-[#52c44c] cursor-pointer"
          >
            {availableMonths.map((ym) => (
              <option key={ym} value={ym}>
                {formatMonthLabel(ym)}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-neutral-200/70 rounded-lg">
            {(
              [
                { id: 'all', label: 'Все каналы' },
                { id: 'site', label: 'Сайт' },
                { id: 'telegram', label: 'Telegram' },
                { id: 'avito', label: 'Avito' },
                { id: 'wildberries', label: 'Wildberries' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChannelFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  channelFilter === opt.id
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenAddSale}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-800 bg-white border border-neutral-200 hover:border-[#52c44c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Записать продажу</span>
        </button>
      </div>

      {/* 4 Clean KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-1.5">
          <div className="text-xs font-medium text-neutral-500">Выручка за месяц</div>
          <div className="text-2xl font-mono font-bold text-neutral-900 tabular-nums">
            {formatRub(metrics.totalRevenue)}
          </div>
          <div className="text-xs text-neutral-500 tabular-nums">
            В среднем {formatRub(metrics.avgDailyRevenue)} / активный день
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-1.5">
          <div className="text-xs font-medium text-neutral-500">Оплаченные продажи</div>
          <div className="text-2xl font-mono font-bold text-neutral-900 tabular-nums">
            {metrics.totalOrders}
          </div>
          <div className="text-xs text-neutral-500 tabular-nums">
            {metrics.totalUnits} шт. выдано · в обработке: {metrics.pendingCount}
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-1.5">
          <div className="text-xs font-medium text-neutral-500">Средний чек</div>
          <div className="text-2xl font-mono font-bold text-neutral-900 tabular-nums">
            {formatRub(metrics.avgCheck)}
          </div>
          <div className="text-xs text-neutral-500 tabular-nums">
            {metrics.pendingRevenue > 0
              ? `Ожидает оплаты на ${formatRub(metrics.pendingRevenue)}`
              : 'Все текущие заказы обработаны'}
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-500">Активных товаров</span>
            <button
              type="button"
              onClick={onOpenAddProduct}
              className="text-xs font-semibold text-[#52c44c] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              + Добавить
            </button>
          </div>
          <div className="text-2xl font-mono font-bold text-neutral-900 tabular-nums">
            {activeCatalogCount}
          </div>
          <div className="text-xs text-neutral-500 tabular-nums">
            Изменено / добавлено в админке: {customOverridesCount}
          </div>
        </div>
      </div>

      {/* Interactive Monthly Revenue Chart */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-bold italic text-neutral-900">
              График выручки за {formatMonthLabel(selectedMonth).toLowerCase()}
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Динамика подтверждённых оплат по дням месяца
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setChartMetric('revenue')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMetric === 'revenue'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Выручка (₽)
            </button>
            <button
              type="button"
              onClick={() => setChartMetric('orders')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMetric === 'orders'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Заказы (шт.)
            </button>
          </div>
        </div>

        {paidSales.length === 0 ? (
          <div className="h-[280px] flex flex-col items-center justify-center text-center border border-dashed border-neutral-200 rounded-lg p-6 space-y-3">
            <p className="text-sm font-semibold text-neutral-900">
              Нет подтверждённых продаж за выбранный период
            </p>
            <p className="text-xs text-neutral-500 max-w-sm">
              Добавьте первую продажу вручную или выберите другой месяц, чтобы построить график выручки.
            </p>
            <button
              type="button"
              onClick={onOpenAddSale}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg cursor-pointer"
            >
              Добавить продажу
            </button>
          </div>
        ) : (
          <div className="h-[310px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMetric === 'revenue' ? (
                <AreaChart data={dailySeries} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cgsRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#52c44c" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#52c44c" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fontSize: 11, fill: '#737373' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                    minTickGap={22}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#737373' }}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(val: number) =>
                      val >= 1000 ? `${Math.round(val / 1000)} тыс.` : `${val} ₽`
                    }
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const point = payload[0].payload as (typeof dailySeries)[number];
                      return (
                        <div className="bg-[#111111] text-white px-3.5 py-2.5 rounded-lg border border-neutral-800 shadow-lg text-xs space-y-1">
                          <div className="font-mono text-neutral-400">{point.fullDateLabel}</div>
                          <div className="font-mono text-sm font-bold text-[#52c44c] tabular-nums">
                            {formatRub(point.revenue)}
                          </div>
                          <div className="text-neutral-300 tabular-nums">
                            Заказов: {point.orders} · Позиций: {point.units} шт.
                          </div>
                          {point.orders > 0 && (
                            <div className="text-neutral-400 tabular-nums">
                              Средний чек: {formatRub(point.avgCheck)}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#52c44c"
                    strokeWidth={2.25}
                    fill="url(#cgsRevenueFill)"
                    activeDot={{ r: 5, fill: '#52c44c', stroke: '#111111', strokeWidth: 2 }}
                  />
                </AreaChart>
              ) : (
                <BarChart data={dailySeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fontSize: 11, fill: '#737373' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                    minTickGap={22}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#737373' }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const point = payload[0].payload as (typeof dailySeries)[number];
                      return (
                        <div className="bg-[#111111] text-white px-3.5 py-2.5 rounded-lg border border-neutral-800 shadow-lg text-xs space-y-1">
                          <div className="font-mono text-neutral-400">{point.fullDateLabel}</div>
                          <div className="font-mono text-sm font-bold text-white tabular-nums">
                            {point.orders} заказов ({point.units} шт.)
                          </div>
                          <div className="font-mono text-[#52c44c] tabular-nums">
                            Выручка: {formatRub(point.revenue)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="orders" fill="#171717" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Bottom 2-Column Analytical Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Top-Selling Products */}
        <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold italic text-neutral-900">
                Топ позиций по выручке
              </h3>
              <p className="text-xs text-neutral-500">
                {formatMonthLabel(selectedMonth)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSwitchTab('sales')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-[#52c44c] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Все продажи</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topProducts.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-500">
              Данные появятся после подтверждения оплат в этом месяце.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                    <th className="py-2.5 px-5">Товар</th>
                    <th className="py-2.5 px-3 text-right">Шт.</th>
                    <th className="py-2.5 px-5 text-right">Выручка</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-xs">
                  {topProducts.map((row) => (
                    <tr key={row.title} className="hover:bg-neutral-50 transition-colors">
                      <td className="py-3 px-5">
                        <div className="font-semibold text-neutral-900 line-clamp-1">
                          {row.title}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {row.platform} · {row.orders} заказ.
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-neutral-700 tabular-nums">
                        {row.units}
                      </td>
                      <td className="py-3 px-5 text-right font-mono font-semibold text-neutral-900 tabular-nums whitespace-nowrap">
                        {formatRub(row.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Channel & Platform Breakdown */}
        <div className="lg:col-span-5 bg-white border border-neutral-200 rounded-lg p-5 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-bold italic text-neutral-900">
              Выручка по каналам продаж
            </h3>
            <div className="space-y-3">
              {channelBreakdown.map((item) => (
                <div key={item.channel} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-800">
                      {item.label}{' '}
                      <span className="text-neutral-400 font-mono tabular-nums">
                        ({item.orders})
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-neutral-900 tabular-nums">
                      {formatRub(item.revenue)} · {item.sharePct}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#52c44c] rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(item.revenue > 0 ? 4 : 0, item.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-5 border-t border-neutral-200 space-y-3">
            <h3 className="text-sm font-bold italic text-neutral-900">
              Структура по платформам
            </h3>
            <div className="space-y-3">
              {platformBreakdown.map((item) => (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-800">
                      {item.label}{' '}
                      <span className="text-neutral-400 font-mono tabular-nums">
                        ({item.units} шт.)
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-neutral-900 tabular-nums">
                      {formatRub(item.revenue)} · {item.sharePct}%
                    </span>
                  </div>
                  <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#171717] rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(item.revenue > 0 ? 4 : 0, item.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
