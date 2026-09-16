import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, KeyRound, Loader2, LogIn, RefreshCw, ShieldAlert, UserRound } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from '../components/ui/Toast';
import { CdeLoginPage } from './CdeLoginPage';
import { PlatformApiError, cdeApi, localAuthApi, sessionApi, setCsrfToken } from '../services/cdeApi';
import { useSessionStore } from '../stores/sessionStore';
import { consumeReturnTo, rememberReturnTo } from '../utils/returnTo';

type ProbeState = 'checking' | 'idle' | 'connected' | 'denied';
type LoginTab = 'cde' | 'local';

const LOCALHOST_SSO_HINT =
  'روی localhost کوکی‌های CDE به کنسول نمی‌رسند. می‌توانید پنجرهٔ ورود CDE را باز کنید، ولی برای ورود به کنسول از فرم شماره همراه و رمز استفاده کنید.';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bootstrap = useSessionStore(state => state.bootstrap);
  const refreshProjects = useSessionStore(state => state.refreshProjects);
  const selectProject = useSessionStore(state => state.selectProject);
  const setWorkspaceAccess = useSessionStore(state => state.setWorkspaceAccess);
  const applyLocalLogin = useSessionStore(state => state.applyLocalLogin);

  const [probeState, setProbeState] = useState<ProbeState>('checking');
  const [loginTab, setLoginTab] = useState<LoginTab>('cde');
  const [ssoConfig, setSsoConfig] = useState<Awaited<ReturnType<typeof cdeApi.ssoConfig>> | null>(null);
  const [message, setMessage] = useState('');
  const [localUsername, setLocalUsername] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [deniedDetails, setDeniedDetails] = useState<{
    requiredWorkspaces?: string[];
    grantedWorkspaces?: string[];
  } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupPollRef = useRef<number | null>(null);

  useEffect(() => {
    const returnTo = searchParams.get('returnTo');
    if (returnTo) rememberReturnTo(returnTo);
    if (searchParams.get('sso') === 'unavailable') {
      setMessage('بازگشت خودکار از CDE پشتیبانی نمی‌شود. با شماره و رمز وارد شوید، یا روی دامنهٔ مشترک با CDE استقرار دهید.');
    }
  }, [searchParams]);

  const stopPopupPoll = useCallback(() => {
    if (popupPollRef.current != null) {
      window.clearInterval(popupPollRef.current);
      popupPollRef.current = null;
    }
    popupRef.current = null;
  }, []);

  useEffect(() => () => stopPopupPoll(), [stopPopupPoll]);

  const goAfterLogin = useCallback(async () => {
    const projects = await refreshProjects();
    if (projects[0]) await selectProject(projects[0].projectKey);
    await bootstrap();
    const state = useSessionStore.getState();
    if (state.workspaceAccess && !state.workspaceAccess.allowed) {
      setProbeState('denied');
      setDeniedDetails(state.workspaceAccess);
      return;
    }
    if (!state.activeContext) {
      setProbeState('idle');
      setMessage('نشست برقرار نشد. اگر به ورک‌اسپیس medu-ai دسترسی ندارید، ورود مجاز نیست.');
      return;
    }
    toast.success('ورود برقرار شد.');
    navigate(consumeReturnTo(), { replace: true });
  }, [bootstrap, navigate, refreshProjects, selectProject]);

  const runProbe = useCallback(async () => {
    setProbeState('checking');
    setDeniedDetails(null);
    try {
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);
      if (session.workspaceAccess) setWorkspaceAccess(session.workspaceAccess);

      if (session.authenticated && session.activeContext) {
        setProbeState('connected');
        navigate(consumeReturnTo(), { replace: true });
        return;
      }

      if (session.workspaceAccess && !session.workspaceAccess.allowed) {
        setProbeState('denied');
        setDeniedDetails(session.workspaceAccess);
        setWorkspaceAccess(session.workspaceAccess);
        return;
      }

      if (session.cdeConnected) {
        try {
          const status = await cdeApi.status();
          if (status.csrfToken) setCsrfToken(status.csrfToken);
          if (status.connected) {
            setProbeState('connected');
            await goAfterLogin();
            return;
          }
        } catch (error) {
          if (error instanceof PlatformApiError && error.code === 'WORKSPACE_ACCESS_DENIED') {
            setProbeState('denied');
            const details = (error.details || {}) as { requiredWorkspaces?: string[]; grantedWorkspaces?: string[] };
            setDeniedDetails(details);
            setWorkspaceAccess({
              allowed: false,
              requiredWorkspaces: details.requiredWorkspaces || ['medu-ai'],
              grantedWorkspaces: details.grantedWorkspaces || [],
            });
            return;
          }
        }
      }

      const config = await cdeApi.ssoConfig();
      setSsoConfig(config);

      const result = await cdeApi.ssoProbe();
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      if (result.workspaceAccess) setWorkspaceAccess(result.workspaceAccess);

      if (result.connected) {
        setProbeState('connected');
        await goAfterLogin();
        return;
      }

      setProbeState('idle');
      if (!config.cookieForwardAvailable) {
        setMessage(result.message || config.messageFa || LOCALHOST_SSO_HINT);
      } else {
        setMessage(
          result.message
          || config.messageFa
          || 'نشست CDE پیدا نشد. پنجرهٔ ورود CDE را باز کنید، وارد شوید، سپس «بررسی مجدد» را بزنید — یا با شماره و رمز وارد شوید.',
        );
      }
    } catch (error) {
      if (error instanceof PlatformApiError && error.code === 'WORKSPACE_ACCESS_DENIED') {
        setProbeState('denied');
        const details = (error.details || {}) as { requiredWorkspaces?: string[]; grantedWorkspaces?: string[] };
        setDeniedDetails(details);
        setWorkspaceAccess({
          allowed: false,
          requiredWorkspaces: details.requiredWorkspaces || ['medu-ai'],
          grantedWorkspaces: details.grantedWorkspaces || [],
        });
        return;
      }
      setProbeState('idle');
      setMessage(error instanceof Error ? error.message : 'بررسی نشست ناموفق بود.');
    }
  }, [goAfterLogin, navigate, setWorkspaceAccess]);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && probeState === 'idle' && loginTab === 'cde') {
        void runProbe();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [probeState, runProbe, loginTab]);

  const openCdePopup = () => {
    const url = ssoConfig?.loginUrl || 'https://cde.edus.ir/';
    stopPopupPoll();
    const popup = window.open(url, 'cde-sso', 'width=980,height=780,menubar=no,toolbar=no');
    if (!popup) {
      setMessage('پنجرهٔ ورود CDE مسدود شد. pop-up را مجاز کنید یا با شماره و رمز وارد شوید.');
      return;
    }
    popupRef.current = popup;
    setMessage(
      ssoConfig?.cookieForwardAvailable
        ? 'پس از ورود در پنجرهٔ CDE، آن را ببندید؛ نشست به‌صورت خودکار بررسی می‌شود.'
        : `${LOCALHOST_SSO_HINT}`,
    );
    popupPollRef.current = window.setInterval(() => {
      const win = popupRef.current;
      if (!win || win.closed) {
        stopPopupPoll();
        void runProbe();
      }
    }, 700);
  };

  const handleLocalLogin = async () => {
    if (!localUsername.trim() || !localPassword) {
      setLocalError('نام کاربری و رمز عبور را وارد کنید.');
      return;
    }
    setLocalLoading(true);
    setLocalError('');
    try {
      const session = await sessionApi.current();
      if (session.csrfToken) setCsrfToken(session.csrfToken);
      const result = await localAuthApi.login(localUsername.trim(), localPassword);
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      await applyLocalLogin(result);
      toast.success('ورود محلی برقرار شد.');
      navigate(consumeReturnTo(), { replace: true });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'ورود محلی ناموفق بود.');
    } finally {
      setLocalLoading(false);
    }
  };

  if (probeState === 'denied') {
    return (
      <div className="ac-login-stage">
        <div className="relative z-10 mx-auto w-full max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl dark:bg-[var(--theme-surface)]/95">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-200">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--theme-text)]">دسترسی به ورک‌اسپیس لازم است</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--theme-text-muted)]">
            فقط کسانی که به ورک‌اسپیس‌های زیر دسترسی دارند می‌توانند با حساب CDE وارد API Console شوند:
          </p>
          <ul className="mt-3 list-inside list-disc text-sm font-medium text-[var(--theme-text)]">
            {(deniedDetails?.requiredWorkspaces || ['medu-ai']).map(key => (
              <li key={key} dir="ltr">{key}</li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void runProbe()}>
              <RefreshCw className="ml-1 h-4 w-4" />
              بررسی مجدد
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setProbeState('idle'); setLoginTab('local'); }}>
              ورود محلی
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (probeState === 'checking' || probeState === 'connected') {
    return (
      <div className="ac-login-stage">
        <div className="relative z-10 flex flex-col items-center gap-3 text-white">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm text-white/80">
            {probeState === 'connected' ? 'در حال ورود…' : 'در حال بررسی نشست…'}
          </p>
        </div>
      </div>
    );
  }

  const sameSite = Boolean(ssoConfig?.cookieForwardAvailable);

  return (
    <div className="ac-login-stage">
      <div className="relative z-10 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="ac-rise px-2 text-white lg:px-4">
          <p className="font-display text-5xl font-bold tracking-tight sm:text-6xl">API Console</p>
          <p className="mt-4 max-w-md text-base leading-8 text-white/70">
            ورود با CDE (کشف و Runtime) یا حساب محلی تعریف‌شده توسط مدیر سیستم (درخواست آزاد).
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs text-white/55">
            <span className="rounded-full border border-white/15 px-3 py-1">CDE</span>
            <span className="rounded-full border border-white/15 px-3 py-1">Local Directory</span>
            <span className="rounded-full border border-white/15 px-3 py-1">workspace: medu-ai</span>
          </div>
        </div>

        <div className="ac-rise-delay space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-1" data-testid="login-tabs">
            <button
              type="button"
              data-testid="login-tab-cde"
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${loginTab === 'cde' ? 'bg-white text-gray-900' : 'text-white/70 hover:text-white'}`}
              onClick={() => setLoginTab('cde')}
            >
              ورود CDE
            </button>
            <button
              type="button"
              data-testid="login-tab-local"
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${loginTab === 'local' ? 'bg-white text-gray-900' : 'text-white/70 hover:text-white'}`}
              onClick={() => setLoginTab('local')}
            >
              ورود محلی
            </button>
          </div>

          {loginTab === 'cde' ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur dark:bg-[var(--theme-surface)]/95 sm:p-8">
                <h2 className="text-base font-semibold text-[var(--theme-text)]">ورود یکپارچه با CDE</h2>
                <p className="mt-2 text-xs leading-6 text-[var(--theme-text-subtle)]">
                  {sameSite
                    ? 'پنجرهٔ ورود CDE را باز کنید، وارد شوید، سپس آن را ببندید تا نشست بررسی شود.'
                    : LOCALHOST_SSO_HINT}
                </p>
                {message ? <p className="mt-3 text-sm text-[var(--theme-danger)]">{message}</p> : null}
                <div className="mt-5 flex flex-col gap-2">
                  <Button type="button" className="w-full" onClick={openCdePopup}>
                    <LogIn className="ml-1 h-4 w-4" />
                    باز کردن ورود CDE
                    <ExternalLink className="mr-1 h-3.5 w-3.5 opacity-70" />
                  </Button>
                  <Button type="button" variant="secondary" className="w-full" onClick={() => void runProbe()}>
                    <RefreshCw className="ml-1 h-4 w-4" />
                    بررسی مجدد نشست
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <CdeLoginPage embedded />
              </div>
            </>
          ) : (
            <form
              className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl backdrop-blur dark:bg-[var(--theme-surface)]/95 sm:p-8"
              data-testid="local-login-form"
              onSubmit={event => {
                event.preventDefault();
                if (!localLoading) void handleLocalLogin();
              }}
            >
              <div className="mb-5 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)]">
                  <UserRound className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[var(--theme-text)]">ورود محلی</h2>
                  <p className="text-xs text-[var(--theme-text-subtle)]">حساب تعریف‌شده توسط مدیر سیستم — فقط درخواست آزاد</p>
                </div>
              </div>
              <div className="space-y-3">
                <Input
                  label="نام کاربری"
                  data-testid="local-username"
                  value={localUsername}
                  onChange={event => setLocalUsername(event.target.value)}
                  autoComplete="username"
                  dir="ltr"
                />
                <Input
                  label="رمز عبور"
                  data-testid="local-password"
                  type="password"
                  value={localPassword}
                  onChange={event => setLocalPassword(event.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              </div>
              {localError ? <p className="mt-3 text-sm text-[var(--theme-danger)]" data-testid="local-login-error">{localError}</p> : null}
              <Button type="submit" className="mt-5 w-full" loading={localLoading} data-testid="local-login-submit">
                <KeyRound className="ml-1 h-4 w-4" />
                ورود
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
