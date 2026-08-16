import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Link2, PlayCircle, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type {
  ApiCollection,
  ApiDiscoverySnapshot,
  DiscoveredOperation,
  RuntimeEnvironmentKind,
  RuntimeProfile,
  RuntimeSessionStatus,
} from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';

type Props = {
  context: ActiveContext;
  projectKey: string;
  collections: ApiCollection[];
  isSystemAdmin: boolean;
  onSynced: () => Promise<void> | void;
  onConnectionChange?: (connected: boolean) => void;
};

type ProfileForm = {
  id?: string;
  rowVersion?: string;
  name: string;
  kind: RuntimeEnvironmentKind;
  origin: string;
  coreBasePath: string;
  loginPath: string;
  appRefererPath: string;
  projectServiceId: string;
  prostage: string;
  dataServiceBaseUrl: string;
  dataServiceAuthMode: RuntimeProfile['dataService']['authMode'];
  dataServiceUsername: string;
  dataServiceTokenPath: string;
  dataServiceAuthSecret: string;
};

const DEFAULT_RUNTIME_ORIGIN = String(import.meta.env.VITE_RUNTIME_DEFAULT_ORIGIN || 'https://soha.m.edus.ir').replace(/\/$/, '');

function defaultProfileName(projectKey: string, origin: string) {
  try {
    const host = new URL(origin).host;
    return origin.replace(/\/$/, '') === DEFAULT_RUNTIME_ORIGIN
      ? `${projectKey} Development`
      : `${projectKey} Development (${host})`;
  } catch {
    return `${projectKey} Development`;
  }
}

const emptyProfile = (projectKey: string): ProfileForm => ({
  name: `${projectKey} Development`,
  kind: 'DEVELOPMENT',
  origin: DEFAULT_RUNTIME_ORIGIN,
  coreBasePath: '/core-api/v1',
  loginPath: '/devlogin',
  appRefererPath: '/',
  projectServiceId: '',
  prostage: 'develop',
  dataServiceBaseUrl: '',
  dataServiceAuthMode: 'NONE',
  dataServiceUsername: '',
  dataServiceTokenPath: '/auth/getToken',
  dataServiceAuthSecret: '',
});

