import type { Dispatch, SetStateAction } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import type { PaginatedResponse } from '../../types';
import type { ApiRepositoryItem, ApiShareRequest } from '../../types/apiConsole';
import { API_SHARING_STATUS_LABELS } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Table, Pagination } from '../ui/Table';
import { CLASSIFICATION_LABELS, classBadgeVariant, formatDate, sharingBadgeVariant } from './consoleFormatters';

export const ShareReviewSection = ({
  rows,
  loading,
  filters,
  onFilters,
  onRefresh,
  onOpen,
  getApplicationName,
}: {
  rows: PaginatedResponse<ApiShareRequest> | null;
  loading: boolean;
  filters: { page: number; limit: number; search: string; status: string };
  onFilters: Dispatch<SetStateAction<{ page: number; limit: number; search: string; status: string }>>;
  onRefresh: () => void;
  onOpen: (item: ApiShareRequest) => void;
  getApplicationName: (applicationId?: string) => string;
}) => (
  <div className="space-y-4">
    <Card padding="sm">
      <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(220px,1fr)_180px_auto]">
        <Input
          aria-label="جستجوی درخواست اشتراک"
          value={filters.search}
          onChange={(event) => onFilters(prev => ({ ...prev, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRefresh();
          }}
          placeholder="جستجو در عنوان API، API ID یا ثبت‌کننده"
          className="py-1.5 text-sm"
        />
        <Select
          aria-label="وضعیت بررسی"
          value={filters.status}
          onChange={(event) => onFilters(prev => ({ ...prev, status: event.target.value, page: 1 }))}
          className="py-1.5 text-sm"
          options={[
            { value: '', label: 'همه وضعیت‌ها' },
            { value: 'PENDING_REVIEW', label: 'در انتظار بررسی' },
            { value: 'APPROVED', label: 'تأییدشده' },
            { value: 'RETURNED', label: 'بازگردانده‌شده' },
          ]}
        />
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          فیلتر
        </Button>
      </div>
    </Card>
    <Table
      columns={[
        {
          key: 'apiTitle',
          title: 'عنوان API',
          render: (item: ApiShareRequest) => (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{item.apiTitle}</span>
                <Badge variant="default" size="sm">v{item.version}</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">{item.apiId}</p>
            </div>
          ),
        },
        {
          key: 'status',
          title: 'وضعیت',
          render: (item: ApiShareRequest) => (
            <Badge variant={sharingBadgeVariant(item.status)} size="sm">{API_SHARING_STATUS_LABELS[item.status]}</Badge>
          ),
        },
        { key: 'applicationId', title: 'سامانه', render: (item: ApiShareRequest) => getApplicationName(item.applicationId) },
        { key: 'submittedBy', title: 'ثبت‌کننده', render: (item: ApiShareRequest) => item.submittedByName || item.submittedBy },
        { key: 'revision', title: 'Revision', render: (item: ApiShareRequest) => item.currentRevisionNumber },
        { key: 'updatedAt', title: 'زمان', render: (item: ApiShareRequest) => formatDate(item.updatedAt) },
        {
          key: 'actions',
          title: 'عملیات',
          render: (item: ApiShareRequest) => (
            <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}>
              بررسی
            </Button>
          ),
        },
      ]}
      data={rows?.data || []}
      loading={loading}
      emptyMessage="درخواست اشتراک API برای بررسی وجود ندارد"
      onRowClick={onOpen}
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
        onPageChange={(page) => onFilters(prev => ({ ...prev, page }))}
        onLimitChange={(limit) => onFilters(prev => ({ ...prev, page: 1, limit }))}
      />
    )}
  </div>
);
