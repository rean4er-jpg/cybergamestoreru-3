import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileJson,
  Globe,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import {
  formatRub,
  parseCatalogJsonText,
  type ParsedCatalogImportItem,
} from '../../data/adminCatalog';
import type { ProductDraft } from './ProductEditorModal';
import { ResilientImage } from '../ResilientImage';

interface CatalogImportModalProps {
  isOpen: boolean;
  existingProductIds: Set<string>;
  onClose: () => void;
  onImportBatch: (
    drafts: ProductDraft[],
    onProgress: (completed: number, total: number) => void
  ) => Promise<void>;
}

const SAMPLE_JSON_PATH = '/assets/aistudio/cybergamestore_catalog_sample_20_2ce63cd3.json';
const PREVIEW_PAGE_SIZE = 50;

export function CatalogImportModal({
  isOpen,
  existingProductIds,
  onClose,
  onImportBatch,
}: CatalogImportModalProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ParsedCatalogImportItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);

  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [parsing, setParsing] = useState(false);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFileName(null);
    setItems([]);
    setParseErrors([]);
    setSelectedIds(new Set());
    setSkipExisting(false);
    setPreviewPage(1);
    setShowPasteBox(false);
    setPasteText('');
    setParsing(false);
    setImporting(false);
    setProgress(null);
    setImportError(null);
    setImportSuccessCount(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing && !parsing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, importing, parsing, onClose]);

  const applyParsedText = (rawText: string, sourceLabel: string) => {
    setImportError(null);
    setImportSuccessCount(null);
    setParsing(true);
    setFileName(sourceLabel);

    // Yield a frame so the UI renders the parsing indicator on large (10–35 MB) catalogs
    window.setTimeout(() => {
      try {
        const result = parseCatalogJsonText(rawText);
        setItems(result.items);
        setParseErrors(result.errors);
        setSelectedIds(new Set(result.items.map((i) => i.draft.id)));
        setPreviewPage(1);
      } catch {
        setItems([]);
        setParseErrors(['Не удалось обработать JSON-файл. Проверьте корректность структуры.']);
        setSelectedIds(new Set());
      } finally {
        setParsing(false);
      }
    }, 25);
  };

  const handleFileRead = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setParseErrors(['Выберите файл в формате .json']);
      return;
    }
    setParsing(true);
    setFileName(file.name);
    try {
      const text = await file.text();
      applyParsedText(text, file.name);
    } catch {
      setParsing(false);
      setParseErrors(['Не удалось прочитать выбранный файл.']);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileRead(file);
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileRead(file);
  };

  const handleLoadSample = async () => {
    setLoadingSample(true);
    setParseErrors([]);
    try {
      const res = await fetch(SAMPLE_JSON_PATH);
      if (!res.ok) throw new Error('Sample not found');
      const text = await res.text();
      applyParsedText(text, 'cybergamestore_catalog_sample_20.json');
    } catch {
      setParseErrors(['Не удалось загрузить встроенный пример файла.']);
    } finally {
      setLoadingSample(false);
    }
  };

  const stats = useMemo(() => {
    let newCount = 0;
    let updateCount = 0;
    for (const item of items) {
      if (existingProductIds.has(item.draft.id)) updateCount++;
      else newCount++;
    }
    return { total: items.length, newCount, updateCount };
  }, [items, existingProductIds]);

  const itemsToImport = useMemo(() => {
    return items.filter((item) => {
      if (!selectedIds.has(item.draft.id)) return false;
      if (skipExisting && existingProductIds.has(item.draft.id)) return false;
      return true;
    });
  }, [items, selectedIds, skipExisting, existingProductIds]);

  const totalPreviewPages = Math.max(1, Math.ceil(items.length / PREVIEW_PAGE_SIZE));
  const safePreviewPage = Math.min(previewPage, totalPreviewPages);
  const paginatedPreviewItems = useMemo(
    () =>
      items.slice(
        (safePreviewPage - 1) * PREVIEW_PAGE_SIZE,
        safePreviewPage * PREVIEW_PAGE_SIZE
      ),
    [items, safePreviewPage]
  );

  const allChecked = items.length > 0 && selectedIds.size === items.length;

  const toggleAll = () => {
    if (allChecked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.draft.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRunImport = async () => {
    if (importing || itemsToImport.length === 0) return;
    setImporting(true);
    setImportError(null);
    setProgress({ done: 0, total: itemsToImport.length });
    try {
      await onImportBatch(
        itemsToImport.map((i) => i.draft),
        (done, total) => setProgress({ done, total })
      );
      setImportSuccessCount(itemsToImport.length);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Произошла ошибка при сохранении товаров.'
      );
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-json-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6 bg-black/65 backdrop-blur-xs"
      onClick={() => !importing && onClose()}
    >
      <div
        className="w-full max-w-4xl bg-white sm:rounded-xl border border-neutral-200 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#111111] text-white px-6 py-4 flex items-center justify-between border-b border-neutral-800 shrink-0">
          <div>
            <h2 id="import-json-title" className="text-lg font-bold italic">
              Массовый импорт товаров из JSON
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Загрузите JSON-файл каталога — названия, жанры, цены, обложки и описания распознаются автоматически
            </p>
          </div>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            aria-label="Закрыть окно импорта"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-white hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {importSuccessCount !== null ? (
            <div className="py-10 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-[#52c44c] mx-auto" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-neutral-900 tabular-nums">
                  Успешно загружено товаров: {importSuccessCount}
                </h3>
                <p className="text-sm text-neutral-600 max-w-md mx-auto">
                  Все выбранные позиции сохранены в базе и уже отображаются в каталоге магазина и
                  доступны для покупки в корзине.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setImportSuccessCount(null);
                    setItems([]);
                    setFileName(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded-lg cursor-pointer"
                >
                  Загрузить ещё файл
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] rounded-lg cursor-pointer"
                >
                  Готово
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Upload Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  isDragging
                    ? 'border-[#52c44c] bg-[#52c44c]/10'
                    : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="flex flex-col items-center gap-2.5">
                  <FileJson className="w-8 h-8 text-neutral-400" strokeWidth={1.6} />
                  <div className="text-sm font-semibold text-neutral-900">
                    {fileName
                      ? `Загружен файл: ${fileName}`
                      : 'Перетащите JSON-файл с товарами сюда'}
                  </div>
                  <p className="text-xs text-neutral-500 max-w-lg">
                    Поддерживаются файлы любого размера (в том числе выгрузки на 20 000+ позиций) с полями{' '}
                    <code className="font-mono text-neutral-700">
                      id, sku, title, platform, region, hasRussian, category, brand, price, oldPrice, image, description
                    </code>
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Выбрать .json файл</span>
                    </button>

                    <button
                      type="button"
                      disabled={importing || loadingSample}
                      onClick={() => void handleLoadSample()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-neutral-700 bg-white border border-neutral-300 hover:border-[#52c44c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {loadingSample && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Проверить на примере (20 шт.)</span>
                    </button>

                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => setShowPasteBox((v) => !v)}
                      className="px-3.5 py-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {showPasteBox ? 'Скрыть поле вставки' : 'Вставить JSON текстом'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Optional Paste JSON Area */}
              {showPasteBox && (
                <div className="space-y-2">
                  <textarea
                    rows={5}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder='[{"id": "1000000099", "title": "...", "platform": "PlayStation", "price": 2490, ...}]'
                    className="w-full p-3 text-xs font-mono border border-neutral-300 rounded-lg focus:outline-none focus:border-[#52c44c]"
                  />
                  <button
                    type="button"
                    onClick={() => applyParsedText(pasteText, 'Вставленный JSON')}
                    disabled={!pasteText.trim()}
                    className="px-4 py-1.5 text-xs font-semibold text-white bg-[#111111] hover:bg-neutral-800 disabled:opacity-50 rounded-md cursor-pointer"
                  >
                    Разобрать JSON
                  </button>
                </div>
              )}

              {/* Parse Warnings / Errors */}
              {parseErrors.length > 0 && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 space-y-1 text-xs text-amber-900">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Предупреждения при разборе ({parseErrors.length})</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] max-h-24 overflow-y-auto">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {parsing && (
                <div className="p-4 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-center gap-2.5 text-xs text-neutral-700">
                  <Loader2 className="w-4 h-4 text-[#52c44c] animate-spin" />
                  <span>Чтение и разбор JSON-файла, пожалуйста подождите...</span>
                </div>
              )}

              {/* Preview Table */}
              {!parsing && items.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="text-neutral-600 tabular-nums">
                      Распознано:{' '}
                      <span className="font-mono font-bold text-neutral-900">{stats.total}</span>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      Новых:{' '}
                      <span className="font-mono font-semibold text-emerald-700">
                        {stats.newCount}
                      </span>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      Обновлений по ID:{' '}
                      <span className="font-mono font-semibold text-amber-700">
                        {stats.updateCount}
                      </span>
                    </div>

                    <label className="inline-flex items-center gap-2 text-neutral-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={skipExisting}
                        onChange={(e) => setSkipExisting(e.target.checked)}
                        className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                      />
                      <span>Пропускать уже существующие ID</span>
                    </label>
                  </div>

                  <div className="border border-neutral-200 rounded-lg overflow-hidden">
                    <div className="max-h-[340px] overflow-y-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 text-[11px] font-semibold text-neutral-500">
                          <tr>
                            <th className="py-2.5 px-3 w-10">
                              <input
                                type="checkbox"
                                checked={allChecked}
                                onChange={toggleAll}
                                aria-label="Выбрать все товары"
                                className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                              />
                            </th>
                            <th className="py-2.5 px-3">Товар</th>
                            <th className="py-2.5 px-3">Платформа и жанр</th>
                            <th className="py-2.5 px-3 text-right">Цена</th>
                            <th className="py-2.5 px-3">Режим</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100 text-xs">
                          {paginatedPreviewItems.map((item) => {
                            const exists = existingProductIds.has(item.draft.id);
                            const skippedByRule = skipExisting && exists;
                            const checked = selectedIds.has(item.draft.id) && !skippedByRule;
                            return (
                              <tr
                                key={item.draft.id}
                                className={`transition-colors ${
                                  skippedByRule ? 'opacity-45 bg-neutral-50' : 'hover:bg-neutral-50'
                                }`}
                              >
                                <td className="py-2.5 px-3">
                                  <input
                                    type="checkbox"
                                    disabled={skippedByRule}
                                    checked={checked}
                                    onChange={() => toggleOne(item.draft.id)}
                                    aria-label={`Выбрать ${item.draft.title}`}
                                    className="w-4 h-4 accent-[#52c44c] cursor-pointer"
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="flex items-center gap-2.5 min-w-[220px]">
                                    <div className="w-12 h-9 rounded overflow-hidden bg-neutral-900 border border-neutral-200 shrink-0">
                                      <ResilientImage
                                        src={item.draft.image}
                                        alt={item.draft.title}
                                        className="w-full h-full"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="font-semibold text-neutral-900 line-clamp-1">
                                        {item.draft.title}
                                      </div>
                                      <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
                                        <span className="font-mono tabular-nums">#{item.draft.sku}</span>
                                        {item.draft.hasRussian && (
                                          <>
                                            <span aria-hidden="true">·</span>
                                            <span className="inline-flex items-center gap-0.5 text-emerald-700 font-semibold">
                                              <Globe className="w-3 h-3" />
                                              RU
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <div className="text-neutral-800 font-medium">
                                    {item.draft.platformLabel} · {item.draft.regionLabel}
                                  </div>
                                  <div className="text-[11px] text-neutral-500">{item.draft.genre}</div>
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {item.draft.oldPriceRub > item.draft.priceRub && (
                                    <span className="block font-mono text-[11px] text-neutral-400 line-through tabular-nums">
                                      {formatRub(item.draft.oldPriceRub)}
                                    </span>
                                  )}
                                  <span className="font-mono font-bold text-neutral-900 tabular-nums">
                                    {formatRub(item.draft.priceRub)}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  {exists ? (
                                    <span className="text-amber-700 font-semibold">
                                      {skippedByRule ? 'Пропуск' : 'Обновление'}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700 font-semibold">Новый товар</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {totalPreviewPages > 1 && (
                      <div className="px-3 py-2 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-600">
                        <span className="tabular-nums">
                          Показаны {(safePreviewPage - 1) * PREVIEW_PAGE_SIZE + 1}–
                          {Math.min(safePreviewPage * PREVIEW_PAGE_SIZE, items.length)} из{' '}
                          {items.length.toLocaleString('ru-RU')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={safePreviewPage <= 1}
                            onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-neutral-200 rounded text-neutral-700 hover:border-[#52c44c] disabled:opacity-40 cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>Назад</span>
                          </button>
                          <span className="font-mono px-1.5 tabular-nums">
                            {safePreviewPage} / {totalPreviewPages}
                          </span>
                          <button
                            type="button"
                            disabled={safePreviewPage >= totalPreviewPages}
                            onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages, p + 1))}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-neutral-200 rounded text-neutral-700 hover:border-[#52c44c] disabled:opacity-40 cursor-pointer"
                          >
                            <span>Вперёд</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress Bar */}
              {importing && progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-neutral-700 tabular-nums">
                    <span>Сохранение позиций в каталог...</span>
                    <span className="font-mono font-semibold">
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-neutral-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#52c44c] transition-all duration-200"
                      style={{
                        width: `${Math.max(
                          6,
                          Math.round((progress.done / Math.max(1, progress.total)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {importError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {importError}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {importSuccessCount === null && (
          <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between gap-3 shrink-0">
            <span className="text-xs text-neutral-500 tabular-nums">
              {itemsToImport.length > 0
                ? `Будет загружено позиций: ${itemsToImport.length}`
                : 'Выберите JSON-файл для предпросмотра'}
            </span>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                disabled={importing}
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-100 rounded-lg cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={importing || itemsToImport.length === 0}
                onClick={() => void handleRunImport()}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-[#52c44c] hover:bg-[#44ad3f] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                <span className="tabular-nums">
                  {importing
                    ? 'Загрузка...'
                    : `Импортировать (${itemsToImport.length})`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
