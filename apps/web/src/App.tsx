import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import { LoadingState } from './components/ui/Loading';
import { LandingPage } from './pages/LandingPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { WorkspaceDeniedPage } from './pages/WorkspaceDeniedPage';
import { OnlineApiConsolePage } from './pages/OnlineApiConsolePage';
import { PortalPage } from './pages/PortalPage';
import { PublicPortalPage } from './pages/PublicPortalPage';
import { useSessionStore } from './stores/sessionStore';

function Gate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const bootstrapped = useSessionStore(state => state.bootstrapped);
  const loading = useSessionStore(state => state.loading);
  const activeContext = useSessionStore(state => state.activeContext);
  const authenticated = useSessionStore(state => state.authenticated);
  const cdeConnected = useSessionStore(state => state.cdeConnected);
  const isConnected = useSessionStore(state => state.isConnected);
  const workspaceAccess = useSessionStore(state => state.workspaceAccess);
  const bootstrap = useSessionStore(state => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!bootstrapped || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="در حال آماده‌سازی API Console…" />
      </div>
    );
  }

  const signedIn = Boolean(authenticated || ((cdeConnected || isConnected) && activeContext));
  if (cdeConnected && workspaceAccess && !workspaceAccess.allowed) {
    return <Navigate to="/access-denied" replace />;
  }
  if (!signedIn || !activeContext) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<LandingPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/access-denied" element={<WorkspaceDeniedPage />} />
        <Route path="/" element={<Gate><OnlineApiConsolePage /></Gate>} />
        <Route path="/api-console" element={<Gate><OnlineApiConsolePage /></Gate>} />
        <Route path="/portal" element={<Gate><PortalPage /></Gate>} />
        <Route path="/portal/shared/:token" element={<PublicPortalPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
