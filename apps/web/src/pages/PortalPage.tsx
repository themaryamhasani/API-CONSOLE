import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Eye, FileText, Link2, RefreshCw, Search } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input, Select } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Loading';
import { Modal } from '../components/ui/Modal';
import { Pagination, Table } from '../components/ui/Table';
import { toast } from '../components/ui/Toast';
import { apiConsoleApi } from '../services/apiConsoleApi';
import { useSessionStore } from '../stores/sessionStore';
import { API_SHARING_STATUS_LABELS } from '../types/apiConsole';
import type { ApiClassificationType, ApiPortalDetail, ApiPortalItem } from '../types/apiConsole';
import type { PaginatedResponse } from '../types';

const CLASSIFICATION_OPTIONS: Array<{ value: '' | ApiClassificationType; label: string }> = [
  { value: '', label: 'همه انواع' },
  { value: 'GENERIC_HTTP', label: 'HTTP عمومی' },
  { value: 'CORE_QUERY', label: 'Core Query' },
  { value: 'CORE_COMMAND', label: 'Core Command' },
];

export function PortalPage() {
  const activeContext = useSessionStore(state => state.activeContext);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PaginatedResponse<ApiPortalItem> | null>(null);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    classificationType: '' as '' | ApiClassificationType,
    serviceId: '',
  });
  const [detail, setDetail] = useState<ApiPortalDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);

  const load = async () => {
    if (!activeContext) return;
    setLoading(true);
    try {
      const result = await apiConsoleApi.getPortalRepository({
        page: filters.page,
        limit: filters.limit,
        search: filters.search.trim() || undefined,
        classificationType: filters.classificationType || undefined,
        serviceId: filters.serviceId.trim() || undefined,
      }, activeContext);
      setRows(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری پورتال ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [activeContext, filters.page, filters.limit]);

  const openDetail = async (item: ApiPortalItem) => {
    if (!activeContext) return;
    setDetailOpen(true);
    setDetail(null);
    setShareLink(null);
    setDetailLoading(true);
    try {
      const result = await apiConsoleApi.getPortalRepositoryVersion(item.apiId, item.version, activeContext);
      setDetail(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری جزئیات API ناموفق بود.');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownloadOpenApi = async (item: ApiPortalItem | ApiPortalDetail) => {
    const version = 'semanticVersion' in item
      ? item.semanticVersion
      : item.version;
    try {
      await apiConsoleApi.downloadRepositoryOpenApi(item.apiId, version || '1.0.0');
      toast.success('فایل OpenAPI دانلود شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'دانلود OpenAPI ناموفق بود.');
    }
  };

  const handleCreateShareLink = async (item: ApiPortalItem | ApiPortalDetail) => {
    if (!activeContext) return;
    const version = 'semanticVersion' in item ? item.semanticVersion : item.version;
    setShareBusy(true);
    try {
      const result = await apiConsoleApi.createPortalShareToken({
        apiId: item.apiId,
        version: version || '1.0.0',
        ttlHours: 24,
      }, activeContext);
      const absolute = `${window.location.origin}${result.urlPath}`;
      setShareLink(absolute);
      try {
        await navigator.clipboard.writeText(absolute);
        toast.success('لینک موقت کپی شد.');
      } catch {
        toast.success('لینک موقت ساخته شد.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ساخت لینک موقت ناموفق بود.');
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        title="پورتال مستندات"
        subtitle="مشاهده و دانلود APIهای تأییدشده — بدون اجرای Production."
        actions={(
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-border)] px-3 py-2 text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]"
          >
            بازگشت به Console
          </Link>
        )}
      />

      <main className="mx-auto w-full max-w-[1400px] space-y-4 px-3 py-4 sm:px-5 lg:px-6">
          <Card padding="sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--theme-text)]">مخزن تأییدشده</h2>
                <p className="text-xs text-[var(--theme-text-subtle)]">جستجو بر اساس نام، classification و Service ID.</p>
              </div>
              <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
                تازه‌سازی
              </Button>
            </div>
            <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(200px,1fr)_180px_180px_auto]">
              <Input
                label="جستجو"
                value={filters.search}
                onChange={(event) => setFilters(prev => ({ ...prev, search: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setFilters(prev => ({ ...prev, page: 1 }));
                    void load();
                  }
                }}
                placeholder="نام، API ID، توضیح یا URL"
              />
              <Select
                label="Classification"
                value={filters.classificationType}
                onChange={(event) => setFilters(prev => ({
                  ...prev,
                  page: 1,
                  classificationType: event.target.value as '' | ApiClassificationType,
                }))}
                options={CLASSIFICATION_OPTIONS}
              />
              <Input
                label="Service ID"
                value={filters.serviceId}
                onChange={(event) => setFilters(prev => ({ ...prev, serviceId: event.target.value }))}
                dir="ltr"
                className="text-left font-mono"
              />
              <Button
                size="sm"
                icon={<Search className="h-4 w-4" />}
                onClick={() => {
                  setFilters(prev => ({ ...prev, page: 1 }));
                  void load();
                }}
              >
                فیلتر
              </Button>
            </div>
          </Card>

          <Table
            columns={[
              {
                key: 'title',
                title: 'API',
                render: (item: ApiPortalItem) => (
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{item.title}</span>
                      <Badge variant="default" size="sm">v{item.version}</Badge>
                      <Badge variant={item.sharingStatus === 'DEPRECATED' ? 'danger' : 'success'} size="sm">
                        {API_SHARING_STATUS_LABELS[item.sharingStatus]}
                      </Badge>
                      {item.breakingChange ? <Badge variant="warning" size="sm">Breaking</Badge> : null}
                    </div>
                    <p className="mt-1 max-w-[28rem] truncate font-mono text-xs text-gray-500" dir="ltr">
                      {item.method} {item.urlTemplate}
                    </p>
                  </div>
                ),
              },
              {
                key: 'classification',
                title: 'Classification',
                render: (item: ApiPortalItem) => (
                  <div>
                    <p className="text-sm text-gray-800">{item.classification?.type || '-'}</p>
                    <p className="font-mono text-xs text-gray-500" dir="ltr">{item.classification?.serviceId || '-'}</p>
                  </div>
                ),
              },
              {
                key: 'ticket',
                title: 'Ticket',
                render: (item: ApiPortalItem) => (
                  item.ticketUrl ? (
                    <a href={item.ticketUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-blue-700" dir="ltr">
                      {item.ticketId || item.ticketUrl}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-gray-500" dir="ltr">{item.ticketId || '—'}</span>
                  )
                ),
              },
              {
                key: 'actions',
                title: 'عملیات',
                render: (item: ApiPortalItem) => (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={(event) => {
                      event.stopPropagation();
                      void openDetail(item);
                    }}>
                      جزئیات
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={(event) => {
                      event.stopPropagation();
                      void handleDownloadOpenApi(item);
                    }}>
                      OpenAPI
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={(event) => {
                      event.stopPropagation();
                      void handleCreateShareLink(item);
                    }}>
                      لینک موقت
                    </Button>
                  </div>
                ),
              },
            ]}
            data={rows?.data || []}
            loading={loading}
            emptyMessage="API تأییدشده‌ای در پورتال پیدا نشد"
            onRowClick={(item) => { void openDetail(item); }}
            enableClientFilter={false}
            enableColumnChooser={false}
            enableExport={false}
          />

          {rows && (
            <Pagination
              page={rows.page}
              totalPages={rows.totalPages}
              total={rows.total}
              limit={rows.limit}
              onPageChange={(page) => setFilters(prev => ({ ...prev, page }))}
              onLimitChange={(limit) => setFilters(prev => ({ ...prev, page: 1, limit }))}
            />
          )}
        </main>

      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} title="جزئیات مستندات API" size="wide">
        {detailLoading || !detail ? (
          <LoadingState label="در حال بارگذاری مستندات…" className="py-10" />
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-gray-900">{detail.name}</h3>
                <Badge variant="default">v{detail.semanticVersion}</Badge>
                <Badge variant={detail.sharingStatus === 'DEPRECATED' ? 'danger' : 'success'}>
                  {API_SHARING_STATUS_LABELS[detail.sharingStatus]}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-gray-600">{detail.documentation?.description || detail.description || '—'}</p>
              <p className="mt-2 font-mono text-xs text-gray-500" dir="ltr">{detail.method} {detail.urlTemplate}</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-xs text-gray-500">API ID</p>
                <p className="mt-1 font-mono text-sm" dir="ltr">{detail.apiId}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-xs text-gray-500">Service ID</p>
                <p className="mt-1 font-mono text-sm" dir="ltr">{detail.classification?.serviceId || '—'}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-xs text-gray-500">Ticket</p>
                <p className="mt-1 font-mono text-sm" dir="ltr">{detail.ticketId || '—'}</p>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                <p className="text-xs text-amber-700">اجرای Production</p>
                <p className="mt-1 text-sm font-semibold text-amber-800">غیرفعال در پورتال</p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-semibold text-gray-900">مستندات</p>
              </div>
              <pre className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700 whitespace-pre-wrap">
                {[
                  detail.documentation?.title,
                  detail.documentation?.serviceIntroduction,
                  detail.documentation?.description,
                  detail.documentation?.curlExample ? `cURL:\n${detail.documentation.curlExample}` : '',
                ].filter(Boolean).join('\n\n') || 'مستنداتی ثبت نشده است.'}
              </pre>
            </div>

            {detail.openapi ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-gray-900">OpenAPI Preview</p>
                <pre className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-3 text-left text-xs text-gray-100" dir="ltr">
                  {JSON.stringify(detail.openapi, null, 2)}
                </pre>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>بستن</Button>
              <Button
                variant="secondary"
                icon={<Link2 className="h-4 w-4" />}
                loading={shareBusy}
                onClick={() => void handleCreateShareLink(detail)}
              >
                لینک موقت
              </Button>
              <Button icon={<Download className="h-4 w-4" />} onClick={() => void handleDownloadOpenApi(detail)}>
                دانلود OpenAPI
              </Button>
            </div>
            {shareLink ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900" dir="ltr">
                {shareLink}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
