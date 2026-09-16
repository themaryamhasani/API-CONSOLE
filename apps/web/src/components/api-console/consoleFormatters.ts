import type { ApiClassificationType, ApiSharingStatus, ApiRequestExecution } from '../../types/apiConsole';

export const CLASSIFICATION_LABELS: Record<ApiClassificationType, string> = {
  CORE_COMMAND: 'Core Command',
  CORE_QUERY: 'Core Query',
  GENERIC_HTTP: 'Generic HTTP',
};

export function classBadgeVariant(type: ApiClassificationType) {
  if (type === 'CORE_COMMAND') return 'danger' as const;
  if (type === 'CORE_QUERY') return 'warning' as const;
  return 'info' as const;
}

export function sharingBadgeVariant(status?: ApiSharingStatus) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'PENDING_REVIEW') return 'warning' as const;
  if (status === 'RETURNED' || status === 'DEPRECATED') return 'danger' as const;
  return 'default' as const;
}

export function resultBadgeVariant(result?: string) {
  if (result === 'SUCCESS') return 'success' as const;
  if (result === 'FAILED' || result === 'ERROR') return 'danger' as const;
  if (result === 'TIMEOUT') return 'warning' as const;
  return 'default' as const;
}

export function formatDate(value?: string) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('fa-IR');
  } catch {
    return value;
  }
}

export function safeBodyPreview(execution: ApiRequestExecution | null): string {
  if (!execution) return '';
  const anyExec = execution as unknown as Record<string, unknown>;
  const raw = anyExec.responseBodyPreview ?? anyExec.bodyPreview ?? anyExec.responseBody ?? '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
}

export function isJsonResponsePreview(execution: ApiRequestExecution | null): boolean {
  const headers = (execution as { responseHeaders?: Array<{ name: string; value: string }> } | null)?.responseHeaders;
  if (!headers) return false;
  const ct = headers.find(h => String(h.name || '').toLowerCase() === 'content-type')?.value || '';
  return /json/i.test(String(ct));
}
