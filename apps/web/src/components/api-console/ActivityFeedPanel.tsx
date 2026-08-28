import { RefreshCw } from 'lucide-react';
import type { PaginatedResponse } from '../../types';
import type { ApiActivityEvent } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/Loading';
import { Pagination } from '../ui/Table';

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('fa-IR') : '-';
}

export function ActivityFeedPanel({
  rows,
  loading,
  page,
  limit,
  onRefresh,
  onPageChange,
  onLimitChange,
}: {
  rows: PaginatedResponse<ApiActivityEvent> | null;
  loading: boolean;
  page: number;
  limit: number;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
            <p className="text-xs text-gray-500">رویدادهای پروژه — اشتراک، اجرا، مالکیت و نسخه‌ها.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} loading={loading}>
            Refresh
          </Button>
        </div>
      </Card>

      {loading && !rows ? (
        <LoadingState label="در حال بارگذاری Activity..." className="py-10" />
      ) : (
        <Card padding="sm">
          <div className="space-y-2">
            {(rows?.data || []).map(event => (
              <div key={event.id} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm">{event.eventType}</Badge>
                  <span className="font-mono text-xs text-gray-500" dir="ltr">{formatDate(event.createdAt)}</span>
                </div>
                <p className="mt-1 font-mono text-xs text-gray-700" dir="ltr">
                  actor: {event.actorUserId}
                  {event.actorRole ? ` · ${event.actorRole}` : ''}
                </p>
                {event.details && Object.keys(event.details).length > 0 && (
                  <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-gray-500" dir="ltr">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
            {!rows?.data?.length && (
              <p className="py-8 text-center text-sm text-gray-500">رویداد Activity ثبت نشده است.</p>
            )}
          </div>
          {rows && (
            <Pagination
              page={page}
              totalPages={rows.totalPages}
              total={rows.total}
              limit={limit}
              onPageChange={onPageChange}
              onLimitChange={onLimitChange}
            />
          )}
        </Card>
      )}
    </div>
  );
}
