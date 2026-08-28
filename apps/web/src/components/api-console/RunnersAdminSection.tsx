import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiExecutionRunner } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { toast } from '../ui/Toast';
import { Table } from '../ui/Table';

export function RunnersAdminSection({ context }: { context: ActiveContext }) {
  const [runners, setRunners] = useState<ApiExecutionRunner[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRunners(await apiConsoleApi.getRunners());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری Runnerها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleEnabled = async (runner: ApiExecutionRunner) => {
    setSavingId(runner.id);
    try {
      const nextEnabled = !runner.enabled;
      const updated = nextEnabled
        ? await apiConsoleApi.updateRunner(runner.id, { enabled: true }, context)
        : await apiConsoleApi.deleteRunner(runner.id, context);
      setRunners(prev => prev.map(item => (item.id === runner.id ? updated : item)));
      toast.success(nextEnabled ? 'Runner فعال شد.' : 'Runner غیرفعال شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'به‌روزرسانی Runner ناموفق بود.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Runners</h2>
            <p className="text-xs text-gray-500">مدیریت Runnerهای اجرا — فقط SYSTEM_ADMIN.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        </div>
      </Card>
      <Table
        columns={[
          {
            key: 'name',
            title: 'نام',
            render: (row: ApiExecutionRunner) => (
              <div>
                <p className="font-medium text-gray-900">{row.name}</p>
                <p className="font-mono text-xs text-gray-500" dir="ltr">{row.id}</p>
              </div>
            ),
          },
          {
            key: 'networkZone',
            title: 'Zone',
            render: (row: ApiExecutionRunner) => <Badge size="sm">{row.networkZone}</Badge>,
          },
          {
            key: 'origins',
            title: 'Origin patterns',
            render: (row: ApiExecutionRunner) => (
              <span className="font-mono text-xs text-gray-600" dir="ltr">
                {(row.allowedOriginPatterns || []).join(', ') || '—'}
              </span>
            ),
          },
          {
            key: 'enabled',
            title: 'وضعیت',
            render: (row: ApiExecutionRunner) => (
              <Badge size="sm" variant={row.enabled ? 'success' : 'default'}>
                {row.enabled ? 'فعال' : 'غیرفعال'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (row: ApiExecutionRunner) => (
              <Button
                size="sm"
                variant={row.enabled ? 'warning' : 'secondary'}
                loading={savingId === row.id}
                onClick={() => void toggleEnabled(row)}
              >
                {row.enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
              </Button>
            ),
          },
        ]}
        data={runners}
        loading={loading}
        emptyMessage="Runner تعریف نشده است"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />
    </div>
  );
}
