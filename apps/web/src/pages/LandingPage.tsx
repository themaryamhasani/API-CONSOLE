import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Loader2, LogIn, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { toast } from '../components/ui/Toast';
import { CdeLoginPage } from './CdeLoginPage';
import { PlatformApiError, cdeApi, sessionApi, setCsrfToken } from '../services/cdeApi';
import { useSessionStore } from '../stores/sessionStore';
import { consumeReturnTo, rememberReturnTo } from '../utils/returnTo';

type ProbeState = 'checking' | 'idle' | 'connected' | 'denied';

const LOCALHOST_SSO_HINT =
  'روی localhost کوکی‌های CDE به کنسول نمی‌رسند. می‌توانید پنجرهٔ ورود CDE را باز کنید، ولی برای ورود به کنسول از فرم شماره همراه و رمز استفاده کنید.';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bootstrap = useSessionStore(state => state.bootstrap);
  const refreshProjects = useSessionStore(state => state.refreshProjects);
  const selectProject = useSessionStore(state => state.selectProject);
  const setWorkspaceAccess = useSessionStore(state => state.setWorkspaceAccess);

  const [probeState, setProbeState] = useState<ProbeState>('checking');
  const [ssoConfig, setSsoConfig] = useState<Awaited<ReturnType<typeof cdeApi.ssoConfig>> | null>(null);
  const [message, setMessage] = useState('');
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

      // Phone/password login stores CDE on the server — resume without cookie SSO (localhost).
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
      if (document.visibilityState === 'visible' && probeState === 'idle') {
        void runProbe();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [probeState, runProbe]);

  const openCdePopup = () => {
    const url = ssoConfig?.loginUrl || 'https://cde.edus.ir/';
    stopPopupPoll();
    // Do not use noopener — we need popup.closed for the poll.
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

  if (probeState === 'denied') {
    return (
      <div className="ac-login-stage">
        <div className="relative z-10 mx-auto w-full max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl dark:bg-[var(--theme-surface)]/95">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-200">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--theme-text)]">دسترسی به ورک‌اسپیس لازم است</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--theme-text-muted)]">
            فقط کسانی که به ورک‌اسپیس‌های زیر دسترسی دارند می‌توانند وارد API Console شوند:
          </p>
          <ul className="mt-3 list-inside list-disc text-sm font-medium text-[var(--theme-text)]">
            {(deniedDetails?.requiredWorkspaces || ['medu-ai']).map(key => (
              <li key={key} dir="ltr">{key}</li>
            ))}
          </ul>
          {deniedDetails?.grantedWorkspaces?.length ? (
            <p className="mt-3 text-xs text-[var(--theme-text-subtle)]" dir="ltr">
              detected: {deniedDetails.grantedWorkspaces.join(', ')}
            </p>
          ) : (
            <p className="mt-3 text-xs text-[var(--theme-text-subtle)]">
              هنوز <span dir="ltr">medu-ai</span> در پروژه‌های دریافتی از CDE دیده نشد. با شماره/رمز وارد شوید یا دسترسی ورک‌اسپیس را بررسی کنید.
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void runProbe()}>
              <RefreshCw className="ml-1 h-4 w-4" />
              بررسی مجدد
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await sessionApi.logout();
                setProbeState('idle');
              }}
            >
              خروج
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
            {probeState === 'connected' ? 'در حال ورود…' : 'در حال بررسی نشست CDE…'}
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
            {sameSite
              ? 'اگر در همین مرورگر وارد CDE هستید، نشست از روی کوکی تشخیص داده می‌شود.'
              : 'برای توسعهٔ محلی از شماره همراه و رمز CDE استفاده کنید. ورود با کوکی فقط روی دامنهٔ مشترک با CDE فعال است.'}
          </p>
          <div className="mt-8 flex flex-wrap gap-2 text-xs text-white/55">
            <span className="rounded-full border border-white/15 px-3 py-1">CDE</span>
            <span className="rounded-full border border-white/15 px-3 py-1">workspace: medu-ai</span>
          </div>
        </div>

        <div className="ac-rise-delay space-y-4">
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
        </div>
      </div>
    </div>
  );
};
