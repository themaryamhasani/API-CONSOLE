import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiEnvironmentProfile, ApiVariable } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { toast } from '../ui/Toast';

function safeCloneEnv(environment: ApiEnvironmentProfile): Partial<ApiEnvironmentProfile> {
  return JSON.parse(JSON.stringify(environment));
}

const emptyEnvironmentForm = (): Partial<ApiEnvironmentProfile> => ({
  name: '',
  kind: 'CUSTOM',
  baseUrl: 'https://',
  productionProtected: false,
  variables: [
    { id: `var-${Date.now()}`, key: 'baseUrl', currentValue: 'https://', initialValue: 'https://', sensitive: false, scope: 'ENVIRONMENT', description: '' },
  ],
  defaultHeaders: [],
  secretReferences: {},
});

export function EnvironmentManagerSection({
  environments,
  canManageProtected,
  onChanged,
  context,
}: {
  environments: ApiEnvironmentProfile[];
  canManageProtected: boolean;
  onChanged: () => Promise<void>;
  context: ActiveContext;
}) {
  const [selectedId, setSelectedId] = useState(environments[0]?.id || '');
  const [form, setForm] = useState<Partial<ApiEnvironmentProfile>>(environments[0] ? safeCloneEnv(environments[0]) : emptyEnvironmentForm());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = environments.find(item => item.id === selectedId);
  const canEditSelected = !selected?.productionProtected || canManageProtected;

  useEffect(() => {
    if (creating) return;
    const current = environments.find(item => item.id === selectedId) || environments[0];
    if (current) {
      setSelectedId(current.id);
      setForm(safeCloneEnv(current));
    }
  }, [environments, selectedId, creating]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (creating || !selected) {
        const created = await apiConsoleApi.createEnvironment(form, context);
        toast.success(`محیط «${created.name}» ساخته شد.`);
        setCreating(false);
        setSelectedId(created.id);
      } else {
        const updated = await apiConsoleApi.updateEnvironment(selected.id, form, context);
        toast.success(`محیط «${updated.name}» ذخیره شد.`);
      }
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Environment ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async (id: string) => {
    setSaving(true);
    try {
      const cloned = await apiConsoleApi.cloneEnvironment(id, context);
      toast.success(`کپی «${cloned.name}» ساخته شد.`);
      setCreating(false);
      setSelectedId(cloned.id);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clone محیط ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string, force = false) => {
    setSaving(true);
    try {
      await apiConsoleApi.archiveEnvironment(id, context, force);
      toast.success('محیط آرشیو شد.');
      setCreating(false);
      setSelectedId('');
      await onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'آرشیو محیط ناموفق بود.';
      if (!force && /force=true/i.test(message)) {
        if (window.confirm(`${message}\n\nبا تأیید، آرشیو اجباری انجام می‌شود.`)) {
          setSaving(false);
          await handleArchive(id, true);
          return;
        }
      }
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const updateVariable = (index: number, patch: Partial<ApiVariable>) => {
    setForm(prev => {
      const variables = [...(prev.variables || [])];
      variables[index] = { ...variables[index], ...patch } as ApiVariable;
      return { ...prev, variables };
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
      <Card padding="sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Environments</h2>
          <Button
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setCreating(true);
              setSelectedId('');
              setForm(emptyEnvironmentForm());
            }}
          >
            جدید
          </Button>
        </div>
        <div className="space-y-1">
          {environments.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setCreating(false);
                setSelectedId(item.id);
                setForm(safeCloneEnv(item));
              }}
              className={`w-full rounded-md px-3 py-2 text-right text-sm transition ${
                !creating && selectedId === item.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="font-medium">{item.name}</div>
              <div className={`mt-0.5 font-mono text-[11px] ${!creating && selectedId === item.id ? 'text-gray-300' : 'text-gray-500'}`} dir="ltr">
                {item.kind}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card padding="sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{creating ? 'Environment جدید' : (form.name || 'Environment')}</h2>
            <p className="text-xs text-gray-500">baseUrl، متغیرها و تنظیمات محیط اجرا را مدیریت کنید.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!creating && selected && (
              <>
                <Button size="sm" variant="secondary" onClick={() => { void handleClone(selected.id); }} loading={saving}>Clone</Button>
                <Button size="sm" variant="danger" disabled={!canEditSelected} onClick={() => { void handleArchive(selected.id); }} loading={saving}>آرشیو</Button>
              </>
            )}
            <Button size="sm" disabled={!canEditSelected && !creating} onClick={() => { void handleSave(); }} loading={saving}>ذخیره</Button>
          </div>
        </div>

        {!canEditSelected && !creating ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            این محیط protected است و فقط System Admin / Tech Lead / QA Lead می‌توانند آن را ویرایش کنند.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="نام" value={form.name || ''} disabled={!creating && !canEditSelected} onChange={(event) => setForm(prev => ({ ...prev, name: event.target.value }))} />
          <Select
            label="نوع"
            value={form.kind || 'CUSTOM'}
            disabled={!creating && !canEditSelected}
            onChange={(event) => setForm(prev => ({ ...prev, kind: event.target.value as ApiEnvironmentProfile['kind'] }))}
            options={['DEVELOPMENT', 'TEST', 'PRE_PRODUCTION', 'PRODUCTION', 'CUSTOM'].map(value => ({ value, label: value }))}
          />
          <Input
            label="Base URL"
            className="md:col-span-2"
            dir="ltr"
            value={form.baseUrl || ''}
            disabled={!creating && !canEditSelected}
            onChange={(event) => setForm(prev => ({ ...prev, baseUrl: event.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={Boolean(form.productionProtected)}
              disabled={(!creating && !canEditSelected) || !canManageProtected}
              onChange={(event) => setForm(prev => ({ ...prev, productionProtected: event.target.checked }))}
            />
            Production protected
          </label>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Variables</h3>
            <Button
              size="sm"
              variant="secondary"
              disabled={!creating && !canEditSelected}
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setForm(prev => ({
                ...prev,
                variables: [...(prev.variables || []), { id: `var-${Date.now()}`, key: '', currentValue: '', initialValue: '', sensitive: false, scope: 'ENVIRONMENT', description: '' }],
              }))}
            >
              متغیر
            </Button>
          </div>
          {(form.variables || []).map((variable, index) => (
            <div key={variable.id || index} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-2 md:grid-cols-12">
              <Input className="md:col-span-3" dir="ltr" value={variable.key} disabled={!creating && !canEditSelected} placeholder="key" onChange={(event) => updateVariable(index, { key: event.target.value })} />
              <Input className="md:col-span-5" dir="ltr" value={variable.currentValue} disabled={!creating && !canEditSelected} placeholder="value" type={variable.sensitive ? 'password' : 'text'} onChange={(event) => updateVariable(index, { currentValue: event.target.value, initialValue: event.target.value })} />
              <label className="flex items-center gap-2 text-xs text-gray-600 md:col-span-2">
                <input type="checkbox" checked={Boolean(variable.sensitive)} disabled={!creating && !canEditSelected} onChange={(event) => updateVariable(index, { sensitive: event.target.checked })} />
                Sensitive
              </label>
              <Button
                size="sm"
                variant="ghost"
                className="md:col-span-2"
                disabled={!creating && !canEditSelected}
                onClick={() => setForm(prev => ({ ...prev, variables: (prev.variables || []).filter((_, i) => i !== index) }))}
              >
                حذف
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
