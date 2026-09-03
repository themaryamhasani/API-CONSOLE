import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Link2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/Loading';
import { toast } from '../components/ui/Toast';
import { apiConsoleApi } from '../services/apiConsoleApi';
import { API_SHARING_STATUS_LABELS } from '../types/apiConsole';
import type { ApiPublicPortalDocument } from '../types/apiConsole';

function buildPortalPreview(doc: ApiPublicPortalDocument) {
  const documentation = doc.documentation;
  return [
    documentation?.title || doc.name,
    documentation?.description || doc.description || '',
    documentation?.serviceIntroduction || '',
    `${doc.method} ${doc.urlTemplate}`,
    documentation?.curlExample ? `cURL:\n${documentation.curlExample}` : '',
    documentation?.responseExample ? `Response:\n${documentation.responseExample}` : '',
  ].filter(Boolean).join('\n\n') || 'مستنداتی ثبت نشده است.';
}

export function PublicPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<ApiPublicPortalDocument | null>(null);

  useEffect(() => {
    if (!token) {
      setError('لینک نامعتبر است.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiConsoleApi.getSharedPortalDocument(token);
        if (!cancelled) setDoc(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'بارگذاری سند مشترک ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const previewText = useMemo(() => (doc ? buildPortalPreview(doc) : ''), [doc]);

  const handleDownloadOfficialDocx = async () => {
    if (!token) return;
    setDownloading(true);
    try {
      await apiConsoleApi.downloadSharedPortalDocument(token, 'FA');
      toast.success('سند Word رسمی (قالب مستندات بهره‌برداری) دانلود شد.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'دانلود سند ناموفق بود.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="ac-login-stage !min-h-screen">
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8 ac-rise text-white">
          <p className="font-display text-4xl font-bold tracking-tight">API Console</p>
          <p className="mt-2 text-sm text-white/65">مستندات موقت · فقط‌خواندنی · بدون اجرا</p>
        </div>

        {loading ? (
          <Card padding="lg" className="ac-rise-delay">
            <LoadingState label="در حال بارگذاری سند مشترک…" className="py-10" />
          </Card>
        ) : error ? (
          <Card padding="md" className="ac-rise-delay">
            <p className="text-sm text-[var(--theme-danger)]">{error}</p>
            <Link to="/portal" className="mt-4 inline-block text-sm text-[var(--theme-accent)] hover:underline">
              ورود به پورتال
            </Link>
          </Card>
        ) : doc ? (
          <div className="ac-rise-delay space-y-4">
            <Card padding="md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[var(--theme-text)]">{doc.name}</h2>
                    <Badge variant="default">v{doc.version}</Badge>
                    <Badge variant={doc.sharingStatus === 'DEPRECATED' ? 'danger' : 'success'}>
                      {API_SHARING_STATUS_LABELS[doc.sharingStatus] || doc.sharingStatus}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-[var(--theme-text-muted)]">{doc.description || '—'}</p>
                  <p className="mt-2 font-mono text-xs text-[var(--theme-text-subtle)]" dir="ltr">{doc.method} {doc.urlTemplate}</p>
                  {doc.expiresAt ? (
                    <p className="mt-3 inline-flex items-center gap-1 text-xs text-amber-800">
                      <Link2 className="h-3.5 w-3.5" />
                      انقضا: <span dir="ltr">{doc.expiresAt}</span>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={() => { void handleDownloadOfficialDocx(); }} loading={downloading}>
                    دانلود سند Word
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-xs text-[var(--theme-text-subtle)]">
                فایل دانلودی همان سند رسمی «مستندات بهره‌برداری» با قالب Word سازمان است (جلد، وزارت، نسخه و …).
              </p>
            </Card>

            <Card padding="md">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--theme-accent)]" />
                  <p className="text-sm font-semibold text-[var(--theme-text)]">پیش‌نمایش محتوا</p>
                </div>
                <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => { void handleDownloadOfficialDocx(); }} loading={downloading}>
                  دانلود فایل رسمی
                </Button>
              </div>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--theme-surface-muted)] p-3 text-xs leading-6 text-[var(--theme-text-muted)]">
                {previewText}
              </pre>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
