import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiJitAccessGrant } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Textarea } from '../ui/Input';
import { toast } from '../ui/Toast';
import { Table } from '../ui/Table';

export function JitAccessSection({
  context,
  canApprove,
}: {
  context: ActiveContext;
  canApprove: boolean;
}) {
  const [rows, setRows] = useState<ApiJitAccessGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiConsoleApi.getJitAccess(context);
      setRows(result.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری JIT ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [context.contextId]);

  const handleRequest = async () => {
    if (!reason.trim()) {
      toast.warning('دلیل درخواست JIT الزامی است.');
      return;
    }
    setSubmitting(true);
    try {
      await apiConsoleApi.requestJitAccess({
        applicationId: context.applicationId,
        reason: reason.trim(),
      }, context);
      setReason('');
      toast.success('درخواست دسترسی موقت ثبت شد.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ثبت درخواست JIT ناموفق بود.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await apiConsoleApi.approveJitAccess(id, 60, context);
      toast.success('دسترسی موقت تأیید شد.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تأیید JIT ناموفق بود.');
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiConsoleApi.revokeJitAccess(id, context);
      toast.success('دسترسی موقت لغو شد.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'لغو JIT ناموفق بود.');
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">دسترسی موقت Production (JIT)</h2>
            <p className="text-xs text-gray-500">درخواست دسترسی محدود زمانی — تأیید توسط Admin / Tech Lead / QA Lead.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            تازه‌سازی
          </Button>
        </div>
        <Textarea
          label="دلیل درخواست"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="min-h-24"
          showCounter
        />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => { void handleRequest(); }} loading={submitting}>ثبت درخواست</Button>
        </div>
      </Card>

      <Table
        columns={[
          {
            key: 'reason',
            title: 'درخواست',
            render: (row: ApiJitAccessGrant) => (
              <div>
                <p className="text-sm text-gray-900">{row.reason}</p>
                <p className="font-mono text-xs text-gray-500" dir="ltr">{row.userId} · {row.applicationId}</p>
              </div>
            ),
          },
          {
            key: 'status',
            title: 'وضعیت',
            render: (row: ApiJitAccessGrant) => <Badge size="sm">{row.status}</Badge>,
          },
          {
            key: 'times',
            title: 'زمان',
            render: (row: ApiJitAccessGrant) => (
              <div className="font-mono text-xs text-gray-600" dir="ltr">
                <div>{row.requestedAt}</div>
                {row.expiresAt ? <div>exp: {row.expiresAt}</div> : null}
              </div>
            ),
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (row: ApiJitAccessGrant) => (
              <div className="flex flex-wrap gap-1">
                {canApprove && row.status === 'PENDING' ? (
                  <Button size="sm" onClick={() => { void handleApprove(row.id); }}>تأیید</Button>
                ) : null}
                {(canApprove || row.userId === context.userId) && row.status === 'ACTIVE' ? (
                  <Button size="sm" variant="danger" onClick={() => { void handleRevoke(row.id); }}>لغو</Button>
                ) : null}
              </div>
            ),
          },
        ]}
        data={rows}
        loading={loading}
        emptyMessage="درخواستی ثبت نشده است"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />
    </div>
  );
}
