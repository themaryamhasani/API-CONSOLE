import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileText, Link2 } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { LoadingState } from '../components/ui/Loading';
import { apiConsoleApi } from '../services/apiConsoleApi';
import { API_SHARING_STATUS_LABELS } from '../types/apiConsole';
import type { ApiPublicPortalDocument } from '../types/apiConsole';

export function PublicPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
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
            </Card>

            <Card padding="md">
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-[var(--theme-accent)]" />
                <p className="text-sm font-semibold text-[var(--theme-text)]">مستندات</p>
              </div>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--theme-surface-muted)] p-3 text-xs leading-6 text-[var(--theme-text-muted)]">
                {[
                  doc.documentation?.title,
                  doc.documentation?.description || doc.description,
                  doc.documentation?.serviceIntroduction,
                  doc.documentation?.curlExample ? `cURL:\n${doc.documentation.curlExample}` : '',
                  doc.documentation?.responseExample ? `Response:\n${doc.documentation.responseExample}` : '',
                ].filter(Boolean).join('\n\n') || 'مستنداتی ثبت نشده است.'}
              </pre>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
