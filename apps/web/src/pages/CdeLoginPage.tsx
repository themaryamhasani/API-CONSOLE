import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle, KeyRound, Smartphone } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { toast } from '../components/ui/Toast';
import { PlatformApiError, cdeApi, sessionApi, setCsrfToken, type CdeOriginOption } from '../services/cdeApi';
import { useSessionStore } from '../stores/sessionStore';

function isValidCdeCellphone(value: string): boolean {
  const digits = value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/\D+/g, '');
  return /^(?:0?9\d{9}|98\d{10})$/.test(digits) || /^9\d{9}$/.test(digits);
}

function cdeLoginErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError) {
    if (error.code === 'CDE_INVALID_CREDENTIALS') return 'رمز عبور CDE نادرست است.';
    if (error.code === 'CDE_LOGIN_CHALLENGE_EXPIRED') return 'مهلت ورود منقضی شد. دوباره شروع کنید.';
    if (error.code === 'CDE_LOGIN_NAME_INVALID') return 'شماره همراه معتبر وارد کنید.';
    if (error.code === 'CDE_ORIGIN_INVALID') return 'Origin انتخاب‌شده معتبر نیست.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'اتصال به CDE ناموفق بود.';
}

export const CdeLoginPage: React.FC = () => {
  const bootstrap = useSessionStore(state => state.bootstrap);
  const refreshProjects = useSessionStore(state => state.refreshProjects);
  const selectProject = useSessionStore(state => state.selectProject);

  const [cdeLoginName, setCdeLoginName] = useState('');
  const [cdePassword, setCdePassword] = useState('');
  const [cdeChallenge, setCdeChallenge] = useState('');
  const [cdeLoginStep, setCdeLoginStep] = useState<'phone' | 'password'>('phone');
  const [cdeError, setCdeError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [origins, setOrigins] = useState<CdeOriginOption[]>([]);
  const [selectedOriginId, setSelectedOriginId] = useState('');
  const [originsLoading, setOriginsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOriginsLoading(true);
    void cdeApi
      .listOrigins()
      .then(rows => {
        if (cancelled) return;
        setOrigins(rows);
        if (rows[0]) setSelectedOriginId(rows[0].id);
      })
      .catch(error => {
        if (!cancelled) setCdeError(cdeLoginErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setOriginsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishConnected = async () => {
    const projects = await refreshProjects();
    if (projects[0]) await selectProject(projects[0].projectKey);
    await bootstrap();
    toast.success('اتصال CDE برقرار شد.');
  };

  const handleCdeLogin = async () => {
    if (cdeLoginStep === 'phone') {
      if (!selectedOriginId) {
        setCdeError('ابتدا Origin مربوط به CDE را انتخاب کنید.');
        return;
      }
      if (!isValidCdeCellphone(cdeLoginName)) {
        setCdeError('شماره همراه معتبر وارد کنید؛ مانند ۰۹۱۲۱۲۳۴۵۶۷.');
        return;
      }
    }
    if (cdeLoginStep === 'password' && !cdePassword) {
      setCdeError('رمز عبور CDE را وارد کنید.');
      return;
    }
    setActionLoading(true);
    setCdeError('');
    try {
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);

      if (cdeLoginStep === 'phone') {
        await cdeApi.selectOrigin(selectedOriginId);
        const response = await cdeApi.startLogin(cdeLoginName.trim());
        if (response.csrfToken) setCsrfToken(response.csrfToken);
        if (response.connected) {
          await finishConnected();
        } else {
          if (response.nextStep !== 'password' || !response.challenge) {
            throw new PlatformApiError('CDE_LOGIN_RESPONSE_INVALID', 'CDE login response was incomplete.', 502);
          }
          setCdeChallenge(response.challenge || '');
          setCdeLoginStep('password');
        }
      } else {
        const response = await cdeApi.finishPassword(cdeChallenge, cdePassword);
        if (response.csrfToken) setCsrfToken(response.csrfToken);
        setCdePassword('');
        await finishConnected();
      }
    } catch (error) {
      if (error instanceof PlatformApiError && error.code === 'CDE_LOGIN_CHALLENGE_EXPIRED') {
        setCdeLoginStep('phone');
        setCdeChallenge('');
        setCdePassword('');
      }
      setCdeError(cdeLoginErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="ac-login-stage">
      <div className="relative z-10 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="ac-rise px-2 text-white lg:px-4">
          <p className="font-display text-5xl font-bold tracking-tight sm:text-6xl">API Console</p>
          <p className="mt-4 max-w-md text-base leading-8 text-white/70">
            فضای کار مینیمال برای طراحی، اجرای امن، و انتشار APIهای سازمانی.
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs text-white/55">
            <span className="rounded-full border border-white/15 px-3 py-1">Session-trusted</span>
            <span className="rounded-full border border-white/15 px-3 py-1">Audit-ready</span>
            <span className="rounded-full border border-white/15 px-3 py-1">CDE SSO</span>
          </div>
        </div>

        <form
          className="ac-rise-delay rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur dark:bg-[var(--theme-surface)]/95 sm:p-8"
          onSubmit={event => {
            event.preventDefault();
            if (!actionLoading) void handleCdeLogin();
          }}
        >
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]">
              {cdeLoginStep === 'phone' ? <Smartphone className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--theme-text)]">ورود با CDE</h2>
              <p className="text-xs text-[var(--theme-text-subtle)]">
                {cdeLoginStep === 'phone' ? 'مرحله ۱ از ۲ — شماره همراه' : 'مرحله ۲ از ۲ — رمز عبور'}
              </p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2">
            <div
              className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${
                cdeLoginStep === 'phone'
                  ? 'bg-[var(--theme-accent)] text-white'
                  : 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]'
              }`}
            >
              {cdeLoginStep === 'password' ? <CheckCircle className="mx-auto mb-1 h-3.5 w-3.5" /> : null}
              شماره
            </div>
            <div
              className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${
                cdeLoginStep === 'password'
                  ? 'bg-[var(--theme-accent)] text-white'
                  : 'bg-[var(--theme-surface-muted)] text-[var(--theme-text-subtle)]'
              }`}
            >
              رمز
            </div>
          </div>

          {cdeLoginStep === 'phone' ? (
            <div className="space-y-4">
              <Select
                label="Origin"
                value={selectedOriginId}
                onChange={event => {
                  setSelectedOriginId(event.target.value);
                  if (cdeError) setCdeError('');
                }}
                disabled={actionLoading || originsLoading || origins.length === 0}
                options={origins.map(origin => ({
                  value: origin.id,
                  label: `${origin.label}`,
                }))}
              />
              <Input
                key="cde-phone"
                label="شماره همراه"
                value={cdeLoginName}
                onChange={event => {
                  setCdeLoginName(event.target.value.slice(0, 18));
                  if (cdeError) setCdeError('');
                }}
                placeholder="۰۹۱۲۱۲۳۴۵۶۷"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                disabled={actionLoading}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-[var(--theme-text-subtle)] hover:text-[var(--theme-accent)]"
                onClick={() => {
                  setCdeLoginStep('phone');
                  setCdePassword('');
                  setCdeError('');
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                تغییر شماره
              </button>
              <Input
                key="cde-password"
                label="رمز عبور CDE"
                type="password"
                value={cdePassword}
                onChange={event => {
                  setCdePassword(event.target.value);
                  if (cdeError) setCdeError('');
                }}
                dir="ltr"
                autoComplete="current-password"
                autoFocus
                disabled={actionLoading}
              />
            </div>
          )}

          {cdeError ? <p className="mt-4 text-sm text-[var(--theme-danger)]">{cdeError}</p> : null}

          <Button
            type="submit"
            className="mt-6 w-full"
            disabled={actionLoading || (cdeLoginStep === 'phone' && !selectedOriginId)}
          >
            {actionLoading ? 'در حال اتصال…' : cdeLoginStep === 'phone' ? 'ادامه' : 'ورود به Console'}
          </Button>

          <p className="mt-4 text-center text-[11px] leading-5 text-[var(--theme-text-subtle)]">
            رمز عبور ذخیره نمی‌شود؛ فقط نشست امن روی سرور نگه داشته می‌شود.
          </p>
        </form>
      </div>
    </div>
  );
};
