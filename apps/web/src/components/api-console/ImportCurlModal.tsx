import type { ReactNode } from 'react';
import { CheckCircle, Upload } from 'lucide-react';
import type { ApiCollection, ApiCurlImportPreview } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>
);

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 ${minHeight}`} dir="ltr">{value}</pre>
);

const InfoTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
    <p className="text-[11px] text-gray-500">{label}</p>
    <p className="mt-0.5 break-all font-mono text-xs text-gray-900" dir="ltr">{value}</p>
  </div>
);

export const ImportCurlModal = ({
  open,
  title = 'Import cURL',
  primaryActionLabel = 'Import',
  curlText,
  requestTitle = '',
  collections = [],
  selectedCollectionId = '',
  preview,
  previewSubtab,
  onSubtab,
  onText,
  onRequestTitle,
  onCollectionChange,
  onParse,
  onImport,
  onClose,
}: {
  open: boolean;
  title?: string;
  primaryActionLabel?: string;
  curlText: string;
  requestTitle?: string;
  collections?: ApiCollection[];
  selectedCollectionId?: string;
  preview: ApiCurlImportPreview | null;
  previewSubtab: 'summary' | 'original' | 'normalized' | 'warnings';
  onSubtab: (tab: 'summary' | 'original' | 'normalized' | 'warnings') => void;
  onText: (value: string) => void;
  onRequestTitle?: (value: string) => void;
  onCollectionChange?: (value: string) => void;
  onParse: () => void;
  onImport: () => void;
  onClose: () => void;
}) => (
  <Modal isOpen={open} onClose={onClose} title={title} size="wide">
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        {(onRequestTitle || onCollectionChange) && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {onRequestTitle && (
              <Input
                label="عنوان Web Service"
                value={requestTitle}
                onChange={(event) => onRequestTitle(event.target.value)}
                placeholder="مثلاً دریافت لیست کمپ‌های مدرسه"
              />
            )}
            {onCollectionChange && (
              <Select
                label="Collection"
                value={selectedCollectionId}
                onChange={(event) => onCollectionChange(event.target.value)}
                options={[
                  { value: '', label: 'یک Collection انتخاب کنید *' },
                  ...collections.map(collection => ({ value: collection.id, label: collection.name })),
                ]}
              />
            )}
          </div>
        )}
        <Textarea
          label="cURL command را وارد کنید"
          value={curlText}
          onChange={(event) => onText(event.target.value)}
          className="min-h-48 text-left font-mono sm:min-h-[420px]"
          dir="ltr"
        />
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Importer متن cURL را مستقیم tokenize می‌کند و هیچ‌وقت shell، command prompt، PowerShell، eval یا child process اجرا نمی‌کند.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button icon={<Upload className="h-4 w-4" />} onClick={onParse} disabled={!curlText.trim()}>Parse Preview</Button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['summary', 'original', 'normalized', 'warnings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onSubtab(tab)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${previewSubtab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        {!preview ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 sm:min-h-[420px]">
            برای review کردن normalized request قبل از Import، یک cURL command را Parse کنید.
          </div>
        ) : (
          <div className="space-y-3">
            {previewSubtab === 'summary' && (
              <div className="space-y-3">
                {(preview.secretScan?.findings?.length || 0) > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-semibold">هشدار Secret Scan ({preview.secretScan?.mode || 'warn'})</p>
                    <ul className="mt-2 list-disc pr-5">
                      {(preview.secretScan?.findings || []).map(finding => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs">الگوهای احتمالی Secret در cURL دیده شد؛ قبل از Import بررسی کنید.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoTile label="Dialect" value={preview.detectedDialect} />
                <InfoTile label="Method" value={preview.effectiveMethod} />
                <InfoTile label="URL" value={preview.url} />
                <InfoTile label="Headers" value={String(preview.headerCount)} />
                <InfoTile label="Cookies" value={String(preview.cookieCount)} />
                <InfoTile label="Body type" value={preview.bodyType} />
                <InfoTile label="JSON validity" value={preview.jsonValidity.valid ? 'valid' : preview.jsonValidity.error || 'invalid'} />
                <InfoTile label="TLS verify" value={preview.tlsVerification ? 'true' : 'false'} />
                <InfoTile label="Classification" value={preview.normalizedRequest.classification.type} />
                <InfoTile label="Service ID" value={preview.normalizedRequest.classification.serviceId || '-'} />
                <InfoTile label="Operation path" value={preview.normalizedRequest.classification.operationPath || '-'} />
                <InfoTile label="Parser" value={preview.parserVersion} />
                </div>
              </div>
            )}
            {previewSubtab === 'original' && <CodeBlock value={preview.originalCurl} minHeight="min-h-48 sm:min-h-[420px]" />}
            {previewSubtab === 'normalized' && <CodeBlock value={JSON.stringify(preview.normalizedRequest, null, 2)} minHeight="min-h-48 sm:min-h-[420px]" />}
            {previewSubtab === 'warnings' && (
              <div className="min-h-48 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:min-h-[420px]">
                {(preview.secretScan?.findings?.length || 0) > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                    Secret Scan: {(preview.secretScan?.findings || []).join(', ')}
                  </div>
                )}
                {preview.warnings.length || preview.unsupportedOptions.length ? (
                  [...preview.warnings, ...preview.unsupportedOptions.map(option => `Unsupported option: ${option}`)].map((warning, index) => (
                    <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
                      {warning}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">Parser warning وجود ندارد.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
              <Button variant="secondary" onClick={onClose}>انصراف</Button>
              <Button icon={<CheckCircle className="h-4 w-4" />} onClick={onImport} disabled={!!onCollectionChange && !selectedCollectionId}>{primaryActionLabel}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  </Modal>
);
