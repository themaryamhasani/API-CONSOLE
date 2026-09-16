import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ApiRequestExecution } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LoadingState } from '../ui/Loading';
import { resultBadgeVariant, safeBodyPreview, isJsonResponsePreview } from './consoleFormatters';

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>
);

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 ${minHeight}`} dir="ltr">{value}</pre>
);

const JsonResponseViewer = ({ value }: { value: string }) => {
  let pretty = value;
  try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* keep */ }
  return <CodeBlock value={pretty} minHeight="max-h-96 min-h-40" />;
};

const InfoTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
    <p className="text-[11px] text-gray-500">{label}</p>
    <p className="mt-0.5 break-all font-mono text-xs text-gray-900" dir="ltr">{value}</p>
  </div>
);

export const ResponsePanel = ({
  execution,
  loading,
  canDisableTls,
  onDisableTlsAndRetry,
}: {
  execution: ApiRequestExecution | null;
  loading: boolean;
  canDisableTls: boolean;
  onDisableTlsAndRetry: () => void;
}) => {
  const body = safeBodyPreview(execution);
  const isJsonBody = isJsonResponsePreview(execution);
  const canRetryInsecure = execution?.errorCategory === 'TLS_ERROR' && execution.requestSnapshot.tls.verifyCertificate && canDisableTls;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">نمایش Response</h3>
        {loading ? (
          <Badge variant="info">Loading</Badge>
        ) : execution ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant={resultBadgeVariant(execution.transportResult)}>{execution.transportResult}</Badge>
            <Badge variant={resultBadgeVariant(execution.businessResult)}>Business: {execution.businessResult}</Badge>
          </div>
        ) : <Badge>Execution ندارد</Badge>}
      </div>
      {loading ? (
        <LoadingState label="در حال بارگذاری response و metadata..." className="py-10" />
      ) : !execution ? (
        <p className="text-sm text-gray-500">برای مشاهده response metadata و body، Request را Execute کنید.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <InfoTile label="HTTP" value={execution.statusCode ? String(execution.statusCode) : '-'} />
            <InfoTile label="Duration" value={`${execution.durationMs || 0}ms`} />
            <InfoTile label="Size" value={`${execution.responseSize || 0} bytes`} />
            <InfoTile label="Runner" value={execution.runnerId} />
            <InfoTile label="Resolved IP" value={execution.response?.resolvedIpAddress || '-'} />
            <InfoTile label="TLS" value={execution.tlsVerification ? 'Verified' : 'Insecure'} />
            <InfoTile label="Correlation" value={execution.correlationId} />
            <InfoTile label="Evidence" value={execution.evidenceType} />
          </div>
          {execution.sanitizedError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div>{execution.errorCategory}: {execution.sanitizedError}</div>
              {canRetryInsecure && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-red-700">
                    برای این target، certificate با hostname match نیست. فقط برای محیط غیر Production می‌توانید TLS verification را آگاهانه خاموش کنید.
                  </span>
                  <Button size="sm" variant="danger" icon={<AlertTriangle className="h-4 w-4" />} onClick={onDisableTlsAndRetry}>
                    خاموش کردن Verify TLS و Retry
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <FieldLabel>Response headers</FieldLabel>
              <CodeBlock value={execution.response?.headers.map(header => `${header.name}: ${header.valueTemplate}`).join('\n') || '-'} />
            </div>
            <div>
              <FieldLabel>Assertions</FieldLabel>
              <CodeBlock value={execution.assertionResults.map(result => `${result.result}: ${result.message}`).join('\n') || 'ارزیابی نشده'} />
            </div>
          </div>
          {execution.scriptResults?.length ? (
            <div>
              <FieldLabel>Script results</FieldLabel>
              <div className="space-y-2">
                {execution.scriptResults.map((result, index) => (
                  <div key={`${result.phase}-${result.line}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm">
                    <Badge variant={result.result === 'PASSED' ? 'success' : result.result === 'FAILED' ? 'danger' : 'warning'} size="sm">
                      {result.result}
                    </Badge>
                    <span className="font-mono text-xs text-gray-500" dir="ltr">{result.phase} line {result.line}</span>
                    <span className="text-gray-700">{result.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div>
            <FieldLabel>Body ({execution.response?.safePreviewMode || 'TEXT'})</FieldLabel>
            {execution.response?.safePreviewMode === 'SANDBOXED_HTML' ? (
              <iframe title="API response sandbox" srcDoc={body} sandbox="" className="theme-light-preview h-64 w-full rounded-lg border border-gray-200 bg-white" />
            ) : isJsonBody ? (
              <JsonResponseViewer value={body} />
            ) : (
              <CodeBlock value={body} minHeight="min-h-64" />
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
