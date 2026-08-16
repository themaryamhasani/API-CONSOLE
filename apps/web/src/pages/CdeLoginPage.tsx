import React, { useState } from 'react';
import { CheckCircle, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { toast } from '../components/ui/Toast';
import { PlatformApiError, cdeApi, sessionApi, setCsrfToken } from '../services/cdeApi';
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
    return error.message;
  }
  return error instanceof Error ? error.message : 'اتصال به CDE ناموفق بود.';
}

export const CdeLoginPage: React.FC = () => {
  const bootstrap = useSessionStore(state => state.bootstrap);
  const refreshProjects = useSessionStore(state => state.refreshProjects);
  const selectProject = useSessionStore(state => state.selectProject);

  const [showCdeLogin, setShowCdeLogin] = useState(true);
  const [cdeLoginName, setCdeLoginName] = useState('');
  const [cdePassword, setCdePassword] = useState('');
  const [cdeChallenge, setCdeChallenge] = useState('');
  const [cdeLoginStep, setCdeLoginStep] = useState<'phone' | 'password'>('phone');
  const [cdeError, setCdeError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const finishConnected = async () => {
    const projects = await refreshProjects();
    if (projects[0]) await selectProject(projects[0].projectKey);
    await bootstrap();
    toast.success('اتصال CDE برقرار شد.');
  };

  const handleCdeLogin = async () => {
    if (cdeLoginStep === 'phone' && !isValidCdeCellphone(cdeLoginName)) {
      setCdeError('شماره همراه معتبر وارد کنید؛ مانند ۰۹۱۲۱۲۳۴۵۶۷.');
      return;
    }
    if (cdeLoginStep === 'password' && !cdePassword) {
      setCdeError('رمز عبور CDE را وارد کنید.');
      return;
    }
    setActionLoading(true);
    setCdeError('');
    try {
      // Use app session for CSRF only. Do NOT call /api/cde/session here during
      // the password step — that used to wipe the mid-login CDE cookie jar.
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);

      if (cdeLoginStep === 'phone') {
        const response = await cdeApi.startLogin(cdeLoginName.trim());
        if (response.csrfToken) setCsrfToken(response.csrfToken);
        if (response.connected) {
          setShowCdeLogin(false);
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
        setShowCdeLogin(false);
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
    <div className="min-h-screen bg-[var(--theme-canvas)] px-4 py-10">
      <div className="mx-auto max-w-xl">
        <Card className="p-6">
          <h1 className="text-2xl font-bold text-[var(--theme-text)]">API Console</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--theme-text-muted)]">
            برای ورود به ماژول API Console با حساب CDE متصل شوید. پس از اتصال، پروژه‌ها و مخزن API Module بارگذاری می‌شوند.
          </p>
          <div className="mt-6">
            <Button onClick={() => setShowCdeLogin(true)}>اتصال حساب CDE</Button>
          </div>
        </Card>
      </div>

      <Modal
        isOpen={showCdeLogin}
        onClose={() => {
          if (!actionLoading) setShowCdeLogin(false);
        }}
        title="اتصال حساب CDE"
        size="md"
      >
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!actionLoading) void handleCdeLogin();
          }}
        >
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-1" aria-label="مراحل اتصال CDE">
            <div className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${cdeLoginStep === 'phone' ? 'bg-white text-blue-700 shadow-sm' : 'text-emerald-700'}`}>
              {cdeLoginStep === 'password' ? <CheckCircle className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
              <span>۱. شماره همراه</span>
            </div>
            <div className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium ${cdeLoginStep === 'password' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-400'}`}>
              <KeyRound className="h-4 w-4" />
              <span>۲. رمز عبور</span>
            </div>
          </div>

          <div className="rounded-xl border border-blue-100 bg-gradient-to-l from-blue-50 to-white p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-100 p-2 text-blue-700"><ShieldCheck className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-semibold text-gray-900">اتصال امن به حساب شخصی CDE</p>
                <p className="mt-1 text-xs leading-6 text-gray-600">
                  رمز عبور فقط برای ورود به Core ارسال می‌شود و در این برنامه ذخیره نخواهد شد. تنها نشست رمزنگاری‌شده نگهداری می‌شود.
                </p>
              </div>
            </div>
          </div>

          {cdeLoginStep === 'phone' ? (
            <Input
              key="cde-phone"
              label="شماره همراه حساب CDE"
              value={cdeLoginName}
              onChange={(event) => {
                setCdeLoginName(event.target.value.slice(0, 18));
                if (cdeError) setCdeError('');
              }}
              placeholder="۰۹۱۲۱۲۳۴۵۶۷"
              hint="شماره ثبت‌شده در CDE را با یا بدون صفر ابتدایی وارد کنید."
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              disabled={actionLoading}
            />
          ) : (
            <Input
              key="cde-password"
              label="رمز عبور CDE"
              type="password"
              value={cdePassword}
              onChange={(event) => {
                setCdePassword(event.target.value);
                if (cdeError) setCdeError('');
              }}
              dir="ltr"
              autoComplete="current-password"
              autoFocus
              disabled={actionLoading}
            />
          )}

          {cdeError ? <p className="text-sm text-red-600">{cdeError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={actionLoading}
              onClick={() => {
                if (!actionLoading) setShowCdeLogin(false);
              }}
            >
              انصراف
            </Button>
            <Button type="submit" disabled={actionLoading}>
              {actionLoading ? 'در حال اتصال…' : cdeLoginStep === 'phone' ? 'ادامه' : 'ورود'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
