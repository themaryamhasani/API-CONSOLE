import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ActiveContext } from '../../types';
import type { ApiBrandingPreview, ApiBrandingState, ApiDocLanguage } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { toast } from '../ui/Toast';
import { Table } from '../ui/Table';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] || '' : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
    reader.readAsDataURL(file);
  });
}

export function BrandingAdminSection({ context }: { context: ActiveContext }) {
  const [state, setState] = useState<ApiBrandingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('قالب سفارشی');
  const [language, setLanguage] = useState<ApiDocLanguage>('FA');
  const [previewLanguage, setPreviewLanguage] = useState<ApiDocLanguage>('FA');
  const [preview, setPreview] = useState<ApiBrandingPreview | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setState(await apiConsoleApi.getBrandingTemplates(context));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری قالب‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [context.contextId]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await apiConsoleApi.uploadBrandingTemplate({ name: name.trim() || file.name, language, fileBase64 }, context);
      toast.success('قالب DOCX بارگذاری و فعال شد.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بارگذاری قالب ناموفق بود.');
    } finally {
      setUploading(false);
    }
  };

  const handleActivate = async (templateId: string) => {
    try {
      setState(await apiConsoleApi.activateBrandingTemplate(templateId, context));
      toast.success('قالب فعال شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'فعال‌سازی قالب ناموفق بود.');
    }
  };

  const handlePreview = async () => {
    try {
      setPreview(await apiConsoleApi.previewBrandingTemplate(previewLanguage, context));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'پیش‌نمایش قالب ناموفق بود.');
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">برندینگ و قالب DOCX</h2>
            <p className="text-xs text-gray-500">فقط SYSTEM_ADMIN — بارگذاری، فعال‌سازی و پیش‌نمایش FA/EN.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
            تازه‌سازی
          </Button>
        </div>
        <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_140px_auto]">
          <Input label="نام قالب" value={name} onChange={(event) => setName(event.target.value)} />
          <Select
            label="زبان"
            value={language}
            onChange={(event) => setLanguage(event.target.value as ApiDocLanguage)}
            options={[
              { value: 'FA', label: 'فارسی' },
              { value: 'EN', label: 'English' },
            ]}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">آپلود فایل DOCX</span>
            <input
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={uploading}
              onChange={(event) => { void handleUpload(event.target.files?.[0] || null); }}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        </div>
      </Card>

      <Table
        columns={[
          {
            key: 'name',
            title: 'قالب',
            render: (row) => (
              <div>
                <p className="font-medium text-gray-900">{row.name}</p>
                <p className="font-mono text-xs text-gray-500" dir="ltr">{row.id}</p>
              </div>
            ),
          },
          {
            key: 'language',
            title: 'زبان',
            render: (row) => <Badge size="sm">{row.language}</Badge>,
          },
          {
            key: 'active',
            title: 'وضعیت',
            render: (row) => (
              state?.activeTemplateId === row.id
                ? <Badge variant="success" size="sm">فعال</Badge>
                : <Badge variant="secondary" size="sm">غیرفعال</Badge>
            ),
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (row) => (
              <Button
                size="sm"
                variant="secondary"
                disabled={state?.activeTemplateId === row.id}
                onClick={() => { void handleActivate(row.id); }}
              >
                فعال‌سازی
              </Button>
            ),
          },
        ]}
        data={state?.templates || []}
        loading={loading}
        emptyMessage="قالبی ثبت نشده است"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />

      <Card padding="sm">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Select
            label="پیش‌نمایش زبان"
            value={previewLanguage}
            onChange={(event) => setPreviewLanguage(event.target.value as ApiDocLanguage)}
            options={[
              { value: 'FA', label: 'فارسی' },
              { value: 'EN', label: 'English' },
            ]}
          />
          <Button size="sm" onClick={() => { void handlePreview(); }}>پیش‌نمایش</Button>
        </div>
        {preview ? (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-semibold">{preview.labels.title}</p>
            <p className="mt-1">{preview.labels.intro}</p>
            <p className="mt-2 font-mono text-xs" dir="ltr">
              {preview.sample.method} {preview.sample.endpoint} — {preview.sample.title}
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-500">برای مشاهده برچسب‌های FA/EN پیش‌نمایش بگیرید.</p>
        )}
      </Card>
    </div>
  );
}
