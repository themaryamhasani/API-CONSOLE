import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PlatformApiError, cdeApi, sessionApi, setCsrfToken } from '../services/cdeApi';
import { useSessionStore } from '../stores/sessionStore';
import { consumeReturnTo } from '../utils/returnTo';

/**
 * Legacy callback route. CDE does not redirect to external absolute return URLs,
 * so this page mainly re-probes cookies (same-site) or sends the user to /login.
 */
export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const bootstrap = useSessionStore(state => state.bootstrap);
  const refreshProjects = useSessionStore(state => state.refreshProjects);
  const selectProject = useSessionStore(state => state.selectProject);
  const setWorkspaceAccess = useSessionStore(state => state.setWorkspaceAccess);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await sessionApi.current();
        if (session.csrfToken) setCsrfToken(session.csrfToken);
        const config = await cdeApi.ssoConfig();
        if (!config.cookieForwardAvailable) {
          navigate('/login?sso=unavailable', { replace: true });
          return;
        }
        const result = await cdeApi.ssoProbe();
        if (cancelled) return;
        if (result.csrfToken) setCsrfToken(result.csrfToken);
        if (result.workspaceAccess) setWorkspaceAccess(result.workspaceAccess);
        if (result.connected) {
          const projects = await refreshProjects();
          if (projects[0]) await selectProject(projects[0].projectKey);
          await bootstrap();
          navigate(consumeReturnTo(), { replace: true });
          return;
        }
        navigate('/login', { replace: true });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof PlatformApiError && error.code === 'WORKSPACE_ACCESS_DENIED') {
          const details = (error.details || {}) as {
            requiredWorkspaces?: string[];
            grantedWorkspaces?: string[];
            mode?: string;
          };
          setWorkspaceAccess({
            allowed: false,
            requiredWorkspaces: details.requiredWorkspaces || ['medu-ai'],
            grantedWorkspaces: details.grantedWorkspaces || [],
            mode: details.mode,
          });
          navigate('/access-denied', { replace: true });
          return;
        }
        navigate('/login?sso=unavailable', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrap, navigate, refreshProjects, selectProject, setWorkspaceAccess]);

  return (
    <div className="ac-login-stage">
      <div className="relative z-10 flex flex-col items-center gap-3 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm text-white/80">در حال بررسی نشست…</p>
      </div>
    </div>
  );
};
