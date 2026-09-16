'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const text = execSync('git show HEAD:apps/web/src/pages/OnlineApiConsolePage.tsx', {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
const lines = text.split(/\n/);

function extractConst(name) {
  const start = lines.findIndex(l => l.startsWith(`const ${name}`));
  if (start < 0) throw new Error(name);
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
      if (trimmed.endsWith(');') || trimmed.endsWith('};')) {
        i += 1;
        break;
      }
    }
  }
  return { start, end: i, code: lines.slice(start, i).join('\n') };
}

const curl = extractConst('ImportCurlModal');
const docs = extractConst('DocumentationModal');
console.log('ImportCurl', curl.start + 1, curl.end, curl.end - curl.start);
console.log('Docs', docs.start + 1, docs.end, docs.end - docs.start);

const curlHeader = `import type { ReactNode } from 'react';
import type { ApiCollection, ApiCurlImportPreview } from '../../types/apiConsole';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Input, Select, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-gray-600">{children}</label>
);

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={\`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 \${minHeight}\`} dir="ltr">{value}</pre>
);

`;

fs.writeFileSync(
  'apps/web/src/components/api-console/ImportCurlModal.tsx',
  curlHeader + curl.code.replace(/^const /, 'export const ') + '\n',
);

const docsHeader = `import { Copy, Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={\`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 \${minHeight}\`} dir="ltr">{value}</pre>
);

`;

fs.writeFileSync(
  'apps/web/src/components/api-console/DocumentationModal.tsx',
  docsHeader + docs.code.replace(/^const /, 'export const ') + '\n',
);
