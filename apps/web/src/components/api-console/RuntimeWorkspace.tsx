import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Link2,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ActiveContext } from '../../types';
import type {
  ApiCollection,
  ApiDiscoverySnapshot,
  ApiRequestDefinition,
  ApiRequestExecution,
  DiscoveryPreviewState,
  DiscoverySyncResult,
  DiscoveredOperation,
  RuntimeEnvironmentKind,
  RuntimeProfile,
  RuntimeSessionStatus,
} from '../../types/apiConsole';
import { PERSONAL_APPLICATION_ID, PERSONAL_APPLICATION_LABEL } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import {
  isApi,
  type IsOperationDescriptor,
  type IsSystemDescriptor,
  type IsWorkspaceDescriptor,
} from '../../services/isApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select, Textarea, SearchableSelect } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Pagination } from '../ui/Table';
import { toast } from '../ui/Toast';
import { ApplicationSelect } from '../ui/ApplicationSelect';
import { useApplicationLookup } from '../../utils/useApplicationLookup';

type OperationTypeFilter = 'ALL' | 'CORE_QUERY' | 'CORE_COMMAND' | 'REST';
type InspectorTab = 'request' | 'response';
type ConflictChoice = 'SOURCE' | 'LOCAL';
type ConflictResolutions = Record<string, Record<string, ConflictChoice>>;
type WorkspaceMode = 'cde' | 'free' | 'is';

const RUNTIME_KIND_ORDER: RuntimeEnvironmentKind[] = ['DEVELOPMENT', 'TEST', 'PRE_PRODUCTION', 'PRODUCTION'];
const RUNTIME_KIND_LABELS: Record<RuntimeEnvironmentKind, string> = {
  DEVELOPMENT: 'Development',
  TEST: 'Test',
  PRE_PRODUCTION: 'Pre-Production',
  PRODUCTION: 'Production',
};
const PROTECTED_ENV_ROLES = new Set(['SYSTEM_ADMIN', 'TECH_LEAD', 'QA_LEAD']);

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function prettyResponseBody(raw: string | undefined) {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw.replace(/^\uFEFF/, '')), null, 2);
  } catch {
    return raw;
  }
}

function parseJsonObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, message: 'ورودی باید یک آبجکت JSON باشد.' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'JSON نامعتبر است.' };
  }
}

function operationPayloadLabel(operation: DiscoveredOperation) {
  if (operation.type === 'CORE_COMMAND') return 'Data (fr)';
  if (operation.type === 'CORE_QUERY') return 'Params (ds)';
  return 'Request body';
}

