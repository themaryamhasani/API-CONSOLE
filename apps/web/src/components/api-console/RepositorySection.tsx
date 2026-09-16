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

export const RepositorySection = ({
  rows,
  loading,
  filters,
  onFilters,
  onRefresh,
  onOpen,
}: {
  rows: PaginatedResponse<ApiRepositoryItem> | null;
  loading: boolean;
  filters: { page: number; limit: number; search: string };
  onFilters: Dispatch<SetStateAction<{ page: number; limit: number; search: string }>>;
  onRefresh: () => void;
  onOpen: (item: ApiRepositoryItem) => void;
}) => (
  <div className="space-y-4">
    <Card padding="sm">
      <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(220px,1fr)_auto]">
        <Input
          aria-label="جستجوی Repository"
          value={filters.search}
          onChange={(event) => onFilters(prev => ({ ...prev, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRefresh();
          }}
          placeholder="جستجو در API ID، نام، Service ID یا operation path"
          className="py-1.5 text-sm"
        />
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
          فیلتر
        </Button>
      </div>
    </Card>
    <Table
      columns={[
        {
          key: 'title',
          title: 'API',
          render: (item: ApiRepositoryItem) => (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{item.title}</span>
                <Badge variant="default" size="sm">v{item.version}</Badge>
                <Badge variant={classBadgeVariant(item.classification.type)} size="sm">{CLASSIFICATION_LABELS[item.classification.type]}</Badge>
                {item.sharingStatus === 'DEPRECATED' && <Badge variant="danger" size="sm">DEPRECATED</Badge>}
                {item.breakingChange && <Badge variant="warning" size="sm">Breaking</Badge>}
                {item.isNewForUser && <Badge variant="success" size="sm">جدید</Badge>}
                {item.hasNewerVersion && <Badge variant="warning" size="sm">نسخه جدید موجود است</Badge>}
              </div>
              <p className="mt-1 max-w-[26rem] truncate font-mono text-xs text-gray-500" dir="ltr">{item.method} {item.urlTemplate}</p>
            </div>
          ),
        },
        { key: 'apiId', title: 'API ID', render: (item: ApiRepositoryItem) => <span className="font-mono text-xs" dir="ltr">{item.apiId}</span> },
        { key: 'consumers', title: 'Consumer', render: (item: ApiRepositoryItem) => item.consumers.length },
        { key: 'updatedAt', title: 'آخرین تغییر', render: (item: ApiRepositoryItem) => formatDate(item.updatedAt) },
        {
          key: 'actions',
          title: 'عملیات',
          render: (item: ApiRepositoryItem) => (
            <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}>
              Preview
            </Button>
          ),
        },
      ]}
      data={rows?.data || []}
      loading={loading}
      emptyMessage="API قابل استفاده‌ای در Repository وجود ندارد"
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
