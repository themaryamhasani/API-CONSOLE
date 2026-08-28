import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiMockDefinition } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { toast } from '../ui/Toast';
import { Pagination, Table } from '../ui/Table';

export function MocksSection({
  context,
  applicationId,
}: {
  context: ActiveContext;
  applicationId?: string;
}) {
  const [rows, setRows] = useState<ApiMockDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiConsoleApi.getMocks({
        applicationId: applicationId || context.applicationId,
        page,
        limit,
      }, context);
      setRows(result.data || []);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری Mockها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [context.contextId, applicationId, page, limit]);

  const handleDisable = async (id: string) => {
    try {
      await apiConsoleApi.disableMock(id, context);
      toast.success('Mock غیرفعال شد.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'غیرفعال‌سازی Mock ناموفق بود.');
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Mock Server</h2>
            <p className="text-xs text-gray-500">Mockهای فعال از روی Response واقعی یا Manual Example ساخته می‌شوند.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            تازه‌سازی
          </Button>
        </div>
      </Card>

      <Table
        columns={[
          {
            key: 'mock',
            title: 'Mock',
            render: (row: ApiMockDefinition) => (
              <div>
                <p className="font-mono text-sm text-gray-900" dir="ltr">{row.method} {row.pathMatch}</p>
                <p className="font-mono text-xs text-gray-500" dir="ltr">{row.id}</p>
              </div>
            ),
          },
          {
            key: 'status',
            title: 'وضعیت',
            render: (row: ApiMockDefinition) => (
              <div className="space-y-1">
                <Badge size="sm">{row.status}</Badge>
                <p className="text-xs text-gray-500">HTTP {row.statusCode} · hits {row.hitCount}</p>
              </div>
            ),
          },
          {
            key: 'url',
            title: 'Serve URL',
            render: (row: ApiMockDefinition) => {
              const url = apiConsoleApi.mockServeUrl(row.id);
              return (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="h-4 w-4" />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(url);
                    toast.success('آدرس Mock کپی شد.');
                  }}
                >
                  کپی
                </Button>
              );
            },
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (row: ApiMockDefinition) => (
              row.status === 'ACTIVE' ? (
                <Button size="sm" variant="danger" onClick={() => { void handleDisable(row.id); }}>
                  غیرفعال
                </Button>
              ) : null
            ),
          },
        ]}
        data={rows}
        loading={loading}
        emptyMessage="Mock فعالی وجود ندارد"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={setPage}
        onLimitChange={(next) => {
          setPage(1);
          setLimit(next);
        }}
      />
    </div>
  );
}
