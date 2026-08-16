import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastContainer } from './components/ui/Toast';
import { LoadingState } from './components/ui/Loading';
import { CdeLoginPage } from './pages/CdeLoginPage';
import { OnlineApiConsolePage } from './pages/OnlineApiConsolePage';
import { useSessionStore } from './stores/sessionStore';

function Gate() {
  const bootstrapped = useSessionStore(state => state.bootstrapped);
  const loading = useSessionStore(state => state.loading);
  const activeContext = useSessionStore(state => state.activeContext);
  const cdeConnected = useSessionStore(state => state.cdeConnected);
  const bootstrap = useSessionStore(state => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!bootstrapped || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--theme-canvas)]">
        <LoadingState label="در حال آماده‌سازی API Console…" />
      </div>
    );
  }

  if (!cdeConnected || !activeContext) {
    return <CdeLoginPage />;
  }

  return <OnlineApiConsolePage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastContainer />
      <Routes>
        <Route path="/" element={<Gate />} />
        <Route path="/api-console" element={<Gate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