function operationProviderId(operation: DiscoveredOperation) {
  if (operation.type === 'CORE_COMMAND') return operation.sourceId.replace(/^fr\//, '');
  if (operation.type === 'CORE_QUERY') return operation.sourceId.replace(/^ds\//, '');
  return operation.path || operation.sourceId;
}

function operationEndpoint(operation: DiscoveredOperation) {
  if (operation.type === 'CORE_COMMAND') return 'store-form-data';
  if (operation.type === 'CORE_QUERY') return 'get-data-source';
  return `${operation.method || 'REST'} ${operation.path || ''}`.trim();
}

function operationBadge(operation: DiscoveredOperation) {
  if (operation.type === 'CORE_COMMAND') return <Badge variant="danger">fr</Badge>;
  if (operation.type === 'CORE_QUERY') return <Badge variant="info">ds</Badge>;
  return <Badge variant="default">rest</Badge>;
}

function previewStateBadge(state: DiscoveryPreviewState | undefined) {
  if (!state || state === 'UNCHANGED') return <Badge variant="default" size="sm">UNCHANGED</Badge>;
  if (state === 'NEW') return <Badge variant="success" size="sm">NEW</Badge>;
  if (state === 'CHANGED') return <Badge variant="warning" size="sm">CHANGED</Badge>;
  return <Badge variant="danger" size="sm">REMOVED</Badge>;
}

function isDataServiceBlockedError(message: string) {
  return /DATA_SERVICE_EXECUTION_BLOCKED|DATA_SERVICE_AUTH_REQUIRED|اجرای Data Service|احراز هویت Data Service|Data Service execution|Data Service authentication|Data Service token/i.test(message);
}

function defaultConflictResolutions(conflicts: DiscoverySyncResult['conflicts']): ConflictResolutions {
  return Object.fromEntries(conflicts.map(conflict => [
    conflict.requestId,
    Object.fromEntries(conflict.conflicts.map(field => [field.field, 'SOURCE' as ConflictChoice])),
  ]));
}

function formatConflictValue(value: unknown) {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value || '""';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function RuntimeJsonViewer({ value, maxHeightClass = 'max-h-[min(60vh,520px)]' }: { value: string; maxHeightClass?: string }) {
  const [fontSize, setFontSize] = useState(12);
  const lines = useMemo(() => (value || '-').split(/\r?\n/), [value]);
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-950" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-gray-800 px-2 py-1 font-mono text-gray-100">JSON</span>
          <span className="rounded bg-gray-800 px-2 py-1">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setFontSize(size => Math.max(10, size - 1))} className="rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center font-mono">{fontSize}px</span>
          <button type="button" aria-label="Zoom in" onClick={() => setFontSize(size => Math.min(20, size + 1))} className="rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Copy JSON"
            onClick={() => {
              void navigator.clipboard?.writeText(value || '');
              toast.success('JSON کپی شد.');
            }}
            className="rounded-md p-1.5 text-gray-300 hover:bg-gray-800 hover:text-white"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
      <pre className={`${maxHeightClass} overflow-auto whitespace-pre p-3 font-mono text-gray-100`} style={{ fontSize, lineHeight: 1.55 }}>
        {value || '-'}
      </pre>
    </div>
  );
}

type Props = {
  context: ActiveContext;
  projectKey: string;
  collections: ApiCollection[];
  isSystemAdmin: boolean;
  onSynced: () => Promise<void> | void;
  onConnectionChange?: (connected: boolean) => void;
  onCreateFreeRequest?: (applicationId?: string) => void | Promise<void>;
  onOpenRequest?: (requestId: string) => void | Promise<void>;
  canCreateFreeRequest?: boolean;
  projects?: Array<{ projectKey: string }>;
  onSelectProject?: (projectKey: string) => void | Promise<void>;
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

function dataServiceChecklist(profile: Pick<RuntimeProfile, 'dataService'> | ProfileForm | null | undefined) {
  if (!profile) {
    return [
      { ok: false, label: 'پروفایل Runtime انتخاب نشده' },
      { ok: false, label: 'base URL HTTPS تنظیم شود' },
      { ok: false, label: 'حالت احراز هویت انتخاب شود' },
      { ok: false, label: 'executionEnabled پس از ذخیره' },
    ];
  }
  if ('dataService' in profile) {
    const ds = profile.dataService;
    return [
      { ok: Boolean(ds.baseUrl), label: 'base URL HTTPS' },
      { ok: Boolean(ds.authMode), label: `auth mode: ${ds.authMode}` },
      { ok: ds.authMode === 'NONE' || ds.authConfigured, label: ds.authMode === 'NONE' ? 'secret لازم نیست' : 'auth secret پیکربندی شده' },
      { ok: ds.executionEnabled, label: 'executionEnabled پس از ذخیره' },
    ];
  }
  const hasBase = /^https:\/\//i.test(profile.dataServiceBaseUrl.trim());
  const authOk = profile.dataServiceAuthMode === 'NONE' || Boolean(profile.dataServiceAuthSecret.trim()) || Boolean(profile.id);
  const tokenOk = profile.dataServiceAuthMode !== 'TOKEN_ENDPOINT'
    || Boolean(profile.dataServiceTokenPath.trim() && profile.dataServiceUsername.trim());
  const ready = hasBase && authOk && tokenOk
    && (profile.dataServiceAuthMode === 'NONE' || Boolean(profile.dataServiceAuthSecret.trim() || profile.id));
  return [
    { ok: hasBase, label: 'base URL HTTPS' },
    { ok: Boolean(profile.dataServiceAuthMode), label: `auth mode: ${profile.dataServiceAuthMode}` },
    { ok: authOk && tokenOk, label: profile.dataServiceAuthMode === 'NONE' ? 'secret لازم نیست' : 'auth secret / token تنظیمات' },
    { ok: ready, label: 'آمادهٔ ذخیره برای executionEnabled' },
  ];
}

function warningLabel(code: string) {
  if (code === 'API_MODULE_PREFIX_UNSUPPORTED') {
    return 'ماژول‌هایی که با ds/ یا fr/ شروع نمی‌شوند نادیده گرفته شدند (مثلاً app یا UI helper).';
  }
  if (code === 'CDE_PACKAGE_NO_BRANCH') {
    return 'برای بعضی پکیج‌های CDE branch قابل‌دسترسی پیدا نشد.';
  }
  if (code === 'DATA_SERVICE_DYNAMIC_ROUTE') {
    return 'Routeهای داینامیک Data Service از اسکن استاتیک حذف شدند.';
  }
  return 'هشدارهای اسکن Discovery — مانع اجرا نیستند.';
}

function groupDiscoveryWarnings(warnings: ApiDiscoverySnapshot['warnings']) {
  const groups = new Map<string, ApiDiscoverySnapshot['warnings']>();
  for (const warning of warnings) {
    const code = warning.code || 'UNKNOWN';
    const rows = groups.get(code) || [];
    rows.push(warning);
    groups.set(code, rows);
  }
  return Array.from(groups.entries()).map(([code, rows]) => ({ code, rows, label: warningLabel(code) }));
}

function downloadText(fileName: string, value: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RuntimeWorkspace({
  context,
  projectKey,
  collections,
  isSystemAdmin,
  onSynced,
  onConnectionChange,
  onCreateFreeRequest,
  onOpenRequest,
  canCreateFreeRequest = true,
  projects = [],
  onSelectProject,
}: Props) {
  const { getApplicationName } = useApplicationLookup();
  const isIsApproach = context.authApproach === 'IS' || context.identitySource === 'IS';
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(isIsApproach ? 'is' : 'cde');

  useEffect(() => {
    if (isIsApproach) setWorkspaceMode('is');
  }, [isIsApproach]);

  const [isSystems, setIsSystems] = useState<IsSystemDescriptor[]>([]);
  const [isWorkspaces, setIsWorkspaces] = useState<IsWorkspaceDescriptor[]>([]);
  const [isSystemsLoading, setIsSystemsLoading] = useState(false);
  const [isWorkspaceFilter, setIsWorkspaceFilter] = useState<string>('all');
  const [isCategoryFilter, setIsCategoryFilter] = useState<string>('all');
  const [isSelectedServiceKey, setIsSelectedServiceKey] = useState('');
  const [isOperations, setIsOperations] = useState<IsOperationDescriptor[]>([]);
  const [isOpsLoading, setIsOpsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWarnings, setIsWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [isSelectedOpIds, setIsSelectedOpIds] = useState<string[]>([]);
  const [isSearch, setIsSearch] = useState('');
  const [isCounts, setIsCounts] = useState<{ total: number; specs?: number; gateway: number; openapi: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [freeSystemId, setFreeSystemId] = useState('');
  const [freeSearch, setFreeSearch] = useState('');
  const [freeRequests, setFreeRequests] = useState<ApiRequestDefinition[]>([]);
  const [freeLoading, setFreeLoading] = useState(false);
  const [freeCreating, setFreeCreating] = useState(false);
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
  const [approvingServiceId, setApprovingServiceId] = useState('');
  const [profileForm, setProfileForm] = useState<ProfileForm>(() => emptyProfile(projectKey));
  const [collectionId, setCollectionId] = useState('');
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [operationSearch, setOperationSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<OperationTypeFilter>('ALL');
  const [needsInputOnly, setNeedsInputOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedOperationId, setSelectedOperationId] = useState('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('request');
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  const [executionsByOp, setExecutionsByOp] = useState<Record<string, ApiRequestExecution>>({});
  const [executeInputError, setExecuteInputError] = useState('');
  const [executing, setExecuting] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [dsWizardStep, setDsWizardStep] = useState(1);
  const [focusDataService, setFocusDataService] = useState(false);
  const [dsBlockedHint, setDsBlockedHint] = useState(false);
  const [locallyReadyOps, setLocallyReadyOps] = useState<Record<string, boolean>>({});
  const [promoteTargetKind, setPromoteTargetKind] = useState<RuntimeEnvironmentKind>('TEST');
  const [promoting, setPromoting] = useState(false);
  const [conflictModal, setConflictModal] = useState<{
    conflicts: DiscoverySyncResult['conflicts'];
    resolutions: ConflictResolutions;
  } | null>(null);
  const canPromote = PROTECTED_ENV_ROLES.has(context.role);

  const selectedProfile = profiles.find(item => item.id === selectedProfileId) || profiles[0];
  const promoteKindOptions = useMemo(
    () => RUNTIME_KIND_ORDER
      .filter(kind => kind !== selectedProfile?.kind)
      .map(value => ({ value, label: RUNTIME_KIND_LABELS[value] })),
    [selectedProfile?.kind],
  );

  useEffect(() => {
    if (!promoteKindOptions.length) return;
    if (!promoteKindOptions.some(option => option.value === promoteTargetKind)) {
      setPromoteTargetKind(promoteKindOptions[0].value);
    }
  }, [promoteKindOptions, promoteTargetKind]);

  const candidates = snapshot?.projectServiceIdCandidates || [];
  const provisionedOrigins = useMemo(
    () => [...new Set(profiles.map(profile => profile.origin.replace(/\/$/, '')).filter(Boolean))].sort(),
    [profiles],
  );
  const profilesByKind = useMemo(() => (
    RUNTIME_KIND_ORDER
      .map(kind => ({ kind, rows: profiles.filter(profile => profile.kind === kind) }))
      .filter(group => group.rows.length > 0)
  ), [profiles]);
  const kindSelectOptions = useMemo(
    () => (isSystemAdmin ? RUNTIME_KIND_ORDER : (['DEVELOPMENT'] as RuntimeEnvironmentKind[])).map(value => ({
      value,
      label: RUNTIME_KIND_LABELS[value],
    })),
    [isSystemAdmin],
  );
  const driftStats = {
    new: snapshot?.stats?.new || 0,
    changed: snapshot?.stats?.changed || 0,
    removed: snapshot?.stats?.removed || (snapshot?.removedOperations?.length || 0),
    needsInput: snapshot?.stats?.needsInput || 0,
  };

  const filteredOperations = useMemo(() => {
    const term = operationSearch.trim().toLowerCase();
    return (snapshot?.operations || []).filter(operation => {
      if (typeFilter !== 'ALL' && operation.type !== typeFilter) return false;
      if (needsInputOnly && operation.schemaCompleteness !== 'NEEDS_INPUT') return false;
      if (!term) return true;
      const haystack = [
        operation.name,
        operation.sourceId,
        operation.path,
        operation.moduleId,
        operation.evidence[0]?.file,
        operation.evidence[0]?.path,
        operationProviderId(operation),
      ].map(value => String(value || '').toLowerCase());
      return haystack.some(value => value.includes(term));
    });
  }, [snapshot, operationSearch, typeFilter, needsInputOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredOperations.length / pageSize));
  const pagedOperations = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredOperations.slice(start, start + pageSize);
  }, [filteredOperations, page, pageSize]);

  const selectedOperation = useMemo(
    () => (snapshot?.operations || []).find(item => item.id === selectedOperationId) || null,
    [snapshot, selectedOperationId],
  );

  const selectedDraft = selectedOperation
    ? (draftInputs[selectedOperation.id] ?? prettyJson(selectedOperation.payloadExample || {}))
    : '';

  const selectedExecution = selectedOperation ? executionsByOp[selectedOperation.id] : undefined;
  const selectedResponseBody = useMemo(
    () => prettyResponseBody(selectedExecution?.response?.bodyPreview),
    [selectedExecution],
  );

  useEffect(() => {
    setPage(1);
  }, [operationSearch, typeFilter, needsInputOnly, pageSize, snapshot?.id]);

  useEffect(() => {
    if (!selectedOperationId && pagedOperations[0]) {
      setSelectedOperationId(pagedOperations[0].id);
      return;
    }
    if (selectedOperationId && !(snapshot?.operations || []).some(item => item.id === selectedOperationId)) {
      setSelectedOperationId(pagedOperations[0]?.id || '');
    }
  }, [pagedOperations, selectedOperationId, snapshot]);

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
      if (latest?.operations[0] && !selectedOperationId) setSelectedOperationId(latest.operations[0].id);
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

  const loadFreeRequests = async () => {
    setFreeLoading(true);
    try {
      const scope = freeSystemId || 'ALL';
      const response = await apiConsoleApi.getRequests(scope, {
        page: 1,
        limit: 100,
        search: freeSearch,
        sourceApproach: freeSystemId === PERSONAL_APPLICATION_ID ? undefined : 'FREE',
      }, context);
      const rows = freeSystemId === PERSONAL_APPLICATION_ID
        ? response.data.filter(item => item.applicationId === PERSONAL_APPLICATION_ID)
        : response.data.filter(item => item.sourceType !== 'CDE_DISCOVERY');
      setFreeRequests(rows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری درخواست‌های آزاد ناموفق بود.');
      setFreeRequests([]);
    } finally {
      setFreeLoading(false);
    }
  };

  useEffect(() => {
    if (workspaceMode !== 'free') return;
    void loadFreeRequests();
  }, [workspaceMode, freeSystemId]);

  const handleCreateFree = async () => {
    if (!onCreateFreeRequest) return;
    setFreeCreating(true);
    try {
      await onCreateFreeRequest(freeSystemId || PERSONAL_APPLICATION_ID);
      await loadFreeRequests();
    } finally {
      setFreeCreating(false);
    }
  };

  const loadIsSystems = async () => {
    setIsSystemsLoading(true);
    try {
      const response = await isApi.systems();
      const systems = (response.products?.length ? response.products : response.systems) || [];
      setIsSystems(systems);
      setIsWorkspaces(response.workspaces || []);
      setIsWarnings(response.warnings || []);
      if (!isSelectedServiceKey && systems[0]) {
        setIsSelectedServiceKey(systems[0].serviceKey);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری محصولات Spec ناموفق بود.');
      setIsSystems([]);
      setIsWorkspaces([]);
    } finally {
      setIsSystemsLoading(false);
    }
  };

  const loadIsApis = async (serviceKey = isSelectedServiceKey) => {
    if (!serviceKey) return;
    setIsOpsLoading(true);
    try {
      const system = isSystems.find(item => item.serviceKey === serviceKey);
      const response = await isApi.systemApis(serviceKey, {
        workspace: system?.workspaceIndex,
        specFolder: system?.specFolder || undefined,
      });
      setIsOperations(response.operations || []);
      setIsCounts(response.counts || null);
      setIsWarnings(response.warnings || []);
      setIsSelectedOpIds((response.operations || []).map(item => item.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'کشف API از Spec ناموفق بود.');
      setIsOperations([]);
      setIsCounts(null);
    } finally {
      setIsOpsLoading(false);
    }
  };

  const syncIsApis = async () => {
    if (!isSelectedServiceKey) return;
    setIsSyncing(true);
    try {
      const system = isSystems.find(item => item.serviceKey === isSelectedServiceKey);
      const result = await isApi.syncSystem(isSelectedServiceKey, {
        label: system?.label,
        operationIds: isSelectedOpIds.length ? isSelectedOpIds : undefined,
        specFolder: system?.specFolder || undefined,
        workspaceIndex: system?.workspaceIndex,
      });
      toast.success(`همگام‌سازی ${result.created + result.updated} درخواست (جدید: ${result.created}، به‌روز: ${result.updated})`);
      setIsWarnings(result.warnings || []);
      await onSynced();
      if (onSelectProject) {
        await onSelectProject(result.applicationId);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'همگام‌سازی IS ناموفق بود.');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (workspaceMode !== 'is') return;
    void loadIsSystems();
  }, [workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== 'is' || !isSelectedServiceKey) return;
    void loadIsApis(isSelectedServiceKey);
  }, [workspaceMode, isSelectedServiceKey]);

  const isCategoryOptions = useMemo(() => {
    const selectedWorkspace = isWorkspaceFilter === 'all'
      ? null
      : isWorkspaces.find(item => String(item.workspaceIndex) === isWorkspaceFilter);
    const categories = new Map<string, string>();
    if (selectedWorkspace?.categories?.length) {
      for (const row of selectedWorkspace.categories) {
        categories.set(String(row.slug), String(row.title || row.slug));
      }
    } else {
      for (const system of isSystems) {
        if (!system.category) continue;
        if (isWorkspaceFilter !== 'all' && String(system.workspaceIndex) !== isWorkspaceFilter) continue;
        categories.set(system.category, system.categoryTitle || system.category);
      }
    }
    return Array.from(categories.entries()).sort((a, b) => a[1].localeCompare(b[1], 'fa'));
  }, [isSystems, isWorkspaces, isWorkspaceFilter]);

  const filteredIsSystems = useMemo(() => {
    return isSystems.filter(system => {
      if (isWorkspaceFilter !== 'all' && String(system.workspaceIndex) !== isWorkspaceFilter) return false;
      if (isCategoryFilter !== 'all' && system.category !== isCategoryFilter) return false;
      // Prefer products that came from specs disk when filters active
      if ((isWorkspaceFilter !== 'all' || isCategoryFilter !== 'all') && !system.specFolder) return false;
      return true;
    });
  }, [isSystems, isWorkspaceFilter, isCategoryFilter]);

  useEffect(() => {
    if (!filteredIsSystems.length) return;
    if (!filteredIsSystems.some(item => item.serviceKey === isSelectedServiceKey)) {
      setIsSelectedServiceKey(filteredIsSystems[0].serviceKey);
    }
  }, [filteredIsSystems, isSelectedServiceKey]);

  const filteredIsOperations = useMemo(() => {
    const q = isSearch.trim().toLowerCase();
    if (!q) return isOperations;
    return isOperations.filter(op =>
      [op.name, op.path, op.method, op.description, op.controllerName, op.actionName, ...(op.folderPath || [])]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q))
    );
  }, [isOperations, isSearch]);

  const openNewProfile = () => {
    setProfileForm({
      ...emptyProfile(projectKey),
      kind: 'DEVELOPMENT',
      projectServiceId: candidates.length === 1 ? candidates[0].value : '',
    });
    setDsWizardStep(1);
    setFocusDataService(false);
    setProfileModal(true);
  };

  const openEditProfile = (profile: RuntimeProfile, options?: { focusDataService?: boolean }) => {
    setProfileForm({
      id: profile.id,
      rowVersion: profile.rowVersion,
      name: profile.name,
      kind: isSystemAdmin ? profile.kind : 'DEVELOPMENT',
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
    setDsWizardStep(1);
    setFocusDataService(Boolean(options?.focusDataService));
    setProfileModal(true);
  };

  const openDataServiceSettings = () => {
    setDsBlockedHint(false);
    if (isSystemAdmin && selectedProfile) {
      openEditProfile(selectedProfile, { focusDataService: true });
      return;
    }
    const items = dataServiceChecklist(selectedProfile);
    toast.error(`تنظیمات Data Service فقط توسط ادمین قابل ذخیره است. وضعیت: ${items.map(item => `${item.ok ? '✓' : '✗'} ${item.label}`).join(' · ')}`);
  };

  const saveProfile = async () => {
    const evidence = candidates.find(item => item.value === profileForm.projectServiceId)?.evidence || selectedProfile?.serviceIdEvidence || [];
    if (profileForm.projectServiceId && !evidence.length) {
      toast.error('برای Service ID باید evidence کشف‌شده انتخاب شود.');
      return;
    }
    const kind = isSystemAdmin ? profileForm.kind : 'DEVELOPMENT';
    setProfileSaving(true);
    try {
      const data = {
        applicationId: projectKey,
        projectKey,
        name: profileForm.name,
        kind,
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
      toast.success(saved.dataService?.executionEnabled
        ? 'Runtime Profile ذخیره شد — Data Service برای اجرا آماده است.'
        : 'Runtime Profile ذخیره شد.');
      setProfileModal(false);
      setFocusDataService(false);
      setPassword('');
      setSelectedProfileId(saved.id);
      setDsBlockedHint(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ذخیره Runtime Profile ناموفق بود.');
    } finally {
      setProfileSaving(false);
    }
  };

  const approveProjectServiceId = async (
    candidate: ApiDiscoverySnapshot['projectServiceIdCandidates'][number],
    profile: RuntimeProfile | undefined = selectedProfile,
  ) => {
    if (!isSystemAdmin || !profile) return false;
    if (!candidate.evidence.length) {
      toast.error('این Service ID فاقد evidence معتبر است و قابل تأیید نیست.');
      return false;
    }
    if (!window.confirm(`Service ID «${candidate.value}» برای Runtime «${profile.origin}» تأیید شود؟`)) return false;
    setApprovingServiceId(candidate.value);
    try {
      const saved = await apiConsoleApi.updateRuntimeProfile(profile.id, {
        applicationId: projectKey,
        projectKey,
        projectServiceId: candidate.value,
        serviceIdEvidence: candidate.evidence,
        rowVersion: profile.rowVersion,
      }, context);
      setProfiles(current => current.map(item => item.id === saved.id ? saved : item));
      toast.success(`Service ID ${candidate.value} برای این Runtime تأیید شد.`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تأیید Service ID ناموفق بود.');
      return false;
    } finally {
      setApprovingServiceId('');
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const latest = await apiConsoleApi.scanProjectDiscovery(projectKey, context);
      setSnapshot(latest);
      setSelectedOperationIds(latest.operations.map(operation => operation.id));
      setSelectedOperationId(latest.operations[0]?.id || '');
      setPage(1);
      toast.success(`${latest.operations.length} عملیات از CDE کشف شد.`);
      const uniqueCandidate = latest.projectServiceIdCandidates.length === 1 ? latest.projectServiceIdCandidates[0] : undefined;
      if (isSystemAdmin && selectedProfile && uniqueCandidate && selectedProfile.projectServiceId !== uniqueCandidate.value) {
        await approveProjectServiceId(uniqueCandidate, selectedProfile);
      }
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

  const promoteProfile = async () => {
    if (!selectedProfile || !canPromote) return;
    if (promoteTargetKind === selectedProfile.kind) {
      toast.error('محیط مقصد باید با محیط فعلی متفاوت باشد.');
      return;
    }
    setPromoting(true);
    try {
      const promoted = await apiConsoleApi.promoteRuntimeProfile(selectedProfile.id, promoteTargetKind, context);
      toast.success(`پروفایل به ${RUNTIME_KIND_LABELS[promoted.kind]} ارتقا یافت.`);
      await load();
      setSelectedProfileId(promoted.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ارتقا پروفایل ناموفق بود.');
    } finally {
      setPromoting(false);
    }
  };

  const sync = async () => {
    if (!snapshot || !selectedProfile || !collectionId) return;
    setSyncing(true);
    try {
      const result = await apiConsoleApi.syncProjectDiscovery(projectKey, snapshot.id, { collectionId, runtimeProfileId: selectedProfile.id, operationIds: selectedOperationIds }, context);
      toast.success(`Sync انجام شد: ${result.created.length} جدید، ${result.updated.length} تغییر، ${result.conflicts.length} تعارض، ${result.stale.length} stale.`);
      if (result.conflicts.length) {
        setConflictModal({
          conflicts: result.conflicts,
          resolutions: defaultConflictResolutions(result.conflicts),
        });
      }
      await onSynced();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sync عملیات ناموفق بود.');
    } finally {
      setSyncing(false);
    }
  };

  const applyConflictResolutions = async () => {
    if (!conflictModal || !snapshot || !selectedProfile || !collectionId) return;
    setSyncing(true);
    try {
      const resolved = await apiConsoleApi.syncProjectDiscovery(projectKey, snapshot.id, {
        collectionId,
        runtimeProfileId: selectedProfile.id,
        operationIds: selectedOperationIds,
        conflictResolutions: conflictModal.resolutions,
      }, context);
      toast.success(`${resolved.updated.length} تعارض با انتخاب شما حل شد.`);
      setConflictModal(null);
      await onSynced();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حل تعارض Sync ناموفق بود.');
    } finally {
      setSyncing(false);
    }
  };

  const setAllConflictChoices = (choice: ConflictChoice) => {
    setConflictModal(current => {
      if (!current) return current;
      return {
        ...current,
        resolutions: Object.fromEntries(current.conflicts.map(conflict => [
          conflict.requestId,
          Object.fromEntries(conflict.conflicts.map(field => [field.field, choice])),
        ])),
      };
    });
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

  const refreshSession = async (profileId = selectedProfileId) => {
    if (!profileId) {
      setSession(null);
      onConnectionChange?.(false);
      return null;
    }
    const status = await apiConsoleApi.getRuntimeSession(profileId, context);
    setSession(status);
    onConnectionChange?.(status.connected);
    return status;
  };

  const selectOperation = (operation: DiscoveredOperation) => {
    setSelectedOperationId(operation.id);
    setExecuteInputError('');
    setInspectorTab(executionsByOp[operation.id] ? 'response' : 'request');
    setDraftInputs(current => (
      current[operation.id] === undefined
        ? { ...current, [operation.id]: prettyJson(operation.payloadExample || {}) }
        : current
    ));
  };

  const executeSelected = async () => {
    if (!selectedProfile || !selectedOperation) return;
    const parsed = parseJsonObject(selectedDraft);
    if (!parsed.ok) {
      setExecuteInputError(parsed.message);
      setInspectorTab('request');
      return;
    }
    setExecuteInputError('');
    const needsInput = selectedOperation.schemaCompleteness === 'NEEDS_INPUT' && !locallyReadyOps[selectedOperation.id];
    if (needsInput && Object.keys(parsed.value).length === 0) {
      setExecuteInputError(
        `عملیات ${selectedOperation.sourceId} نیازمند ورودی است و ${operationPayloadLabel(selectedOperation)} خالی است. فیلدهای لازم را پر کنید و دوباره Send بزنید.`,
      );
      setInspectorTab('request');
      return;
    }
    const confirmed = selectedOperation.type !== 'CORE_COMMAND' || window.confirm(`اجرای Command ${selectedOperation.sourceId} روی ${selectedProfile.name} را تأیید می‌کنید؟`);
    if (!confirmed) return;
    const businessJustification = selectedOperation.type === 'CORE_COMMAND' && selectedProfile.kind === 'PRODUCTION'
      ? window.prompt('دلیل کسب‌وکاری اجرای Production Command را وارد کنید:') || ''
      : '';
    if (selectedOperation.type === 'CORE_COMMAND' && selectedProfile.kind === 'PRODUCTION' && !businessJustification.trim()) return;
    setExecuting(true);
    try {
      const execution = await apiConsoleApi.executeRuntimeOperation(selectedOperation, {
        projectKey,
        runtimeProfileId: selectedProfile.id,
        input: parsed.value,
        confirmed: selectedOperation.type === 'CORE_COMMAND',
        businessJustification,
      }, context);
      setExecutionsByOp(current => ({ ...current, [selectedOperation.id]: execution }));
      if (selectedOperation.schemaCompleteness === 'NEEDS_INPUT' && Object.keys(parsed.value).length > 0) {
        setLocallyReadyOps(current => ({ ...current, [selectedOperation.id]: true }));
      }
      setDsBlockedHint(false);
      setInspectorTab('response');
      toast.success(`HTTP ${execution.statusCode || 200}`);
      await refreshSession(selectedProfile.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'اجرای Runtime ناموفق بود.';
      toast.error(message);
      if (isDataServiceBlockedError(message)) {
        setDsBlockedHint(true);
        setInspectorTab('request');
      }
      if (/session expired|connect again|RUNTIME_SESSION|نشست Runtime|منقضی/i.test(message)) {
        await refreshSession(selectedProfile.id).catch(() => undefined);
      }
    } finally {
      setExecuting(false);
    }
  };

  const togglePageSelection = (checked: boolean) => {
    const pageIds = pagedOperations.map(item => item.id);
    setSelectedOperationIds(current => {
      if (checked) return [...new Set([...current, ...pageIds])];
      return current.filter(id => !pageIds.includes(id));
    });
  };

  const warningGroups = useMemo(
    () => groupDiscoveryWarnings(snapshot?.warnings || []),
    [snapshot],
  );
  const pageAllSelected = pagedOperations.length > 0 && pagedOperations.every(item => selectedOperationIds.includes(item.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
          {isIsApproach ? (
            <button
              type="button"
              onClick={() => setWorkspaceMode('is')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${workspaceMode === 'is' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              کشف IS
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setWorkspaceMode('cde')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${workspaceMode === 'cde' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              کشف CDE
            </button>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceMode('free')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${workspaceMode === 'free' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            درخواست آزاد
          </button>
        </div>
        <p className="text-xs text-gray-500">
          {workspaceMode === 'is'
            ? 'کشف API از specs/*.service.json (محصول → controller/action) و همگام‌سازی به Collection'
            : workspaceMode === 'cde'
              ? 'اسکن و اجرای عملیات سامانه‌ای از CDE'
              : 'مثل Postman — URL آزاد، سامانه اختیاری'}
        </p>
      </div>

      {workspaceMode === 'is' ? (
        <Card padding="sm" className="overflow-hidden">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            {isWorkspaces.length > 1 ? (
              <div className="min-w-[160px]">
                <Select
                  label="Workspace"
                  value={isWorkspaceFilter}
                  onChange={event => {
                    setIsWorkspaceFilter(event.target.value);
                    setIsCategoryFilter('all');
                  }}
                  options={[
                    { value: 'all', label: 'همه' },
                    ...isWorkspaces.map(workspace => ({
                      value: String(workspace.workspaceIndex),
                      label: workspace.title,
                    })),
                  ]}
                />
              </div>
            ) : null}
            <div className="min-w-[160px]">
              <Select
                label="دسته‌بندی"
                value={isCategoryFilter}
                onChange={event => setIsCategoryFilter(event.target.value)}
                options={[
                  { value: 'all', label: 'همه' },
                  ...isCategoryOptions.map(([slug, title]) => ({ value: slug, label: title })),
                ]}
              />
            </div>
            <div className="min-w-[220px] flex-1">
              <SearchableSelect
                label="محصول Spec"
                value={isSelectedServiceKey}
                onValueChange={setIsSelectedServiceKey}
                options={filteredIsSystems.map(system => ({
                  value: system.serviceKey,
                  label: (system.categoryTitle || system.category)
                    ? `${system.label} · ${system.categoryTitle || system.category}`
                    : system.label,
                  description: `${system.basePath}${system.actionCount != null ? ` · ${system.actionCount} action` : ''}`,
                  keywords: `${system.serviceKey} ${system.specFolder || ''} ${system.label} ${system.category || ''} ${system.workspaceSlug || ''}`,
                }))}
                placeholder={isSystemsLoading ? 'در حال بارگذاری…' : 'انتخاب محصول'}
                disabled={isSystemsLoading}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <Input
                label="جستجوی عملیات"
                value={isSearch}
                onChange={event => setIsSearch(event.target.value)}
                placeholder="method / path / controller…"
              />
            </div>
            <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void loadIsSystems()} loading={isSystemsLoading}>
              محصولات
            </Button>
            <Button size="sm" variant="secondary" icon={<Search className="h-4 w-4" />} onClick={() => void loadIsApis()} loading={isOpsLoading} disabled={!isSelectedServiceKey}>
              کشف از Spec
            </Button>
            <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={() => void syncIsApis()} loading={isSyncing} disabled={!isSelectedServiceKey || !isSelectedOpIds.length}>
              همگام‌سازی به Requestها
            </Button>
          </div>

          {isCounts ? (
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-gray-600">
              <Badge variant="secondary" size="sm">کل: {isCounts.total}</Badge>
              <Badge variant="success" size="sm">Spec: {isCounts.specs ?? 0}</Badge>
              <Badge variant="info" size="sm">Gateway: {isCounts.gateway}</Badge>
              <Badge variant="default" size="sm">OpenAPI: {isCounts.openapi}</Badge>
              <Badge variant="default" size="sm">انتخاب‌شده: {isSelectedOpIds.length}</Badge>
            </div>
          ) : null}

          {isWarnings.length > 0 ? (
            <div className="mb-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {isWarnings.map(warning => (
                <div key={`${warning.code}-${warning.message}`}>
                  <span className="font-mono">{warning.code}</span>: {warning.message}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500">
            <button
              type="button"
              className="text-[var(--theme-accent)] hover:underline"
              onClick={() => setIsSelectedOpIds(filteredIsOperations.map(item => item.id))}
            >
              انتخاب همهٔ فیلترشده
            </button>
            <button
              type="button"
              className="hover:underline"
              onClick={() => setIsSelectedOpIds([])}
            >
              حذف انتخاب
            </button>
          </div>

          <div className="max-h-[420px] divide-y divide-gray-100 overflow-auto rounded-xl border border-gray-200">
            {isOpsLoading && <div className="p-6 text-center text-sm text-gray-500">در حال خواندن *.service.json…</div>}
            {!isOpsLoading && filteredIsOperations.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500">
                برای این محصول عملیاتی در Spec پیدا نشد. مسیر API_CONSOLE_IS_SPECS_ROOT و فایل *.service.json را بررسی کنید.
              </div>
            )}
            {filteredIsOperations.map(operation => {
              const checked = isSelectedOpIds.includes(operation.id);
              return (
                <label key={operation.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => {
                      setIsSelectedOpIds(current =>
                        checked ? current.filter(id => id !== operation.id) : [...current, operation.id]
                      );
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info" size="sm">{operation.method}</Badge>
                      <span className="font-mono text-xs text-gray-800" dir="ltr">{operation.path}</span>
                      {operation.sourceKind ? <span className="text-[10px] text-gray-400">{operation.sourceKind}</span> : null}
                    </div>
                    <div className="mt-0.5 text-sm text-gray-700">{operation.name}</div>
                    {operation.folderPath?.length ? (
                      <div className="text-[11px] text-gray-400">{operation.folderPath.join(' / ')}</div>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </Card>
      ) : null}

      {workspaceMode === 'free' ? (
        <Card padding="sm" className="overflow-hidden">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <ApplicationSelect
                label="سامانه (اختیاری)"
                value={freeSystemId}
                onChange={setFreeSystemId}
                includeEmptyOption
                emptyOptionLabel="همه درخواست‌های آزاد"
                includePersonalOption
                personalOptionLabel={PERSONAL_APPLICATION_LABEL}
                hint="با انتخاب سامانه، درخواست‌های همان سامانه لود می‌شود. خالی = همه‌ی آزادها."
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <Input
                label="جستجو"
                value={freeSearch}
                onChange={event => setFreeSearch(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') void loadFreeRequests(); }}
                placeholder="نام یا URL…"
              />
            </div>
            <Button size="sm" variant="secondary" icon={<Search className="h-4 w-4" />} onClick={() => void loadFreeRequests()} loading={freeLoading}>
              فیلتر
            </Button>
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => void handleCreateFree()}
              loading={freeCreating}
              disabled={!canCreateFreeRequest || !onCreateFreeRequest}
            >
              درخواست جدید
            </Button>
          </div>

          <div className="mb-3 rounded-lg border border-dashed border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            اینجا محدود به CDE نیستید — مثلاً API نقشه یا هر HTTP عمومی. برای اشتراک‌گذاری از ویرایشگر Request استفاده کنید.
          </div>

          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {freeLoading && <div className="p-6 text-center text-sm text-gray-500">در حال بارگذاری…</div>}
            {!freeLoading && freeRequests.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">
                هنوز درخواست آزادی نیست.
                <div className="mt-3">
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => void handleCreateFree()} disabled={!canCreateFreeRequest || !onCreateFreeRequest}>
                    ساخت اولین درخواست
                  </Button>
                </div>
              </div>
            )}
            {!freeLoading && freeRequests.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => { void onOpenRequest?.(item.id); }}
                className="flex w-full items-start justify-between gap-3 px-3 py-3 text-right transition hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{item.name}</span>
                    <Badge variant="default" size="sm">{item.method}</Badge>
                    {item.applicationId === PERSONAL_APPLICATION_ID
                      ? <Badge variant="success" size="sm">آزاد</Badge>
                      : <Badge variant="info" size="sm">{getApplicationName(item.applicationId)}</Badge>}
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-gray-500" dir="ltr">{item.urlTemplate}</p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{new Date(item.updatedAt).toLocaleString('fa-IR')}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : workspaceMode === 'cde' ? (
        <>
          <Card padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {projects.length > 0 && onSelectProject ? (
                  <div className="min-w-[200px] max-w-sm flex-1">
                    <SearchableSelect
                      label="سامانه"
                      value={projectKey}
                      onValueChange={(next) => { void onSelectProject(next); }}
                      options={projects.map(project => ({
                        value: project.projectKey,
                        label: project.projectKey,
                        keywords: project.projectKey,
                      }))}
                      placeholder="جستجو و انتخاب سامانه"
                      searchPlaceholder="نام سامانه…"
                      size="sm"
                      className="[&_label]:sr-only"
                    />
                  </div>
                ) : null}
                <select
                  value={selectedProfile?.id || ''}
                  onChange={event => setSelectedProfileId(event.target.value)}
                  className="min-w-[200px] max-w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-label="Runtime Profile"
                >
                  {profilesByKind.length === 0 && <option value="">پروفایلی نیست</option>}
                  {profilesByKind.map(group => (
                    <optgroup key={group.kind} label={RUNTIME_KIND_LABELS[group.kind]}>
                      {group.rows.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} — {profile.origin}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Badge variant={session?.connected ? 'success' : session?.phase === 'PASSWORD_REQUIRED' ? 'warning' : 'default'}>
                  {session?.connected ? 'Connected' : session?.phase === 'PASSWORD_REQUIRED' ? 'Password' : 'Disconnected'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {session?.connected
                  ? <Button size="sm" variant="secondary" onClick={disconnect}>قطع</Button>
                  : <Button size="sm" icon={<Link2 className="h-4 w-4" />} onClick={connect} loading={connecting} disabled={!selectedProfile}>Login</Button>}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Settings2 className="h-4 w-4" />}
                  onClick={() => setSettingsOpen(open => !open)}
                >
                  تنظیمات
                  <ChevronDown className={`ms-1 h-3.5 w-3.5 transition ${settingsOpen ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </div>

            {settingsOpen && (
              <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                <div className="flex flex-wrap gap-1.5">
                  {isSystemAdmin && selectedProfile && <Button size="sm" variant="secondary" icon={<ShieldCheck className="h-4 w-4" />} onClick={validateProfile}>Validate</Button>}
                  {isSystemAdmin && selectedProfile && <Button size="sm" variant="secondary" onClick={() => openEditProfile(selectedProfile)}>Edit</Button>}
                  {isSystemAdmin && selectedProfile && (
                    <Button size="sm" variant="secondary" onClick={() => openEditProfile(selectedProfile, { focusDataService: true })}>
                      Data Service
                    </Button>
                  )}
                  {isSystemAdmin && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNewProfile}>Origin</Button>}
                </div>
                {canPromote && selectedProfile && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
                    <div className="min-w-[160px]">
                      <Select
                        label="ارتقا به"
                        value={promoteTargetKind}
                        onChange={event => setPromoteTargetKind(event.target.value as RuntimeEnvironmentKind)}
                        options={promoteKindOptions}
                      />
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => { void promoteProfile(); }} loading={promoting} disabled={!promoteTargetKind || promoteTargetKind === selectedProfile.kind}>
                      Promote
                    </Button>
                  </div>
                )}
                {selectedProfile && (
                  <div className="grid gap-1.5 text-[11px] text-gray-600 md:grid-cols-4" dir="ltr">
                    <div className="rounded bg-gray-50 px-2 py-1"><b>Origin</b><div className="truncate font-mono">{selectedProfile.origin}</div></div>
                    <div className="rounded bg-gray-50 px-2 py-1"><b>runtimeServiceId</b><div className="truncate font-mono">{selectedProfile.runtimeServiceId}</div></div>
                    <div className="rounded bg-gray-50 px-2 py-1"><b>projectServiceId</b><div className="truncate font-mono">{selectedProfile.projectServiceId || 'unapproved'}</div></div>
                    <div className="rounded bg-gray-50 px-2 py-1"><b>prostage</b><div className="font-mono">{selectedProfile.prostage || '—'}</div></div>
                  </div>
                )}
                {!selectedProfile?.projectServiceId && selectedProfile && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    Project Service ID تأیید نشده — Scan و Approve لازم است.
                  </div>
                )}
                {isSystemAdmin && (
                  <div className="rounded-lg border border-gray-100 bg-white p-2 text-xs text-gray-600">
                    <div className="mb-1 font-medium text-gray-800">Originهای provision‌شده</div>
                    {provisionedOrigins.length === 0
                      ? <div className="text-gray-500">هنوز Originی ثبت نشده است.</div>
                      : (
                        <div className="flex flex-wrap gap-1.5" dir="ltr">
                          {provisionedOrigins.map(origin => (
                            <Badge key={origin} variant="default" size="sm">{origin}</Badge>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={scan} loading={scanning}>Scan CDE</Button>
                {snapshot && (
                  <>
                    <Badge variant="info" size="sm">{snapshot.operations.length} ops</Badge>
                    <Badge variant="success" size="sm">{driftStats.new} NEW</Badge>
                    <Badge variant="warning" size="sm">{driftStats.changed} CHANGED</Badge>
                    <Badge variant="danger" size="sm">{driftStats.removed} REMOVED</Badge>
                    {(driftStats.needsInput > 0) && <Badge variant="warning" size="sm">{driftStats.needsInput} needs input</Badge>}
                  </>
                )}
                <button type="button" className="text-xs text-gray-500 hover:text-gray-800" onClick={() => setDiscoveryOpen(open => !open)}>
                  {discoveryOpen ? 'بستن جزئیات کشف' : 'جزئیات کشف'}
                </button>
              </div>
              {snapshot && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[160px]">
                    <Select
                      aria-label="Collection"
                      value={collectionId}
                      onChange={event => setCollectionId(event.target.value)}
                      options={collections.filter(item => item.applicationId === projectKey).map(item => ({ value: item.id, label: item.name }))}
                    />
                  </div>
                  <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={sync} loading={syncing} disabled={!collectionId || !selectedProfile || !selectedOperationIds.length}>
                    Sync ({selectedOperationIds.length})
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportPostman} disabled={!selectedProfile}>Postman</Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ExternalLink className="h-4 w-4" />}
                    onClick={() => selectedProfile && window.open(apiConsoleApi.runtimeDocsUrl(projectKey, selectedProfile.id), '_blank', 'noopener,noreferrer')}
                    disabled={!selectedProfile}
                  >
                    Swagger
                  </Button>
                </div>
              )}
            </div>
            {discoveryOpen && (
              snapshot ? (
                <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <Badge variant={snapshot.serviceIdStatus === 'RESOLVED' ? 'success' : 'danger'}>serviceId: {snapshot.serviceIdStatus}</Badge>
                    <span>{new Date(snapshot.createdAt).toLocaleString('fa-IR')}</span>
                  </div>
                  {candidates.map(candidate => (
                    <div key={candidate.value} className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono font-semibold" dir="ltr">{candidate.value}</div>
                        {selectedProfile?.projectServiceId === candidate.value
                          ? <Badge variant="success">approved</Badge>
                          : isSystemAdmin && selectedProfile
                            ? <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} loading={approvingServiceId === candidate.value} onClick={() => void approveProjectServiceId(candidate)}>Approve</Button>
                            : <Badge variant="warning">pending admin</Badge>}
                      </div>
                      {candidate.evidence.map((evidence, index) => (
                        <div key={index} className="mt-1 text-xs text-gray-600" dir="ltr">
                          {evidence.repositoryType}/{evidence.packageId}: {evidence.file}:{evidence.line}
                        </div>
                      ))}
                    </div>
                  ))}
                  {warningGroups.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-amber-900"
                        onClick={() => setWarningsOpen(open => !open)}
                      >
                        <span>
                          Scan warnings · {snapshot.warnings.length}
                          <span className="mr-2 text-xs font-normal text-amber-700"> — اطلاعاتی؛ مانع Login/Send نیستند</span>
                        </span>
                        <span className="text-xs text-amber-700">{warningsOpen ? 'hide' : 'show'}</span>
                      </button>
                      {warningsOpen && (
                        <div className="space-y-2 border-t border-amber-200 px-3 py-2">
                          {warningGroups.map(group => (
                            <details key={group.code} className="rounded border border-amber-200 bg-white/70 p-2">
                              <summary className="cursor-pointer text-xs font-medium text-amber-900">
                                <span className="font-mono" dir="ltr">{group.code}</span>
                                <span className="mx-1 text-amber-700">×{group.rows.length}</span>
                                <span className="font-normal text-amber-800">— {group.label}</span>
                              </summary>
                              <div className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-amber-900" dir="ltr">
                                {group.rows.slice(0, 40).map((warning, index) => (
                                  <div key={`${group.code}-${index}`} className="font-mono">
                                    {warning.message}
                                  </div>
                                ))}
                                {group.rows.length > 40 && (
                                  <div className="text-amber-700">… and {group.rows.length - 40} more</div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : <p className="mt-3 text-sm text-gray-500">هنوز snapshot ساخته نشده است. Scan CDE را بزنید.</p>
            )}
          </Card>

          {snapshot && (
            <Card padding="sm" className="overflow-hidden">
              <div className="grid h-[calc(100vh-12rem)] min-h-[520px] grid-cols-1 overflow-hidden rounded-xl border border-gray-200 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]" dir="ltr">
                <aside className="flex min-h-0 flex-col border-b border-gray-200 bg-gray-50 lg:border-b-0 lg:border-r lg:border-gray-200">
                  <div className="space-y-2 border-b border-gray-200 bg-white p-3">
                    <div className="relative" dir="ltr">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        value={operationSearch}
                        onChange={event => setOperationSearch(event.target.value)}
                        placeholder="Search path / ds/ / fr/ / file"
                        className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 font-mono text-sm text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {([
                        ['ALL', 'All'],
                        ['CORE_QUERY', 'ds'],
                        ['CORE_COMMAND', 'fr'],
                        ['REST', 'REST'],
                      ] as Array<[OperationTypeFilter, string]>).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setTypeFilter(value)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium ${typeFilter === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                        >
                          {label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setNeedsInputOnly(value => !value)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${needsInputOnly ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                      >
                        needs input
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={pageAllSelected} onChange={event => togglePageSelection(event.target.checked)} />
                        صفحه جاری
                      </label>
                      <span dir="ltr">{filteredOperations.length} matched</span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto">
                    {pagedOperations.map(operation => {
                      const active = operation.id === selectedOperationId;
                      const hasResponse = Boolean(executionsByOp[operation.id]);
                      return (
                        <button
                          key={operation.id}
                          type="button"
                          onClick={() => selectOperation(operation)}
                          className={`flex w-full items-start gap-2 border-b border-gray-100 px-3 py-2.5 text-left transition ${active ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedOperationIds.includes(operation.id)}
                            onClick={event => event.stopPropagation()}
                            onChange={event => setSelectedOperationIds(current => event.target.checked
                              ? [...new Set([...current, operation.id])]
                              : current.filter(id => id !== operation.id))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {operationBadge(operation)}
                              {previewStateBadge(operation.previewState)}
                              {hasResponse && <Badge variant="success" size="sm">resp</Badge>}
                              <Badge
                                variant={
                                  operation.schemaCompleteness === 'COMPLETE' || locallyReadyOps[operation.id]
                                    ? 'success'
                                    : 'warning'
                                }
                                size="sm"
                              >
                                {operation.schemaCompleteness === 'COMPLETE' || locallyReadyOps[operation.id] ? 'ok' : 'input'}
                              </Badge>
                            </div>
                            <div className="mt-1 truncate font-mono text-xs text-gray-900" dir="ltr" title={operation.sourceId}>
                              {operation.sourceId}
                            </div>
                            <div className="truncate text-[11px] text-gray-500" dir="ltr">
                              {operation.evidence[0]?.file || operation.path || operation.sourceKind}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {pagedOperations.length === 0 && (
                      <div className="p-6 text-center text-sm text-gray-500">نتیجه‌ای برای این جستجو نیست.</div>
                    )}
                    {snapshot.removedOperations.map(operation => (
                      <div key={`removed-${operation.id}`} className="border-b border-red-100 bg-red-50 px-3 py-2 opacity-80">
                        <div className="font-mono text-xs line-through" dir="ltr">{operation.sourceId}</div>
                        <Badge variant="danger" size="sm">REMOVED</Badge>
                      </div>
                    ))}
                  </div>

                  <Pagination
                    page={Math.min(page, totalPages)}
                    totalPages={totalPages}
                    total={filteredOperations.length}
                    limit={pageSize}
                    onPageChange={setPage}
                    onLimitChange={(limit) => {
                      setPageSize(limit);
                      setPage(1);
                    }}
                  />
                </aside>

                <section className="flex min-h-0 flex-col bg-white">
                  {selectedOperation && selectedProfile ? (
                    <>
                      <div className="border-b border-gray-200 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {operationBadge(selectedOperation)}
                              {previewStateBadge(selectedOperation.previewState)}
                              <h3 className="truncate font-mono text-sm font-semibold text-gray-900" dir="ltr">{selectedOperation.sourceId}</h3>
                            </div>
                            <div className="mt-2 grid gap-2 text-[11px] text-gray-600 sm:grid-cols-3" dir="ltr">
                              <div className="rounded bg-gray-50 px-2 py-1"><b>serviceId</b><div className="truncate font-mono">{selectedProfile.projectServiceId || '—'}</div></div>
                              <div className="rounded bg-gray-50 px-2 py-1">
                                <b>{selectedOperation.type === 'CORE_COMMAND' ? 'formId' : selectedOperation.type === 'CORE_QUERY' ? 'key' : 'path'}</b>
                                <div className="truncate font-mono">{operationProviderId(selectedOperation)}</div>
                              </div>
                              <div className="rounded bg-gray-50 px-2 py-1"><b>endpoint</b><div className="truncate font-mono">{operationEndpoint(selectedOperation)}</div></div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportCurl(selectedOperation, 'sample')}>cURL</Button>
                            {selectedOperation.sourceKind === 'API_MODULE' && (
                              <Button size="sm" variant="secondary" onClick={() => exportCurl(selectedOperation, 'bundle')}>Login bundle</Button>
                            )}
                            <Button size="sm" icon={<PlayCircle className="h-4 w-4" />} onClick={() => void executeSelected()} loading={executing} disabled={!session?.connected}>
                              Send
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-1">
                          {([
                            ['request', 'Request'],
                            ['response', `Response${selectedExecution ? ` · ${selectedExecution.statusCode || 200}` : ''}`],
                          ] as Array<[InspectorTab, string]>).map(([tab, label]) => (
                            <button
                              key={tab}
                              type="button"
                              onClick={() => setInspectorTab(tab)}
                              className={`rounded-md px-3 py-1.5 text-sm font-medium ${inspectorTab === tab ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex-1 overflow-auto p-3">
                        {inspectorTab === 'request' ? (
                          <div className="space-y-3">
                            {dsBlockedHint && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                                <div className="mb-2 font-medium">Data Service برای اجرا آماده نیست</div>
                                <ul className="mb-3 list-disc space-y-1 pr-5 text-xs">
                                  {dataServiceChecklist(selectedProfile).map(item => (
                                    <li key={item.label} className={item.ok ? 'text-green-700' : 'text-amber-900'}>
                                      {item.ok ? '✓' : '✗'} {item.label}
                                    </li>
                                  ))}
                                </ul>
                                <Button size="sm" onClick={openDataServiceSettings}>
                                  باز کردن تنظیمات Data Service
                                </Button>
                              </div>
                            )}
                            <Textarea
                              label={operationPayloadLabel(selectedOperation)}
                              value={selectedDraft}
                              onChange={event => {
                                const value = event.target.value;
                                setDraftInputs(current => ({ ...current, [selectedOperation.id]: value }));
                                setExecuteInputError('');
                              }}
                              error={executeInputError || undefined}
                              className="min-h-[220px] text-left font-mono"
                              dir="ltr"
                              hint={
                                selectedOperation.schemaCompleteness === 'NEEDS_INPUT' && !locallyReadyOps[selectedOperation.id]
                                  ? `${operationPayloadLabel(selectedOperation)} برای NEEDS_INPUT الزامی است — خالی ({}) مسدود می‌شود`
                                  : selectedOperation.type === 'CORE_COMMAND'
                                    ? 'ارسال به‌عنوان data در store-form-data'
                                    : selectedOperation.type === 'CORE_QUERY'
                                      ? 'ارسال به‌عنوان params در get-data-source — مثلاً limit / offset / viewerRole'
                                      : 'بدنه REST'
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setDraftInputs(current => ({
                                  ...current,
                                  [selectedOperation.id]: prettyJson(selectedOperation.payloadExample || {}),
                                }))}
                              >
                                Reset example
                              </Button>
                              <Button size="sm" icon={<PlayCircle className="h-4 w-4" />} onClick={() => void executeSelected()} loading={executing} disabled={!session?.connected}>
                                Send
                              </Button>
                            </div>
                            {selectedOperation.schema && (
                              <details className="rounded-lg border border-gray-200 p-3">
                                <summary className="cursor-pointer text-sm font-medium text-gray-700">Schema</summary>
                                <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-left text-xs font-mono" dir="ltr">{prettyJson(selectedOperation.schema)}</pre>
                              </details>
                            )}
                          </div>
                        ) : selectedExecution ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={(selectedExecution.statusCode || 200) < 400 ? 'success' : 'danger'}>
                                HTTP {selectedExecution.statusCode || 200}
                              </Badge>
                              <Badge variant="default">{selectedExecution.response?.responseSize || 0} B</Badge>
                              <Badge variant="info">{selectedExecution.response?.durationMs || 0} ms</Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Copy className="h-4 w-4" />}
                                onClick={() => {
                                  void navigator.clipboard?.writeText(selectedResponseBody);
                                  toast.success('JSON کپی شد.');
                                }}
                              >
                                Copy
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<Download className="h-4 w-4" />}
                                onClick={() => downloadText(`${selectedOperation.sourceId.replace(/\//g, '_')}-response.json`, selectedResponseBody, 'application/json;charset=utf-8')}
                              >
                                Download
                              </Button>
                            </div>
                            <RuntimeJsonViewer value={selectedResponseBody || '-'} />
                          </div>
                        ) : (
                          <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
                            هنوز پاسخی برای این عملیات نیست. از تب Request مقدار را بفرستید.
                            <Button className="mt-3" size="sm" icon={<PlayCircle className="h-4 w-4" />} onClick={() => setInspectorTab('request')}>
                              رفتن به Request
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">
                      یک عملیات را از لیست انتخاب کنید.
                    </div>
                  )}
                </section>
              </div>
            </Card>
          )}
        </>
      ) : null}

      {loading && workspaceMode === 'cde' && <div className="text-sm text-gray-500">در حال بارگذاری Runtime…</div>}

      <Modal isOpen={passwordModal} onClose={() => { setPassword(''); setPasswordModal(false); }} title="ورود Runtime" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            شماره حساب CDE: <span className="font-mono" dir="ltr">{context.user?.phoneNumber || '—'}</span>
          </div>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="رمز Runtime"
            onKeyDown={event => { if (event.key === 'Enter') void submitPassword(); }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setPassword(''); setPasswordModal(false); }}>لغو</Button>
            <Button onClick={submitPassword} loading={connecting} disabled={!password}>تأیید</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={profileModal} onClose={() => { setProfileModal(false); setFocusDataService(false); }} title={profileForm.id ? 'ویرایش Runtime Origin' : 'افزودن Runtime Origin'} size="wide">
        <div className="space-y-4">
          {!profileForm.id && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
              فقط Origin را وارد کنید. Core path، login و prostage=develop پیش‌فرض هستند.
            </div>
          )}
          <Input
            label="Origin HTTPS"
            dir="ltr"
            value={profileForm.origin}
            onChange={event => {
              const origin = event.target.value;
              setProfileForm(value => ({ ...value, origin, name: value.id ? value.name : defaultProfileName(projectKey, origin) }));
            }}
            placeholder="https://soha.m.edus.ir"
          />
          <details className="rounded-lg border border-gray-200 p-3" open={Boolean(profileForm.id) && !focusDataService}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Advanced</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Input label="نام Profile" value={profileForm.name} onChange={event => setProfileForm(value => ({ ...value, name: event.target.value }))} />
              <Select
                label="نوع محیط"
                value={isSystemAdmin ? profileForm.kind : 'DEVELOPMENT'}
                onChange={event => setProfileForm(value => ({ ...value, kind: event.target.value as RuntimeEnvironmentKind }))}
                options={kindSelectOptions}
                disabled={!isSystemAdmin}
              />
              {!isSystemAdmin && (
                <p className="md:col-span-2 text-xs text-amber-700">برای نقش غیر ادمین فقط محیط DEVELOPMENT مجاز است.</p>
              )}
              <Input label="App referer path" dir="ltr" value={profileForm.appRefererPath} onChange={event => setProfileForm(value => ({ ...value, appRefererPath: event.target.value }))} placeholder="/community" />
              <Input label="Core base path" dir="ltr" value={profileForm.coreBasePath} onChange={event => setProfileForm(value => ({ ...value, coreBasePath: event.target.value }))} />
              <Input label="Login path" dir="ltr" value={profileForm.loginPath} onChange={event => setProfileForm(value => ({ ...value, loginPath: event.target.value }))} />
              <Select label="Project Service ID" value={profileForm.projectServiceId} onChange={event => setProfileForm(value => ({ ...value, projectServiceId: event.target.value }))} options={[{ value: '', label: 'تأیید نشده' }, ...candidates.map(item => ({ value: item.value, label: item.value }))]} />
              <Input label="prostage" dir="ltr" value={profileForm.prostage} onChange={event => setProfileForm(value => ({ ...value, prostage: event.target.value }))} />
            </div>
          </details>

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">راه‌اندازی Data Service</h3>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4].map(step => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => setDsWizardStep(step)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${dsWizardStep === step ? 'bg-blue-700 text-white' : 'bg-white text-blue-800 border border-blue-200'}`}
                  >
                    گام {step}
                  </button>
                ))}
              </div>
            </div>
            {dsWizardStep === 1 && (
              <div className="space-y-3">
                <Input
                  label="۱. Base URL HTTPS"
                  dir="ltr"
                  value={profileForm.dataServiceBaseUrl}
                  onChange={event => setProfileForm(value => ({ ...value, dataServiceBaseUrl: event.target.value }))}
                  placeholder="https://data-service.example.ir"
                  hint="فقط HTTPS — پایهٔ مسیرهای REST کشف‌شده"
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setDsWizardStep(2)} disabled={!/^https:\/\//i.test(profileForm.dataServiceBaseUrl.trim())}>
                    بعدی
                  </Button>
                </div>
              </div>
            )}
            {dsWizardStep === 2 && (
              <div className="space-y-3">
                <Select
                  label="۲. حالت احراز هویت"
                  value={profileForm.dataServiceAuthMode}
                  onChange={event => {
                    const authMode = event.target.value as RuntimeProfile['dataService']['authMode'];
                    setProfileForm(value => ({
                      ...value,
                      dataServiceAuthMode: authMode,
                      dataServiceTokenPath: authMode === 'TOKEN_ENDPOINT'
                        ? (value.dataServiceTokenPath || '/auth/getToken')
                        : value.dataServiceTokenPath,
                    }));
                  }}
                  options={[
                    { value: 'NONE', label: 'NONE — بدون احراز هویت' },
                    { value: 'BEARER', label: 'BEARER — توکن ثابت' },
                    { value: 'BASIC', label: 'BASIC — نام‌کاربری / رمز' },
                    { value: 'TOKEN_ENDPOINT', label: 'TOKEN_ENDPOINT — دریافت توکن' },
                  ]}
                />
                {profileForm.dataServiceAuthMode === 'TOKEN_ENDPOINT' && (
                  <Input
                    label="Token path (پیش‌فرض)"
                    dir="ltr"
                    value={profileForm.dataServiceTokenPath}
                    onChange={event => setProfileForm(value => ({ ...value, dataServiceTokenPath: event.target.value }))}
                    placeholder="/auth/getToken"
                  />
                )}
                <div className="flex justify-between gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDsWizardStep(1)}>قبلی</Button>
                  <Button size="sm" onClick={() => setDsWizardStep(3)}>بعدی</Button>
                </div>
              </div>
            )}
            {dsWizardStep === 3 && (
              <div className="space-y-3">
                {profileForm.dataServiceAuthMode === 'BASIC' && (
                  <Input label="Username" value={profileForm.dataServiceUsername} onChange={event => setProfileForm(value => ({ ...value, dataServiceUsername: event.target.value }))} />
                )}
                {profileForm.dataServiceAuthMode === 'TOKEN_ENDPOINT' && (
                  <Input label="Username" value={profileForm.dataServiceUsername} onChange={event => setProfileForm(value => ({ ...value, dataServiceUsername: event.target.value }))} />
                )}
                {profileForm.dataServiceAuthMode === 'NONE' ? (
                  <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                    برای حالت NONE نیازی به secret نیست.
                  </div>
                ) : (
                  <Input
                    label="۳. Auth secret"
                    type="password"
                    autoComplete="new-password"
                    value={profileForm.dataServiceAuthSecret}
                    onChange={event => setProfileForm(value => ({ ...value, dataServiceAuthSecret: event.target.value }))}
                    placeholder={profileForm.id ? 'خالی = حفظ قبلی' : 'مقدار محرمانه'}
                  />
                )}
                <div className="flex justify-between gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setDsWizardStep(2)}>قبلی</Button>
                  <Button size="sm" onClick={() => setDsWizardStep(4)}>بعدی</Button>
                </div>
              </div>
            )}
            {dsWizardStep === 4 && (
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-800">۴. چک‌لیست آمادگی</div>
                <ul className="space-y-1.5 text-sm">
                  {dataServiceChecklist(profileForm).map(item => (
                    <li key={item.label} className={item.ok ? 'text-green-700' : 'text-amber-800'}>
                      {item.ok ? '✓' : '✗'} {item.label}
                    </li>
                  ))}
                </ul>
                {profileForm.id && selectedProfile?.id === profileForm.id && (
                  <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                    وضعیت ذخیره‌شده:
                    {' '}
                    <Badge variant={selectedProfile.dataService.executionEnabled ? 'success' : 'warning'} size="sm">
                      executionEnabled={String(selectedProfile.dataService.executionEnabled)}
                    </Badge>
                  </div>
                )}
                <p className="text-xs text-gray-500">پس از ذخیره، در صورت کامل بودن تنظیمات، executionEnabled فعال می‌شود.</p>
                <div className="flex justify-start">
                  <Button size="sm" variant="secondary" onClick={() => setDsWizardStep(3)}>قبلی</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div>
            {profileForm.id && (
              <Button
                variant="danger"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={async () => {
                  if (!profileForm.id || !window.confirm('Profile غیرفعال شود؟')) return;
                  await apiConsoleApi.disableRuntimeProfile(profileForm.id, context);
                  setProfileModal(false);
                  await load();
                }}
              >
                Disable
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setProfileModal(false); setFocusDataService(false); }}>لغو</Button>
            <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={saveProfile} loading={profileSaving}>ذخیره</Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(conflictModal)}
        onClose={() => setConflictModal(null)}
        title="حل تعارض Sync"
        size="wide"
      >
        {conflictModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {conflictModal.conflicts.length} درخواست دارای تعارض است. برای هر فیلد SOURCE (نسخه CDE) یا LOCAL (ویرایش فعلی) را انتخاب کنید.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAllConflictChoices('SOURCE')}>همه SOURCE</Button>
              <Button size="sm" variant="secondary" onClick={() => setAllConflictChoices('LOCAL')}>همه LOCAL</Button>
            </div>
            <div className="max-h-[55vh] space-y-3 overflow-auto">
              {conflictModal.conflicts.map(conflict => (
                <div key={conflict.requestId} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 font-mono text-xs text-gray-800" dir="ltr">{conflict.requestId}</div>
                  <div className="space-y-3">
                    {conflict.conflicts.map(field => {
                      const choice = conflictModal.resolutions[conflict.requestId]?.[field.field] || 'SOURCE';
                      return (
                        <div key={`${conflict.requestId}-${field.field}`} className="rounded border border-gray-100 bg-gray-50 p-2 text-sm">
                          <div className="mb-2 font-medium text-gray-800" dir="ltr">{field.field}</div>
                          <div className="mb-2 grid gap-2 text-[11px] text-gray-600 md:grid-cols-2" dir="ltr">
                            <div className="rounded bg-white px-2 py-1"><b>incoming</b><pre className="mt-1 whitespace-pre-wrap break-all font-mono">{formatConflictValue(field.incoming)}</pre></div>
                            <div className="rounded bg-white px-2 py-1"><b>local</b><pre className="mt-1 whitespace-pre-wrap break-all font-mono">{formatConflictValue(field.local)}</pre></div>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`conflict-${conflict.requestId}-${field.field}`}
                                checked={choice === 'SOURCE'}
                                onChange={() => setConflictModal(current => {
                                  if (!current) return current;
                                  return {
                                    ...current,
                                    resolutions: {
                                      ...current.resolutions,
                                      [conflict.requestId]: {
                                        ...current.resolutions[conflict.requestId],
                                        [field.field]: 'SOURCE',
                                      },
                                    },
                                  };
                                })}
                              />
                              SOURCE
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`conflict-${conflict.requestId}-${field.field}`}
                                checked={choice === 'LOCAL'}
                                onChange={() => setConflictModal(current => {
                                  if (!current) return current;
                                  return {
                                    ...current,
                                    resolutions: {
                                      ...current.resolutions,
                                      [conflict.requestId]: {
                                        ...current.resolutions[conflict.requestId],
                                        [field.field]: 'LOCAL',
                                      },
                                    },
                                  };
                                })}
                              />
                              LOCAL
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConflictModal(null)}>بعداً</Button>
              <Button onClick={() => void applyConflictResolutions()} loading={syncing}>Apply</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
