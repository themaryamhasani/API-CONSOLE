import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiComplianceReport } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Button } from '../ui/Button';
import { Card, StatCard } from '../ui/Card';
import { JalaliDateField } from '../ui/JalaliDateField';
import { toast } from '../ui/Toast';

export function ComplianceReportSection({ context }: { context: ActiveContext }) {
  const [report, setReport] = useState<ApiComplianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setReport(await apiConsoleApi.getComplianceReport({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      }, context));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری گزارش انطباق ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [context.contextId]);

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">گزارش انطباق</h2>
            <p className="text-xs text-gray-500">TLS ناامن، Exact Mode، Commandهای Production و Share بدون Consumer.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            تازه‌سازی
          </Button>
        </div>
        <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
          <JalaliDateField label="از تاریخ" value={dateFrom} onChange={setDateFrom} />
          <JalaliDateField label="تا تاریخ" value={dateTo} onChange={setDateTo} />
          <Button size="sm" onClick={() => void load()}>اعمال بازه</Button>
        </div>
      </Card>

      {report ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="TLS ناامن" value={String(report.totals.tlsInsecureExecutions)} />
            <StatCard title="Exact Mode" value={String(report.totals.exactModeRequests)} />
            <StatCard title="Prod Command" value={String(report.totals.productionCommandExecutions)} />
            <StatCard title="Share بدون Consumer" value={String(report.totals.approvedSharesWithoutConsumers)} />
          </div>
          <Card padding="sm">
            <p className="mb-2 text-xs text-gray-500" dir="ltr">generatedAt: {report.generatedAt}</p>
            <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-950 p-3 text-left text-xs text-gray-100" dir="ltr">
              {JSON.stringify(report.samples, null, 2)}
            </pre>
          </Card>
        </>
      ) : (
        <Card padding="sm">
          <p className="text-sm text-gray-500">هنوز گزارشی بارگذاری نشده است.</p>
        </Card>
      )}
    </div>
  );
}
