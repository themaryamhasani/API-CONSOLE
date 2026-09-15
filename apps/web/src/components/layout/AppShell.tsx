import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  Boxes,
  ClipboardCheck,
  FileSearch,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  Scale,
  Server,
  Settings2,
  Shield,
  Users,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { ROLE_LABELS } from '../../types';
import { useSessionStore } from '../../stores/sessionStore';

export type WorkspaceNavId =
  | 'requests'
  | 'repository'
  | 'runtime'
  | 'environments'
  | 'activity'
  | 'mocks'
  | 'jit'
  | 'reports'
  | 'reviews'
  | 'users'
  | 'runners'
  | 'branding'
  | 'org-policy'
  | 'compliance'
  | 'audit';

type NavItem = {
  id: WorkspaceNavId;
  label: string;
  icon: ReactNode;
  hidden?: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export function buildWorkspaceNav(opts: {
  canManageEnvironments: boolean;
  canEdit: boolean;
  canReviewShares: boolean;
  canManageGeneralSettings: boolean;
  isSystemAdmin: boolean;
  canViewUsageReports: boolean;
  authApproach?: 'CDE' | 'IS' | 'LOCAL' | null;
}): NavGroup[] {
  const isLocal = opts.authApproach === 'LOCAL';
  const groups: NavGroup[] = [
    {
      title: 'کار روزانه',
      items: [
        { id: 'requests' as const, label: 'درخواست‌ها', icon: <LayoutDashboard className="h-4 w-4" /> },
        {
          id: 'repository' as const,
          label: 'مخزن',
          icon: <BookOpen className="h-4 w-4" />,
          hidden: isLocal,
        },
        {
          id: 'runtime' as const,
          label: 'Runtime',
          icon: <PlayCircle className="h-4 w-4" />,
          hidden: isLocal,
        },
        {
          id: 'environments' as const,
          label: 'محیط‌ها',
          icon: <Boxes className="h-4 w-4" />,
          hidden: !opts.canManageEnvironments,
        },
      ],
    },
    {
      title: 'همکاری',
      items: [
        { id: 'activity' as const, label: 'فعالیت', icon: <Activity className="h-4 w-4" /> },
        {
          id: 'reviews' as const,
          label: 'بازبینی Share',
          icon: <ClipboardCheck className="h-4 w-4" />,
          hidden: !opts.canReviewShares,
        },
        { id: 'mocks' as const, label: 'Mock', icon: <Server className="h-4 w-4" />, hidden: !opts.canEdit },
        { id: 'jit' as const, label: 'دسترسی JIT', icon: <KeyRound className="h-4 w-4" /> },
      ],
    },
    {
      title: 'بینش',
      items: [
        { id: 'reports' as const, label: 'گزارش‌ها', icon: <FileSearch className="h-4 w-4" /> },
        {
          id: 'compliance' as const,
          label: 'انطباق',
          icon: <Scale className="h-4 w-4" />,
          hidden: !opts.canViewUsageReports && !opts.isSystemAdmin,
        },
        {
          id: 'audit' as const,
          label: 'ممیزی',
          icon: <Shield className="h-4 w-4" />,
          hidden: !opts.canManageGeneralSettings,
        },
      ],
    },
    {
      title: 'ادمین',
      items: [
        {
          id: 'users' as const,
          label: 'کاربران',
          icon: <Users className="h-4 w-4" />,
          hidden: !opts.canManageGeneralSettings,
        },
        {
          id: 'runners' as const,
          label: 'Runnerها',
          icon: <FolderKanban className="h-4 w-4" />,
          hidden: !opts.isSystemAdmin,
        },
        {
          id: 'branding' as const,
          label: 'برندینگ',
          icon: <Settings2 className="h-4 w-4" />,
          hidden: !opts.isSystemAdmin,
        },
        {
          id: 'org-policy' as const,
          label: 'سیاست سازمان',
          icon: <Scale className="h-4 w-4" />,
          hidden: !opts.isSystemAdmin,
        },
      ],
    },
  ];

  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item => !item.hidden),
    }))
    .filter(group => group.items.length > 0);
}

interface AppShellProps {
  children: ReactNode;
  activeView?: WorkspaceNavId;
  onNavigate?: (id: WorkspaceNavId) => void;
  navGroups?: NavGroup[];
  topBar?: ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function AppShell({
  children,
  activeView,
  onNavigate,
  navGroups = [],
  topBar,
  mobileOpen = false,
  onMobileClose,
}: AppShellProps) {
  const location = useLocation();
  const activeContext = useSessionStore(state => state.activeContext);
  const isPortal = location.pathname.startsWith('/portal');

  return (
    <div className="ac-shell">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-label="بستن منو"
          onClick={onMobileClose}
        />
      ) : null}

      <aside
        className={cn(
          'ac-sidebar fixed inset-y-0 right-0 z-50 w-[15.5rem] lg:static lg:z-auto',
          mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
          'transition-transform duration-200',
        )}
      >
        <div className="shrink-0 border-b border-white/5 px-4 py-3.5">
          <Link to="/" className="block" onClick={onMobileClose}>
            <p className="font-display text-lg font-bold tracking-tight text-white">API Console</p>
          </Link>
          {activeContext ? (
            <div className="mt-3 rounded-xl bg-white/5 px-3 py-2">
              <p className="truncate text-xs font-medium text-white">
                {activeContext.user.fullName || activeContext.user.displayName}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--theme-sidebar-muted)]">
                {ROLE_LABELS[activeContext.role]}
              </p>
            </div>
          ) : null}
        </div>

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3" aria-label="منوی اصلی">
          <div>
            <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--theme-sidebar-muted)] uppercase">
              میانبر
            </p>
            <Link
              to="/portal"
              onClick={onMobileClose}
              className={cn('ac-nav-item', isPortal && 'is-active')}
            >
              <BookOpen className="h-4 w-4" />
              پورتال عمومی
            </Link>
          </div>

          {navGroups.map(group => (
            <div key={group.title}>
              <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--theme-sidebar-muted)] uppercase">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn('ac-nav-item', activeView === item.id && !isPortal && 'is-active')}
                    onClick={() => {
                      onNavigate?.(item.id);
                      onMobileClose?.();
                    }}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="ac-main-column">
        {topBar}
        <div className="ac-main-scroll">{children}</div>
      </div>
    </div>
  );
}
