'use strict';

const fs = require('fs');
const path = require('path');

const srcPath = path.join('apps/web/src/pages/OnlineApiConsolePage.tsx');
const lines = fs.readFileSync(srcPath, 'utf8').split(/\n/);
const outDir = path.join('apps/web/src/components/api-console');

function findConstStart(name) {
  const idx = lines.findIndex(l => l.startsWith(`const ${name}`));
  if (idx < 0) throw new Error(`missing ${name}`);
  return idx;
}

/** Extract `const Name = ...` through matching closing `);` or `};` */
function extractConst(name) {
  const start = findConstStart(name);
  let i = start;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let inStr = null;
  let started = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      const prev = line[c - 1];
      if (inStr) {
        if (ch === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inStr = ch;
        continue;
      }
      if (ch === '(') { paren += 1; started = true; }
      else if (ch === ')') paren -= 1;
      else if (ch === '{') { brace += 1; started = true; }
      else if (ch === '}') brace -= 1;
      else if (ch === '[') bracket += 1;
      else if (ch === ']') bracket -= 1;
    }
    if (started && paren <= 0 && brace <= 0 && bracket <= 0) {
      const trimmed = line.trim();
      if (trimmed.endsWith(');') || trimmed.endsWith('};') || trimmed === ');' || trimmed === '};') {
        i += 1;
        break;
      }
    }
  }
  return { start: start + 1, end: i, code: lines.slice(start, i).join('\n') };
}

const blocks = {
  ResponsePanel: extractConst('ResponsePanel'),
  RepositorySection: extractConst('RepositorySection'),
  ShareReviewSection: extractConst('ShareReviewSection'),
  UserManagementSection: extractConst('UserManagementSection'),
  ImportCurlModal: extractConst('ImportCurlModal'),
  DocumentationModal: extractConst('DocumentationModal'),
};

for (const [k, v] of Object.entries(blocks)) {
  console.log(k, v.start, '-', v.end, 'lines', v.end - v.start + 1);
}

fs.writeFileSync(path.join(outDir, 'consoleFormatters.ts'), `import type { ApiClassificationType, ApiSharingStatus, ApiRequestExecution } from '../../types/apiConsole';

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
  const anyExec = execution as ApiRequestExecution & { bodyPreview?: string; responseBody?: string };
  const raw = anyExec.responseBodyPreview ?? anyExec.bodyPreview ?? anyExec.responseBody ?? '';
  return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
}

export function isJsonResponsePreview(execution: ApiRequestExecution | null): boolean {
  const headers = (execution as { responseHeaders?: Array<{ name: string; value: string }> } | null)?.responseHeaders;
  if (!headers) return false;
  const ct = headers.find(h => String(h.name || '').toLowerCase() === 'content-type')?.value || '';
  return /json/i.test(String(ct));
}
`);

function toExport(code) {
  return code.replace(/^const /, 'export const ');
}

const sectionImports = `import type { Dispatch, SetStateAction } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import type { PaginatedResponse } from '../../types';
import type { ApiRepositoryItem, ApiShareRequest } from '../../types/apiConsole';
import { API_SHARING_STATUS_LABELS } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Table, Pagination } from '../ui/Table';
import { CLASSIFICATION_LABELS, classBadgeVariant, formatDate, sharingBadgeVariant } from './consoleFormatters';

`;

fs.writeFileSync(path.join(outDir, 'RepositorySection.tsx'), sectionImports + toExport(blocks.RepositorySection.code) + '\n');
fs.writeFileSync(path.join(outDir, 'ShareReviewSection.tsx'), sectionImports + toExport(blocks.ShareReviewSection.code) + '\n');

// Dump UserManagement raw for manual import header - read first 30 lines of block for props
fs.writeFileSync(path.join(outDir, 'UserManagementSection.tsx'), `import type { Dispatch, SetStateAction } from 'react';
import { Plus, RefreshCw, Shield } from 'lucide-react';
import type { ActiveContext, UserRole, PaginatedResponse } from '../../types';
import { ROLE_LABELS } from '../../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Table, Pagination } from '../ui/Table';
import { Modal } from '../ui/Modal';
import { formatDate } from './consoleFormatters';

${toExport(blocks.UserManagementSection.code)}
`);

const panelShared = `import type { ReactNode } from 'react';
import { Copy, Download } from 'lucide-react';
import type { ApiCurlImportPreview, ApiRequestExecution, NormalizedApiRequest } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { resultBadgeVariant, safeBodyPreview, isJsonResponsePreview } from './consoleFormatters';

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>
);

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={\`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 \${minHeight}\`} dir="ltr">{value}</pre>
);

const JsonResponseViewer = ({ value }: { value: string }) => {
  let pretty = value;
  try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* keep */ }
  return <CodeBlock value={pretty} minHeight="max-h-96 min-h-40" />;
};

`;

fs.writeFileSync(path.join(outDir, 'ResponsePanel.tsx'), panelShared + toExport(blocks.ResponsePanel.code) + '\n');
fs.writeFileSync(path.join(outDir, 'ImportCurlModal.tsx'), panelShared + toExport(blocks.ImportCurlModal.code) + '\n');
fs.writeFileSync(path.join(outDir, 'DocumentationModal.tsx'), panelShared + toExport(blocks.DocumentationModal.code) + '\n');

// Remove from page highest-first
const ranges = Object.values(blocks)
  .map(b => [b.start, b.end])
  .sort((a, b) => b[0] - a[0]);

let next = lines.slice();
for (const [start1, end1] of ranges) {
  next.splice(start1 - 1, end1 - start1 + 1);
}

const needle = "import { MocksSection } from '../components/api-console/MocksSection';";
const joined = next.join('\n');
if (!joined.includes(needle)) throw new Error('import anchor missing');
const withImports = joined.replace(
  needle,
  `${needle}
import { RepositorySection } from '../components/api-console/RepositorySection';
import { ShareReviewSection } from '../components/api-console/ShareReviewSection';
import { UserManagementSection } from '../components/api-console/UserManagementSection';
import { ResponsePanel } from '../components/api-console/ResponsePanel';
import { ImportCurlModal } from '../components/api-console/ImportCurlModal';
import { DocumentationModal } from '../components/api-console/DocumentationModal';`,
);

fs.writeFileSync(srcPath, withImports.endsWith('\n') ? withImports : `${withImports}\n`);
console.log('page lines', withImports.split(/\n/).length);
