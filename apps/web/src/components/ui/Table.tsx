import React from 'react';
import { cn } from '../../utils/cn';
import { ChevronUp, ChevronDown, ChevronsUpDown, Download, Search, SlidersHorizontal } from 'lucide-react';
import { LoadingState } from './Loading';
interface Column<T> {
    key: string;
    title: string;
    sortable?: boolean | undefined;
    render?: ((item: T, index: number) => React.ReactNode) | undefined;
    className?: string | undefined;
}
interface TableProps<T> {
    columns: Column<T>[];
    data: T[];
    loading?: boolean | undefined;
    emptyMessage?: string | undefined;
    onRowClick?: ((item: T) => void) | undefined;
    sortBy?: string | undefined;
    sortOrder?: ('asc' | 'desc') | undefined;
    onSort?: ((key: string) => void) | undefined;
    rowClassName?: ((item: T) => string) | undefined;
    enableColumnChooser?: boolean | undefined;
    enableClientFilter?: boolean | undefined;
    enableExport?: boolean | undefined;
    exportFilename?: string | undefined;
}
function getRecordValue(item: object, key: string): unknown {
    return (item as Record<string, unknown>)[key];
}
function getStableRowKey(item: object, index: number): React.Key {
    const record = item as Record<string, unknown>;
    const stableKey = record.id ?? record.key ?? record.code;
    return typeof stableKey === 'string' || typeof stableKey === 'number'
        ? stableKey
        : index;
}
function isActionColumn<T>(column: Column<T>): boolean {
    return ['action', 'actions', 'operations'].includes(column.key) || column.title === 'عملیات';
}
function flattenSearchValue(value: unknown): string {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return value.map(flattenSearchValue).join(' ');
    if (typeof value === 'object')
        return Object.values(value as Record<string, unknown>).map(flattenSearchValue).join(' ');
    return '';
}
function reactNodeToText(node: React.ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean')
        return '';
    if (typeof node === 'string' || typeof node === 'number')
        return String(node);
    if (Array.isArray(node))
        return node.map(reactNodeToText).join(' ');
    if (React.isValidElement<{
        children?: React.ReactNode | undefined;
    }>(node)) {
        return reactNodeToText(node.props.children);
    }
    return '';
}
export function Table<T extends object>({ columns, data, loading = false, emptyMessage = 'داده‌ای یافت نشد', onRowClick, sortBy, sortOrder, onSort, rowClassName, enableColumnChooser = true, enableClientFilter = true, enableExport = true, exportFilename = 'table-export', }: TableProps<T>) {
    const columnKeySignature = columns.map(c => c.key).join('|');
    const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<string[]>(() => columns.map(c => c.key));
    const [clientFilter, setClientFilter] = React.useState('');
    React.useEffect(() => {
        const keys = columns.map(c => c.key);
        setVisibleColumnKeys(prev => {
            const kept = prev.filter(key => keys.includes(key));
            const added = keys.filter(key => !prev.includes(key));
            const next = [...kept, ...added];
            return next.length ? next : keys;
        });
    }, [columnKeySignature]);
    const visibleColumns = columns.filter(column => visibleColumnKeys.includes(column.key));
    const normalizedFilter = clientFilter.trim().toLowerCase();
    const visibleData = normalizedFilter
        ? data.filter(item => flattenSearchValue(item).toLowerCase().includes(normalizedFilter))
        : data;
    const toggleColumn = (key: string) => {
        setVisibleColumnKeys(prev => {
            if (prev.includes(key)) {
                return prev.length > 1 ? prev.filter(item => item !== key) : prev;
            }
            return [...prev, key];
        });
    };
    const handleTableExport = () => {
        const exportRows = visibleData.map((item, index) => {
            const row: Record<string, string> = {};
            visibleColumns.forEach(column => {
                const rendered = column.render ? reactNodeToText(column.render(item, index)) : '';
                row[column.key] = rendered || flattenSearchValue(getRecordValue(item, column.key));
            });
            return row;
        });
        exportToExcel(exportRows, visibleColumns.map(column => ({ key: column.key, title: column.title })), exportFilename);
    };
    const renderSortIcon = (column: Column<T>) => {
        if (!column.sortable)
            return null;
        if (sortBy === column.key) {
            return sortOrder === 'asc' ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>;
        }
        return <ChevronsUpDown className="w-4 h-4 opacity-50"/>;
    };
    if (loading) {
        return (<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <LoadingState className="m-4"/>
      </div>);
    }
    return (<div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white">
      {(enableClientFilter || enableColumnChooser || enableExport) && (<div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 bg-white px-3 py-3">
          {enableClientFilter && (<label className="relative min-w-0 basis-full flex-1 sm:basis-auto sm:min-w-[220px] sm:max-w-md">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"/>
              <input value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white py-2 pr-9 pl-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder="فیلتر سریع جدول..."/>
            </label>)}
          <div className="flex max-w-full flex-wrap items-start gap-2">
            {enableExport && (<button type="button" onClick={handleTableExport} disabled={visibleData.length === 0} className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50">
                <Download className="h-4 w-4"/>
                خروجی اکسل
              </button>)}
            {enableColumnChooser && columns.length > 1 && (<details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  <SlidersHorizontal className="h-4 w-4"/>
                  ستون‌ها
                </summary>
                <div className="absolute left-0 z-30 mt-2 w-[min(14rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                  <div className="mb-2 px-2 text-xs font-medium text-gray-500">نمایش ستون‌ها</div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {columns.map(column => {
                    const checked = visibleColumnKeys.includes(column.key);
                    const disabled = checked && visibleColumnKeys.length === 1;
                    return (<label key={column.key} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50', disabled && 'opacity-60')}>
                          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleColumn(column.key)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                          <span>{column.title}</span>
                        </label>);
                })}
                  </div>
                </div>
              </details>)}
          </div>
        </div>)}
      <div className="responsive-scroll max-w-full overflow-x-auto" role="region" aria-label="جدول داده‌ها؛ برای مشاهده ستون‌های بیشتر به طرفین پیمایش کنید" tabIndex={0}>
        <table className="w-max min-w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {visibleColumns.map((column) => (<th key={column.key} className={cn('px-3 py-3 text-right text-sm font-semibold text-gray-700 sm:px-4', isActionColumn(column) && 'w-px whitespace-nowrap', column.sortable && 'cursor-pointer hover:bg-gray-100', column.className)} onClick={() => column.sortable && onSort?.(column.key)}>
                  <div className="flex items-center gap-1"><span>{column.title}</span>{renderSortIcon(column)}</div>
                </th>))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleData.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-gray-500">{emptyMessage}</td></tr>) : (visibleData.map((item, index) => (<tr key={getStableRowKey(item, index)} className={cn('hover:bg-gray-50 transition-colors', onRowClick && 'cursor-pointer', rowClassName?.(item))} onClick={() => onRowClick?.(item)}>
                  {visibleColumns.map((column) => (<td key={column.key} className={cn(isActionColumn(column) ? 'w-px whitespace-nowrap px-3 py-3 text-sm text-gray-900 sm:px-4' : 'max-w-[20rem] px-3 py-3 text-sm text-gray-900 sm:px-4', column.className)}>
                      {column.render ? column.render(item, index) : flattenSearchValue(getRecordValue(item, column.key))}
                    </td>))}
                </tr>)))}
          </tbody>
        </table>
      </div>
    </div>);
}
// Enhanced Pagination with page size selector
interface PaginationProps {
    page: number;
    totalPages: number;
    total: number;
    limit: number;
    onPageChange: (page: number) => void;
    onLimitChange?: ((limit: number) => void) | undefined;
}
export const Pagination: React.FC<PaginationProps> = ({ page, totalPages, total, limit, onPageChange, onLimitChange, }) => {
    const start = (page - 1) * limit + 1;
    const end = Math.min(page * limit, total);
    const pageSizes = [10, 30, 70, 100];
    return (<div className="flex flex-col items-stretch justify-between gap-3 rounded-b-xl border-t border-gray-200 bg-white px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500">نمایش {start} تا {end} از {total}</span>
        {onLimitChange && (<select aria-label="تعداد ردیف در هر صفحه" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} className="px-2 py-1 text-sm border border-gray-300 rounded-lg bg-white">
            {pageSizes.map(s => <option key={s} value={s}>{s} ردیف</option>)}
          </select>)}
      </div>
      <div className="responsive-scroll flex max-w-full justify-between gap-1.5 overflow-x-auto sm:justify-start">
        <button onClick={() => onPageChange(1)} disabled={page === 1} className="px-2.5 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">«</button>
        <button onClick={() => onPageChange(page - 1)} disabled={page === 1} className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">قبلی</button>
        <span className="px-3 py-1.5 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg">
          {page} / {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">بعدی</button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} className="px-2.5 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">»</button>
      </div>
    </div>);
};
// Excel export helper
export function exportToExcel<T extends object>(data: T[], columns: Array<{
    key: string;
    title: string;
}>, filename: string) {
    // Build CSV content with Persian headers
    const headers = columns.map(c => c.title).join(',');
    const rows = data.map(item => columns.map(c => {
        const val = getRecordValue(item, c.key);
        const str = val === null || val === undefined ? '' : String(val);
        // Escape commas and quotes
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','));
    const csv = '\uFEFF' + headers + '\n' + rows.join('\n'); // BOM for Excel Persian support
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
// Export button component
export const ExportButton: React.FC<{
    onClick: () => void;
    disabled?: boolean | undefined;
}> = ({ onClick, disabled }) => (<button onClick={onClick} disabled={disabled} className="flex max-w-full items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50">
    <Download className="w-4 h-4"/> خروجی اکسل
  </button>);