function downloadText(fileName: string, value: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function operationBadge(operation: DiscoveredOperation) {
  if (operation.type === 'CORE_COMMAND') return <Badge variant="danger">fr / Command</Badge>;
  if (operation.type === 'CORE_QUERY') return <Badge variant="info">ds / Query</Badge>;
  return <Badge variant="default">DATA_SERVICE</Badge>;
}

export function RuntimeWorkspace({ context, projectKey, collections, isSystemAdmin, onSynced, onConnectionChange }: Props) {
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [session, setSession] = useState<RuntimeSessionStatus | null>(null);
  const [snapshot, setSnapshot] = useState<ApiDiscoverySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [profileModal, setProfileModal] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => emptyProfile(projectKey));
  const [collectionId, setCollectionId] = useState('');
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [operationSearch, setOperationSearch] = useState('');

  const selectedProfile = profiles.find(item => item.id === selectedProfileId) || profiles[0];
  const candidates = snapshot?.projectServiceIdCandidates || [];
  const visibleOperations = useMemo(() => {
    const term = operationSearch.trim().toLowerCase();
    return (snapshot?.operations || []).filter(operation => !term || [operation.name, operation.sourceId, operation.path].some(value => String(value || '').toLowerCase().includes(term)));
  }, [snapshot, operationSearch]);

  const load = async () => {
    setLoading(true);
    try {
      const [profileRows, latest] = await Promise.all([
        apiConsoleApi.getRuntimeProfiles(projectKey, context),
        apiConsoleApi.getLatestProjectDiscovery(projectKey, context).catch(() => null),
      ]);
      setProfiles(profileRows);
      setSnapshot(latest);
      setSelectedOperationIds(latest?.operations.map(operation => operation.id) || []);
      const profileId = profileRows.some(item => item.id === selectedProfileId) ? selectedProfileId : profileRows[0]?.id || '';
      setSelectedProfileId(profileId);
      if (!collectionId) setCollectionId(collections.find(item => item.applicationId === projectKey)?.id || '');
      if (profileId) {
        const status = await apiConsoleApi.getRuntimeSession(profileId, context);
        setSession(status);
        onConnectionChange?.(status.connected);
      } else {
        setSession(null);
        onConnectionChange?.(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری Runtime ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [projectKey]);

  useEffect(() => {
    if (!selectedProfileId) return;
    apiConsoleApi.getRuntimeSession(selectedProfileId, context).then(status => {
      setSession(status);
      onConnectionChange?.(status.connected);
    }).catch(() => undefined);
  }, [selectedProfileId]);

  const openNewProfile = () => {
    setProfileForm({ ...emptyProfile(projectKey), projectServiceId: candidates.length === 1 ? candidates[0].value : '' });
    setProfileModal(true);
  };

  const openEditProfile = (profile: RuntimeProfile) => {
    setProfileForm({
      id: profile.id,
      rowVersion: profile.rowVersion,
      name: profile.name,
      kind: profile.kind,
      origin: profile.origin,
      coreBasePath: profile.coreBasePath,
      loginPath: profile.loginPath,
      appRefererPath: profile.appRefererPath,
      projectServiceId: profile.projectServiceId || '',
      prostage: profile.prostage || '',
      dataServiceBaseUrl: profile.dataService?.baseUrl || '',
      dataServiceAuthMode: profile.dataService?.authMode || 'NONE',
      dataServiceUsername: profile.dataService?.username || '',
      dataServiceTokenPath: profile.dataService?.tokenPath || '/auth/getToken',
      dataServiceAuthSecret: '',
    });
    setProfileModal(true);
  };

  const saveProfile = async () => {
    const evidence = candidates.find(item => item.value === profileForm.projectServiceId)?.evidence || selectedProfile?.serviceIdEvidence || [];
    if (profileForm.projectServiceId && !evidence.length) {
      toast.error('برای Service ID باید evidence کشف‌شده انتخاب شود.');
      return;
    }
    setProfileSaving(true);
    try {
      const data = {
        applicationId: projectKey,
        projectKey,
        name: profileForm.name,
        kind: profileForm.kind,
        origin: profileForm.origin,
        coreBasePath: profileForm.coreBasePath,
        loginPath: profileForm.loginPath,
        appRefererPath: profileForm.appRefererPath,
        projectServiceId: profileForm.projectServiceId || undefined,
        serviceIdEvidence: evidence,
        prostage: profileForm.prostage || undefined,
        rowVersion: profileForm.rowVersion,
        dataService: {
          baseUrl: profileForm.dataServiceBaseUrl,
          authMode: profileForm.dataServiceAuthMode,
          username: profileForm.dataServiceUsername,
          tokenPath: profileForm.dataServiceTokenPath,
          ...(profileForm.dataServiceAuthSecret ? { authSecret: profileForm.dataServiceAuthSecret } : {}),
        },
      };
      const saved = profileForm.id
        ? await apiConsoleApi.updateRuntimeProfile(profileForm.id, data, context)
        : await apiConsoleApi.createRuntimeProfile(data, context);
      toast.success('Runtime Profile ذخیره شد.');
      setProfileModal(false);
      setPassword('');
      setSelectedProfileId(saved.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Runtime Profile ناموفق بود.');
    } finally {
      setProfileSaving(false);
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const latest = await apiConsoleApi.scanProjectDiscovery(projectKey, context);
      setSnapshot(latest);
      setSelectedOperationIds(latest.operations.map(operation => operation.id));
      toast.success(`${latest.operations.length} عملیات از CDE کشف شد.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'اسکن CDE ناموفق بود.');
    } finally {
      setScanning(false);
    }
  };

  const connect = async () => {
    if (!selectedProfile) return;
    setConnecting(true);
    try {
      const status = await apiConsoleApi.startRuntimeSession(selectedProfile.id, context);
      setSession(status);
      if (status.nextStep === 'password' || status.phase === 'PASSWORD_REQUIRED') setPasswordModal(true);
      else toast.success('نشست Runtime متصل شد.');
      onConnectionChange?.(status.connected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'شروع ورود Runtime ناموفق بود.');
    } finally {
      setConnecting(false);
    }
  };

  const submitPassword = async () => {
    if (!selectedProfile || !password) return;
    setConnecting(true);
    try {
      const status = await apiConsoleApi.finishRuntimeSession(selectedProfile.id, password, context);
      setSession(status);
      setPassword('');
      setPasswordModal(false);
      onConnectionChange?.(status.connected);
      toast.success('ورود Runtime تأیید شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'رمز Runtime پذیرفته نشد.');
    } finally {
      setPassword('');
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!selectedProfile) return;
    const status = await apiConsoleApi.disconnectRuntimeSession(selectedProfile.id, context);
    setSession(status);
    onConnectionChange?.(false);
  };

  const validateProfile = async () => {
    if (!selectedProfile) return;
    try {
      const result = await apiConsoleApi.validateRuntimeProfile(selectedProfile.id, context);
      setProfiles(current => current.map(item => item.id === result.profile.id ? result.profile : item));
      toast.success(`Origin معتبر است: ${result.validation.addresses.join(', ')}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'اعتبارسنجی Origin ناموفق بود.');
    }
  };

  const sync = async () => {
    if (!snapshot || !selectedProfile || !collectionId) return;
    setSyncing(true);
    try {
      const result = await apiConsoleApi.syncProjectDiscovery(projectKey, snapshot.id, { collectionId, runtimeProfileId: selectedProfile.id, operationIds: selectedOperationIds }, context);
      toast.success(`Sync انجام شد: ${result.created.length} جدید، ${result.updated.length} تغییر، ${result.conflicts.length} تعارض، ${result.stale.length} stale.`);
      if (result.conflicts.length) {
        const useSource = window.confirm(`${result.conflicts.length} Request دارای تعارض با ویرایش محلی است. برای تمام فیلدهای متعارض، نسخه جدید CDE جایگزین شود؟`);
        const keepLocal = !useSource && window.confirm('ویرایش‌های محلی حفظ و تعارض‌ها به‌عنوان حل‌شده ثبت شوند؟');
        if (useSource || keepLocal) {
          const choice = useSource ? 'SOURCE' as const : 'LOCAL' as const;
          const conflictResolutions = Object.fromEntries(result.conflicts.map(conflict => [
            conflict.requestId,
            Object.fromEntries(conflict.conflicts.map(field => [field.field, choice])),
          ]));
          const resolved = await apiConsoleApi.syncProjectDiscovery(projectKey, snapshot.id, { collectionId, runtimeProfileId: selectedProfile.id, operationIds: selectedOperationIds, conflictResolutions }, context);
          toast.success(`${resolved.updated.length} تعارض با انتخاب شما حل شد.`);
        }
      }
      await onSynced();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sync عملیات ناموفق بود.');
    } finally {
      setSyncing(false);
    }
  };

  const exportPostman = async () => {
    if (!selectedProfile) return;
    const result = await apiConsoleApi.getRuntimePostman(projectKey, selectedProfile.id, context);
    downloadText(result.fileName, JSON.stringify(result.collection, null, 2), 'application/json;charset=utf-8');
  };

  const exportCurl = async (operation: DiscoveredOperation, mode: 'sample' | 'bundle') => {
    if (!selectedProfile) return;
    const result = await apiConsoleApi.getRuntimeCurl(projectKey, selectedProfile.id, operation.id, mode, context);
    downloadText(result.fileName, result.value);
    if (result.ecreqHelper && result.helperFileName) downloadText(result.helperFileName, result.ecreqHelper, 'application/javascript;charset=utf-8');
  };

  const execute = async (operation: DiscoveredOperation) => {
    if (!selectedProfile) return;
    const confirmed = operation.type !== 'CORE_COMMAND' || window.confirm(`اجرای Command ${operation.sourceId} روی ${selectedProfile.name} را تأیید می‌کنید؟`);
    if (!confirmed) return;
    const businessJustification = operation.type === 'CORE_COMMAND' && selectedProfile.kind === 'PRODUCTION'
      ? window.prompt('دلیل کسب‌وکاری اجرای Production Command را وارد کنید:') || ''
      : '';
    if (operation.type === 'CORE_COMMAND' && selectedProfile.kind === 'PRODUCTION' && !businessJustification.trim()) return;
    try {
      const execution = await apiConsoleApi.executeRuntimeOperation(operation, {
        projectKey,
        runtimeProfileId: selectedProfile.id,
        input: operation.payloadExample || {},
        confirmed: operation.type === 'CORE_COMMAND',
        businessJustification,
      }, context);
      toast.success(`عملیات با HTTP ${execution.statusCode || 200} اجرا شد.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'اجرای Runtime ناموفق بود.');
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">Runtime Profile</label>
            <Select value={selectedProfile?.id || ''} onChange={event => setSelectedProfileId(event.target.value)} options={profiles.map(profile => ({ value: profile.id, label: `${profile.name} — ${profile.origin}` }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={session?.connected ? 'success' : session?.phase === 'PASSWORD_REQUIRED' ? 'warning' : 'default'}>
              {session?.connected ? 'Runtime متصل' : session?.phase === 'PASSWORD_REQUIRED' ? 'در انتظار رمز' : 'Runtime قطع'}
            </Badge>
            {session?.connected ? <Button size="sm" variant="secondary" onClick={disconnect}>قطع اتصال</Button> : <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={connect} loading={connecting} disabled={!selectedProfile}>ورود Runtime</Button>}
            {isSystemAdmin && selectedProfile && <Button size="sm" variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={validateProfile}>اعتبارسنجی Origin</Button>}
            {isSystemAdmin && selectedProfile && <Button size="sm" variant="secondary" onClick={() => openEditProfile(selectedProfile)}>ویرایش Profile</Button>}
            {isSystemAdmin && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNewProfile}>افزودن Origin</Button>}
          </div>
        </div>
        {selectedProfile && (
          <div className="mt-3 grid gap-2 text-xs text-gray-600 md:grid-cols-4" dir="ltr">
            <div className="rounded bg-gray-50 p-2"><b>Origin</b><div className="break-all font-mono">{selectedProfile.origin}</div></div>
            <div className="rounded bg-gray-50 p-2"><b>Runtime serviceId</b><div className="font-mono">{selectedProfile.runtimeServiceId}</div></div>
            <div className="rounded bg-gray-50 p-2"><b>Project serviceId</b><div className="font-mono">{selectedProfile.projectServiceId || 'تأیید نشده'}</div></div>
            <div className="rounded bg-gray-50 p-2"><b>prostage</b><div className="font-mono">{selectedProfile.prostage || '—'}</div></div>
          </div>
        )}
      </Card>

      <Card padding="sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold text-gray-900">Discovery Preview</h2><p className="text-xs text-gray-500">اسکن استاتیک تمام branchهای WEB_UI، API_MODULE و DATA_SERVICE؛ بدون اجرای کد.</p></div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={scan} loading={scanning}>اسکن CDE</Button>
        </div>
        {snapshot ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant={snapshot.serviceIdStatus === 'RESOLVED' ? 'success' : 'danger'}>serviceId: {snapshot.serviceIdStatus}</Badge>
              <Badge variant="info">{snapshot.operations.length} عملیات</Badge>
              <Badge variant="success">{snapshot.stats.new || 0} جدید</Badge>
              <Badge variant="warning">{snapshot.stats.changed || 0} تغییر</Badge>
              <Badge variant="danger">{snapshot.stats.removed || 0} حذف‌شده از سورس</Badge>
              <Badge variant="warning">{snapshot.stats.needsInput || 0} نیازمند ورودی</Badge>
              <span className="text-xs text-gray-500">{new Date(snapshot.createdAt).toLocaleString('fa-IR')}</span>
            </div>
            {candidates.map(candidate => (
              <div key={candidate.value} className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
                <div className="font-mono font-semibold" dir="ltr">{candidate.value}</div>
                {candidate.evidence.map((evidence, index) => <div key={index} className="mt-1 text-xs text-gray-600" dir="ltr">{evidence.repositoryType}/{evidence.packageId}: {evidence.file}:{evidence.line} — {evidence.excerpt}</div>)}
              </div>
            ))}
            {snapshot.warnings.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{snapshot.warnings.map((warning, index) => <div key={index}>{warning.code}: {warning.message}</div>)}</div>}
          </div>
        ) : <p className="mt-4 text-sm text-gray-500">هنوز snapshot ساخته نشده است.</p>}
      </Card>

      {snapshot && (
        <Card padding="sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1"><label className="mb-1 block text-xs text-gray-600">Collection مقصد</label><Select value={collectionId} onChange={event => setCollectionId(event.target.value)} options={collections.filter(item => item.applicationId === projectKey).map(item => ({ value: item.id, label: item.name }))} /></div>
            <div className="min-w-[220px] flex-1"><label className="mb-1 block text-xs text-gray-600">جستجوی عملیات</label><Input value={operationSearch} onChange={event => setOperationSearch(event.target.value)} placeholder="ds/، fr/ یا route" /></div>
            <Button icon={<Save className="h-4 w-4" />} onClick={sync} loading={syncing} disabled={!collectionId || !selectedProfile || !selectedOperationIds.length}>Sync انتخاب‌ها</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportPostman} disabled={!selectedProfile}>Postman</Button>
            <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => selectedProfile && window.open(apiConsoleApi.runtimeDocsUrl(projectKey, selectedProfile.id), '_blank', 'noopener,noreferrer')} disabled={!selectedProfile}>Swagger</Button>
          </div>
          <div className="mt-4 space-y-2">
            {visibleOperations.map(operation => (
              <div key={operation.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3">
                <input type="checkbox" checked={selectedOperationIds.includes(operation.id)} onChange={event => setSelectedOperationIds(current => event.target.checked ? [...new Set([...current, operation.id])] : current.filter(id => id !== operation.id))} />
                <div className="min-w-[220px] flex-1"><div className="font-mono text-sm" dir="ltr">{operation.sourceId}</div><div className="text-xs text-gray-500">{operation.evidence[0]?.file || operation.evidence[0]?.path || operation.sourceKind}</div></div>
                {operationBadge(operation)}
                <Badge variant={operation.schemaCompleteness === 'COMPLETE' ? 'success' : 'warning'}>{operation.schemaCompleteness}</Badge>
                <Badge variant="default">{operation.previewState}</Badge>
                <Button size="sm" variant="ghost" icon={<PlayCircle className="h-4 w-4" />} onClick={() => execute(operation)}>اجرا</Button>
                <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => exportCurl(operation, 'sample')}>cURL</Button>
                {operation.sourceKind === 'API_MODULE' && <Button size="sm" variant="ghost" onClick={() => exportCurl(operation, 'bundle')}>Login bundle</Button>}
              </div>
            ))}
            {snapshot.removedOperations.map(operation => (
              <div key={`removed-${operation.id}`} className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 opacity-80">
                <div className="min-w-[220px] flex-1"><div className="font-mono text-sm line-through" dir="ltr">{operation.sourceId}</div><div className="text-xs text-red-600">از CDE حذف شده؛ Request موجود در Sync فقط STALE می‌شود و خودکار پاک نخواهد شد.</div></div>
                <Badge variant="danger">REMOVED</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading && <div className="text-sm text-gray-500">در حال بارگذاری Runtime…</div>}

      <Modal isOpen={passwordModal} onClose={() => { setPassword(''); setPasswordModal(false); }} title="ورود Runtime" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-3 text-sm">شماره حساب CDE به‌صورت قفل‌شده استفاده می‌شود: <span className="font-mono" dir="ltr">{context.user?.phoneNumber || '—'}</span></div>
          <Input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="رمز Runtime" onKeyDown={event => { if (event.key === 'Enter') void submitPassword(); }} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setPassword(''); setPasswordModal(false); }}>لغو</Button><Button onClick={submitPassword} loading={connecting} disabled={!password}>تأیید</Button></div>
        </div>
      </Modal>

      <Modal isOpen={profileModal} onClose={() => setProfileModal(false)} title={profileForm.id ? 'ویرایش Runtime Origin' : 'افزودن Runtime Origin'} size="wide">
        <div className="space-y-4">
          {!profileForm.id && <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">فقط Origin را وارد یا تغییر دهید. مسیر Core، مسیر ورود، medugovir، محیط Development و prostage=develop به‌صورت پیش‌فرض اعمال می‌شوند.</div>}
          <Input
            label="Origin HTTPS"
            dir="ltr"
            value={profileForm.origin}
            onChange={event => {
              const origin = event.target.value;
              setProfileForm(value => ({ ...value, origin, name: value.id ? value.name : defaultProfileName(projectKey, origin) }));
            }}
            placeholder="https://soha.m.edus.ir"
            hint="نمونه: https://soha.m.edus.ir یا https://adib.m.edus.ir"
          />
          <details className="rounded-lg border border-gray-200 p-3" open={Boolean(profileForm.id)}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">تنظیمات پیشرفته (اختیاری)</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input label="نام Profile" value={profileForm.name} onChange={event => setProfileForm(value => ({ ...value, name: event.target.value }))} />
              <Select label="نوع محیط" value={profileForm.kind} onChange={event => setProfileForm(value => ({ ...value, kind: event.target.value as RuntimeEnvironmentKind }))} options={['DEVELOPMENT', 'TEST', 'PRE_PRODUCTION', 'PRODUCTION'].map(value => ({ value, label: value }))} />
              <Input label="App referer path" dir="ltr" value={profileForm.appRefererPath} onChange={event => setProfileForm(value => ({ ...value, appRefererPath: event.target.value }))} placeholder="/community" />
              <Input label="Core base path" dir="ltr" value={profileForm.coreBasePath} onChange={event => setProfileForm(value => ({ ...value, coreBasePath: event.target.value }))} />
              <Input label="Login path" dir="ltr" value={profileForm.loginPath} onChange={event => setProfileForm(value => ({ ...value, loginPath: event.target.value }))} />
              <Select label="Project Service ID + evidence" value={profileForm.projectServiceId} onChange={event => setProfileForm(value => ({ ...value, projectServiceId: event.target.value }))} options={[{ value: '', label: 'تأیید نشده' }, ...candidates.map(item => ({ value: item.value, label: item.value }))]} />
              <Input label="prostage" dir="ltr" value={profileForm.prostage} onChange={event => setProfileForm(value => ({ ...value, prostage: event.target.value }))} />
              <Input label="DATA_SERVICE base URL" dir="ltr" value={profileForm.dataServiceBaseUrl} onChange={event => setProfileForm(value => ({ ...value, dataServiceBaseUrl: event.target.value }))} placeholder="https://data.example.ir/api" />
              <Select label="DATA_SERVICE auth" value={profileForm.dataServiceAuthMode} onChange={event => setProfileForm(value => ({ ...value, dataServiceAuthMode: event.target.value as RuntimeProfile['dataService']['authMode'] }))} options={['NONE', 'BEARER', 'BASIC', 'TOKEN_ENDPOINT'].map(value => ({ value, label: value }))} />
              {profileForm.dataServiceAuthMode === 'BASIC' && <Input label="DATA_SERVICE username" value={profileForm.dataServiceUsername} onChange={event => setProfileForm(value => ({ ...value, dataServiceUsername: event.target.value }))} />}
              {profileForm.dataServiceAuthMode === 'TOKEN_ENDPOINT' && <Input label="Token path" dir="ltr" value={profileForm.dataServiceTokenPath} onChange={event => setProfileForm(value => ({ ...value, dataServiceTokenPath: event.target.value }))} placeholder="/auth/getToken" />}
              {profileForm.dataServiceAuthMode === 'TOKEN_ENDPOINT' && <Input label="DATA_SERVICE username" value={profileForm.dataServiceUsername} onChange={event => setProfileForm(value => ({ ...value, dataServiceUsername: event.target.value }))} />}
              {profileForm.dataServiceAuthMode !== 'NONE' && <Input label="Auth secret (فقط Vault)" type="password" autoComplete="new-password" value={profileForm.dataServiceAuthSecret} onChange={event => setProfileForm(value => ({ ...value, dataServiceAuthSecret: event.target.value }))} placeholder={profileForm.id ? 'برای حفظ مقدار قبلی خالی بگذارید' : ''} />}
            </div>
          </details>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div>{profileForm.id && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (!profileForm.id || !window.confirm('Profile غیرفعال شود؟')) return; await apiConsoleApi.disableRuntimeProfile(profileForm.id, context); setProfileModal(false); await load(); }}>غیرفعال‌سازی</Button>}</div>
          <div className="flex gap-2"><Button variant="secondary" onClick={() => setProfileModal(false)}>لغو</Button><Button icon={<ShieldCheck className="h-4 w-4" />} onClick={saveProfile} loading={profileSaving}>ذخیره و تأیید</Button></div>
        </div>
      </Modal>
    </div>
  );
}
