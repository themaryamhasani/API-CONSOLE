import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useSessionStore } from '../stores/sessionStore';

export const WorkspaceDeniedPage: React.FC = () => {
  const navigate = useNavigate();
  const workspaceAccess = useSessionStore(state => state.workspaceAccess);
  const activeContext = useSessionStore(state => state.activeContext);
  const logout = useSessionStore(state => state.logout);
  const bootstrap = useSessionStore(state => state.bootstrap);

  const required = workspaceAccess?.requiredWorkspaces?.length
    ? workspaceAccess.requiredWorkspaces
    : ['medu-ai'];
  const granted = workspaceAccess?.grantedWorkspaces || [];
  const displayName = activeContext?.user?.displayName || activeContext?.user?.fullName || 'کاربر';

  return (
    <div className="ac-login-stage">
      <div className="relative z-10 mx-auto w-full max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 shadow-2xl dark:bg-[var(--theme-surface)]/95">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-200">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--theme-text)]">عدم دسترسی به ورک‌اسپیس</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--theme-text-muted)]">
          {displayName} عزیز، حساب شما به ورک‌اسپیس‌های لازم برای استفاده از API Console دسترسی ندارد.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-muted)] px-3 py-3 text-sm">
          <p className="font-medium text-[var(--theme-text)]">ورک‌اسپیس‌های لازم</p>
          <ul className="mt-1 list-inside list-disc" dir="ltr">
            {required.map(key => <li key={key}>{key}</li>)}
          </ul>
          <p className="mt-3 font-medium text-[var(--theme-text)]">ورک‌اسپیس‌های فعلی شما</p>
          {granted.length ? (
            <ul className="mt-1 list-inside list-disc" dir="ltr">
              {granted.map(key => <li key={key}>{key}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-[var(--theme-text-subtle)]">موردی یافت نشد.</p>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={async () => {
              await bootstrap();
              const access = useSessionStore.getState().workspaceAccess;
              if (access?.allowed && useSessionStore.getState().activeContext) {
                navigate('/', { replace: true });
              }
            }}
          >
            <RefreshCw className="ml-1 h-4 w-4" />
            بررسی مجدد
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            خروج
          </Button>
        </div>
      </div>
    </div>
  );
};
