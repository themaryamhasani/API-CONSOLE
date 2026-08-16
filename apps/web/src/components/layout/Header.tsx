import React from 'react';
import { ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { ROLE_LABELS } from '../../types';
import { MinimalLoader } from '../ui/Loading';
import { Select } from '../ui/Input';
import { Button } from '../ui/Button';

interface HeaderProps {
  title: string;
  subtitle?: string | undefined;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  actions?: React.ReactNode | undefined;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, onRefresh, refreshing, actions }) => {
  const {
    activeContext,
    projects,
    selectedProjectKey,
    selectProject,
    disconnect,
    catalog,
  } = useSessionStore();

  const apiModule = catalog?.repositories.find(repository => repository.type === 'API_MODULE');

  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-[var(--theme-border)] pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-[var(--theme-text)]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--theme-text-muted)]">{subtitle}</p> : null}
        {activeContext ? (
          <p className="mt-2 text-xs text-[var(--theme-text-subtle)]">
            {activeContext.user.fullName || activeContext.user.displayName} · {ROLE_LABELS[activeContext.role]}
            {apiModule ? ` · API Module: ${apiModule.repoName} (${apiModule.packages.length})` : ''}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {projects.length > 0 ? (
          <div className="min-w-[220px]">
            <Select
              label="پروژه CDE"
              value={selectedProjectKey}
              onChange={(event) => { void selectProject(event.target.value); }}
              options={projects.map(project => ({
                value: project.projectKey,
                label: project.projectKey,
              }))}
            />
          </div>
        ) : null}
        <a
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]"
          href="/api/docs"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="h-4 w-4" />
          Swagger
        </a>
        {onRefresh ? (
          <Button variant="secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <MinimalLoader size="sm" /> : <RefreshCw className="h-4 w-4" />}
            بروزرسانی
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => { void disconnect(); }}>
          <LogOut className="h-4 w-4" />
          قطع CDE
        </Button>
        {actions}
      </div>
    </header>
  );
};
