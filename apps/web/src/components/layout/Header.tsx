import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { ROLE_LABELS } from '../../types';
import { MinimalLoader } from '../ui/Loading';
import { cn } from '../../utils/cn';

interface HeaderProps {
  title: string;
  subtitle?: string | undefined;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  actions?: React.ReactNode | undefined;
  onMenuClick?: (() => void) | undefined;
  /** Extra items inside the overflow / account menu (e.g. Self-check). */
  menuExtras?: React.ReactNode | undefined;
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

function HeaderIconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--theme-text-muted)] transition-colors',
        'hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onRefresh,
  refreshing,
  actions,
  onMenuClick,
  menuExtras,
}) => {
  const { activeContext, disconnect, catalog, authApproach } = useSessionStore();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const apiModule = catalog?.repositories.find(repository => repository.type === 'API_MODULE');
  const approachLabel = authApproach === 'IS' ? 'IS' : authApproach === 'LOCAL' ? 'Local' : authApproach === 'CDE' ? 'CDE' : null;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="z-30 shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-surface)]/90 px-3 py-2 backdrop-blur-md sm:px-5 lg:px-6">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
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
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="truncate text-base font-semibold tracking-tight text-[var(--theme-text)] sm:text-lg">
                {title}
              </h1>
              {approachLabel || apiModule ? (
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--theme-text-subtle)]">
                  {approachLabel ? (
                    <span className="rounded-md bg-[var(--theme-accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--theme-accent-ink)]">
                      {approachLabel}
                    </span>
                  ) : null}
                  {apiModule ? (
                    <span dir="ltr" className="truncate font-mono text-[10px] opacity-80">
                      {apiModule.repoName}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {subtitle ? (
              <p className="mt-0.5 hidden truncate text-xs text-[var(--theme-text-subtle)] xl:block">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {actions}

          <div className="mx-1 hidden h-4 w-px bg-[var(--theme-border)] sm:block" aria-hidden />

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="منوی حساب و تنظیمات"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen(open => !open)}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[var(--theme-text-muted)] transition-colors',
                'hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)]',
                menuOpen && 'bg-[var(--theme-surface-muted)] text-[var(--theme-text)]',
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--theme-accent)] text-[10px] font-semibold text-white">
                {(activeContext?.user.fullName || activeContext?.user.displayName || '?')
                  .trim()
                  .slice(0, 1)}
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 sm:block" />
              <MoreHorizontal className="h-4 w-4 sm:hidden" />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute left-0 z-40 mt-1.5 w-56 overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface-raised)] py-1 shadow-lg"
              >
                {activeContext ? (
                  <div className="border-b border-[var(--theme-border)] px-3 py-2.5">
                    <p className="truncate text-xs font-medium text-[var(--theme-text)]">
                      {activeContext.user.fullName || activeContext.user.displayName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--theme-text-subtle)]">
                      {ROLE_LABELS[activeContext.role]}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)]"
                  onClick={() => {
                    toggleTheme();
                    setIsDark(document.documentElement.classList.contains('dark'));
                    setMenuOpen(false);
                  }}
                >
                  {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {isDark ? 'تم روشن' : 'تم تیره'}
                </button>

                <a
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)]"
                  href="/api/docs"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMenuOpen(false)}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  مستندات API
                </a>

                {onRefresh ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={refreshing}
                    className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)] disabled:opacity-50"
                    onClick={() => {
                      onRefresh();
                      setMenuOpen(false);
                    }}
                  >
                    {refreshing ? <MinimalLoader size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    تازه‌سازی Workspace
                  </button>
                ) : null}

                {menuExtras ? (
                  <div
                    className="border-t border-[var(--theme-border)] py-1"
                    onClick={() => setMenuOpen(false)}
                  >
                    {menuExtras}
                  </div>
                ) : null}

                <div className="border-t border-[var(--theme-border)] py-1">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-[var(--theme-danger)] hover:bg-[var(--theme-surface-muted)]"
                    onClick={() => {
                      setMenuOpen(false);
                      void disconnect();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    خروج
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
};

/** Shared menu-row style for Header menuExtras. */
export function HeaderMenuItem({
  icon,
  children,
  onClick,
  disabled,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-right text-xs text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)] hover:text-[var(--theme-text)] disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

export { HeaderIconButton };
