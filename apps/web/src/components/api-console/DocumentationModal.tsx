import { Copy, Download } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';

const CodeBlock = ({ value, minHeight = 'min-h-28' }: { value: string; minHeight?: string }) => (
  <pre className={`overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 ${minHeight}`} dir="ltr">{value}</pre>
);

export const DocumentationModal = ({
  open,
  markdown,
  warnings,
  onClose,
}: {
  open: boolean;
  markdown: string;
  warnings: string[];
  onClose: () => void;
}) => (
  <Modal isOpen={open} onClose={onClose} title="سند تولیدشده API" size="wide">
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
              {warning}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => {
          navigator.clipboard?.writeText(markdown);
          toast.success('Documentation کپی شد.');
        }}>
          کپی Markdown
        </Button>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => {
          const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `api-console-doc-${new Date().toISOString().split('T')[0]}.md`;
          a.click();
          URL.revokeObjectURL(url);
        }}>
          Markdown
        </Button>
      </div>
      <CodeBlock value={markdown} minHeight="min-h-48 sm:min-h-[560px]" />
    </div>
  </Modal>
);
