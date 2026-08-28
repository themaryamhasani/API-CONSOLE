import React, { useState } from 'react';
import { ExternalLink, LogOut, Menu, Moon, RefreshCw, Sun } from 'lucide-react';
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
  onMenuClick?: (() => void) | undefined;
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.classList.contains('dark') ? 'light' : 'dark';
  root.classList.toggle('dark', next === 'dark');
  root.dataset.theme = next;
  root.style.colorScheme = next;
  try {
    localStorage.setItem('api-console-theme', next);
  } catch {
    /* ignore */
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', next === 'dark' ? '#0b1016' : '#eef1f4');
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onRefresh,
  refreshing,
  actions,
  onMenuClick,
}) => {
  const {
    activeContext,
    projects,
    selectedProjectKey,
    selectProject,
    disconnect,
    catalog,
  } = useSessionStore();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  const apiModule = catalog?.repositories.find(repository => repository.type === 'API_MODULE');

  return (
    <header className="z-30 shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]/90 px-3 py-2 backdrop-blur-md sm:px-5 lg:px-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {onMenuClick ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--theme-border)] p-2 text-[var(--theme-text-muted)] lg:hidden"
              onClick={onMenuClick}
              aria-label="باز کردن منو"
            >
              <Menu className="h-4 w-4" />
            </button>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h1 className="text-base font-semibold tracking-tight text-[var(--theme-text)] sm:text-lg">{title}</h1>
              {activeContext ? (
                <p className="text-[11px] text-[var(--theme-text-subtle)]">
                  {activeContext.user.fullName || activeContext.user.displayName}
                  <span className="mx-1.5 opacity-40">·</span>
                  {ROLE_LABELS[activeContext.role]}
                  {apiModule ? (
                    <>
                      <span className="mx-1.5 opacity-40">·</span>
                      <span dir="ltr" className="font-mono text-[10px]">
                        {apiModule.repoName}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            {subtitle ? <p className="mt-0.5 hidden text-xs text-[var(--theme-text-subtle)] xl:block">{subtitle}</p> : null}
          </div>
        </div>

        <div className="ac-toolbar justify-end">
          {projects.length > 0 ? (
            <div className="min-w-[160px]">
              <Select
                aria-label="پروژه"
                value={selectedProjectKey}
                onChange={event => {
                  void selectProject(event.target.value);
                }}
                options={projects.map(project => ({
                  value: project.projectKey,
                  label: project.projectKey,
                }))}
              />
            </div>
          ) : null}
          <a
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--theme-border)] px-3 py-2 text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Docs
          </a>
          <Button
            variant="ghost"
            size="sm"
            aria-label="تغییر تم"
            onClick={() => {
              toggleTheme();
              setIsDark(document.documentElement.classList.contains('dark'));
            }}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {onRefresh ? (
            <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? <MinimalLoader size="sm" /> : <RefreshCw className="h-4 w-4" />}
              تازه‌سازی
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void disconnect();
            }}
          >
            <LogOut className="h-4 w-4" />
            خروج
          </Button>
          {actions}
        </div>
      </div>
    </header>
  );
};
