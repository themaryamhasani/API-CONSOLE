import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiOrgPolicies } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Textarea } from '../ui/Input';
import { toast } from '../ui/Toast';

export function OrgPolicySection({ context }: { context: ActiveContext }) {
  const [policy, setPolicy] = useState<ApiOrgPolicies | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowlistText, setAllowlistText] = useState('');
  const [dualApproval, setDualApproval] = useState(false);
  const [forbidInsecureTls, setForbidInsecureTls] = useState(true);
  const [forbidExactMode, setForbidExactMode] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const next = await apiConsoleApi.getOrgPolicy(context);
      setPolicy(next);
      setAllowlistText((next.privateDestinationAllowlist || []).join('\n'));
      setDualApproval(next.dualApprovalProductionCommand === true);
      setForbidInsecureTls(next.forbidInsecureTlsInProduction !== false);
      setForbidExactMode(next.forbidExactModeInProduction !== false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری سیاست سازمانی ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [context.contextId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const privateDestinationAllowlist = allowlistText
        .split(/\r?\n|,/)
        .map(item => item.trim())
        .filter(Boolean);
      const next = await apiConsoleApi.updateOrgPolicy({
        privateDestinationAllowlist,
        dualApprovalProductionCommand: dualApproval,
        forbidInsecureTlsInProduction: forbidInsecureTls,
        forbidExactModeInProduction: forbidExactMode,
      }, context);
      setPolicy(next);
      toast.success('سیاست سازمانی ذخیره شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره سیاست سازمانی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">سیاست سازمانی Production</h2>
            <p className="text-xs text-gray-500">فقط SYSTEM_ADMIN — allowlist مقصد خصوصی، dual approval و محدودیت TLS/EXACT.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            تازه‌سازی
          </Button>
        </div>

        <Textarea
          label="Private destination allowlist (یک origin در هر خط)"
          value={allowlistText}
          onChange={(event) => setAllowlistText(event.target.value)}
          className="min-h-28 font-mono text-left"
          dir="ltr"
          placeholder="http://10.0.0.5:8080"
        />

        <div className="mt-4 space-y-2 text-sm text-gray-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dualApproval} onChange={(event) => setDualApproval(event.target.checked)} className="rounded border-gray-300" />
            Dual approval برای Production Core Command
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={forbidInsecureTls} onChange={(event) => setForbidInsecureTls(event.target.checked)} className="rounded border-gray-300" />
            ممنوعیت insecure TLS در Production
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={forbidExactMode} onChange={(event) => setForbidExactMode(event.target.checked)} className="rounded border-gray-300" />
            ممنوعیت EXACT mode در Production
          </label>
        </div>

        {(policy?.envPrivateDestinationAllowlist?.length || policy?.envDualApproval) ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" dir="ltr">
            {policy.envDualApproval ? <p>API_CONSOLE_DUAL_APPROVAL=true (env override)</p> : null}
            {policy.envPrivateDestinationAllowlist?.length ? (
              <p className="mt-1">Env allowlist: {policy.envPrivateDestinationAllowlist.join(', ')}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
          <Input
            label="آخرین به‌روزرسانی"
            value={policy?.updatedAt ? `${policy.updatedAt}${policy.updatedBy ? ` · ${policy.updatedBy}` : ''}` : '—'}
            readOnly
            dir="ltr"
          />
          <Button onClick={() => { void handleSave(); }} loading={saving}>ذخیره</Button>
        </div>
      </Card>
    </div>
  );
}
