import { useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { ActiveContext, UserRole } from '../../types';
import { ROLE_LABELS } from '../../types';
import type { ApiConsoleDirectoryUser } from '../../types/apiConsole';
import { apiConsoleApi } from '../../services/apiConsoleApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Table } from '../ui/Table';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { formatDate } from './consoleFormatters';

const ASSIGNABLE_DIRECTORY_ROLES: UserRole[] = [
  'SYSTEM_ADMIN',
  'TECH_LEAD',
  'QA_LEAD',
  'QA_SPECIALIST',
  'BA',
  'SECURITY_REVIEWER',
  'PRODUCT_OWNER',
  'DEVELOPER',
];

function roleLabel(role?: string): string {
  if (!role) return '-';
  return ROLE_LABELS[role as UserRole] || role;
}

export const UserManagementSection = ({
  users,
  loading,
  search,
  onSearch,
  onRefresh,
  onUsersChange,
  activeContext,
  onChangeRole,
}: {
  users: ApiConsoleDirectoryUser[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onUsersChange: (users: ApiConsoleDirectoryUser[]) => void;
  activeContext: ActiveContext;
  onChangeRole: (user: ApiConsoleDirectoryUser, role: UserRole, enabled: boolean) => void;
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    fullName: '',
    role: 'DEVELOPER' as UserRole,
  });
  const [resetTarget, setResetTarget] = useState<ApiConsoleDirectoryUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [actionSaving, setActionSaving] = useState(false);

  const normalizedSearch = search.trim().toLocaleLowerCase('fa-IR');
  const filteredUsers = normalizedSearch
    ? users.filter(user => [user.fullName, user.phoneNumber, user.username, ...user.roles.map(roleLabel)]
        .filter(Boolean)
        .some(value => String(value).toLocaleLowerCase('fa-IR').includes(normalizedSearch)))
    : users;

  const upsertUser = (updated: ApiConsoleDirectoryUser) => {
    onUsersChange(users.some(user => user.id === updated.id)
      ? users.map(user => user.id === updated.id ? updated : user)
      : [updated, ...users]);
  };

  const handleCreateLocal = async () => {
    setCreateSaving(true);
    try {
      const created = await apiConsoleApi.createLocalUser({
        username: createForm.username.trim(),
        password: createForm.password,
        fullName: createForm.fullName.trim() || createForm.username.trim(),
        role: createForm.role,
      }, activeContext);
      upsertUser(created);
      setCreateOpen(false);
      setCreateForm({ username: '', password: '', fullName: '', role: 'DEVELOPER' });
      toast.success(`کاربر محلی «${created.username || created.fullName}» ساخته شد.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ایجاد کاربر محلی ناموفق بود.');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleToggleActive = async (user: ApiConsoleDirectoryUser) => {
    if (user.source !== 'LOCAL') return;
    setActionSaving(true);
    try {
      const updated = await apiConsoleApi.patchLocalUser(user.id, { isActive: user.isActive === false }, activeContext);
      upsertUser(updated);
      toast.success(updated.isActive !== false ? 'کاربر فعال شد.' : 'کاربر غیرفعال شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تغییر وضعیت کاربر ناموفق بود.');
    } finally {
      setActionSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setActionSaving(true);
    try {
      const updated = await apiConsoleApi.resetLocalPassword(resetTarget.id, resetPassword, activeContext);
      upsertUser(updated);
      setResetTarget(null);
      setResetPassword('');
      toast.success('رمز عبور بازنشانی شد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'بازنشانی رمز ناموفق بود.');
    } finally {
      setActionSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">مدیریت کاربران</h2>
              <p className="mt-1 text-sm text-gray-500">
                کاربران CDE پس از نخستین ورود همگام می‌شوند. کاربران محلی را می‌توانید از همین‌جا بسازید، غیرفعال کنید یا رمزشان را عوض کنید.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>ایجاد کاربر محلی</Button>
              <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh} loading={loading}>
                بروزرسانی فهرست
              </Button>
            </div>
          </div>
          <Input
            aria-label="جستجوی کاربران"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="جستجو بر اساس نام، نام کاربری، شماره یا نقش"
            className="py-1.5 text-sm"
          />
        </div>
      </Card>

      <Table
        columns={[
          {
            key: 'fullName',
            title: 'نام کاربر',
            render: (user: ApiConsoleDirectoryUser) => (
              <div>
                <p className="font-medium text-gray-900">{user.fullName || user.id}</p>
                <p className="mt-1 font-mono text-xs text-gray-500" dir="ltr">
                  {user.username ? `@${user.username}` : (user.phoneNumber || '-')}
                </p>
                {user.isActive === false && <Badge variant="danger" size="sm">غیرفعال</Badge>}
              </div>
            ),
          },
          {
            key: 'source',
            title: 'منبع هویت',
            render: (user: ApiConsoleDirectoryUser) => (
              <Badge variant={user.source === 'LOCAL' ? 'success' : 'info'} size="sm">
                {user.source === 'LOCAL' ? 'LOCAL' : user.source === 'CDE' ? 'CDE' : user.source}
              </Badge>
            ),
          },
          {
            key: 'roles',
            title: 'نقش‌ها / اسکوپ',
            render: (user: ApiConsoleDirectoryUser) => (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-1">
                  {user.roles.map(role => (
                    <Badge key={role} variant={role === 'SYSTEM_ADMIN' ? 'success' : 'secondary'} size="sm">{roleLabel(role)}</Badge>
                  ))}
                  {user.isBootstrapAdmin && <Badge variant="warning" size="sm">bootstrap env</Badge>}
                </div>
                {(user.roleAssignments || [])
                  .filter(item => item.role !== 'DEVELOPER')
                  .map(item => (
                    <p key={`${item.role}-${item.applicationId}`} className="font-mono text-[10px] text-gray-500" dir="ltr">
                      {item.role} @ {item.applicationId || 'ALL'}
                    </p>
                  ))}
              </div>
            ),
          },
          {
            key: 'actions',
            title: 'عملیات',
            render: (user: ApiConsoleDirectoryUser) => (
              <div className="flex min-w-[240px] flex-col gap-2">
                <Select
                  aria-label={`نقش جدید برای ${user.fullName}`}
                  value=""
                  onChange={(event) => {
                    const role = event.target.value as UserRole;
                    if (!role || user.roles.includes(role)) return;
                    onChangeRole(user, role, true);
                    event.target.value = '';
                  }}
                  options={[
                    { value: '', label: 'افزودن نقش…' },
                    ...ASSIGNABLE_DIRECTORY_ROLES
                      .filter(role => role !== 'DEVELOPER' && !user.roles.includes(role))
                      .filter(role => !(role === 'SYSTEM_ADMIN' && user.isBootstrapAdmin))
                      .map(role => ({ value: role, label: roleLabel(role) })),
                  ]}
                />
                <div className="flex flex-wrap gap-1">
                  {user.roles
                    .filter(role => role !== 'DEVELOPER')
                    .map(role => (
                      <Button
                        key={role}
                        size="sm"
                        variant="danger"
                        disabled={(role === 'SYSTEM_ADMIN' && user.isBootstrapAdmin) || (role === 'QA_LEAD' && !!user.isBootstrapQaLead)}
                        onClick={(event) => {
                          event.stopPropagation();
                          onChangeRole(user, role, false);
                        }}
                      >
                        لغو {roleLabel(role)}
                      </Button>
                    ))}
                  {user.source === 'LOCAL' && (
                    <>
                      <Button size="sm" variant="secondary" disabled={actionSaving} onClick={() => setResetTarget(user)}>
                        Reset password
                      </Button>
                      <Button size="sm" variant="secondary" disabled={actionSaving} onClick={() => void handleToggleActive(user)}>
                        {user.isActive === false ? 'فعال‌سازی' : 'غیرفعال‌سازی'}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ),
          },
        ]}
        data={filteredUsers}
        loading={loading}
        emptyMessage="هنوز کاربری ثبت نشده است"
        enableClientFilter={false}
        enableColumnChooser={false}
        enableExport={false}
      />

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="ایجاد کاربر محلی" size="md">
        <div className="space-y-3">
          <Input label="نام کاربری" value={createForm.username} onChange={e => setCreateForm(prev => ({ ...prev, username: e.target.value }))} dir="ltr" />
          <Input label="نام نمایشی" value={createForm.fullName} onChange={e => setCreateForm(prev => ({ ...prev, fullName: e.target.value }))} />
          <Input label="رمز موقت" type="password" value={createForm.password} onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))} dir="ltr" />
          <Select
            label="نقش اولیه"
            value={createForm.role}
            onChange={e => setCreateForm(prev => ({ ...prev, role: e.target.value as UserRole }))}
            options={ASSIGNABLE_DIRECTORY_ROLES.map(role => ({ value: role, label: roleLabel(role) }))}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createSaving}>انصراف</Button>
            <Button onClick={() => void handleCreateLocal()} loading={createSaving}>ایجاد</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(resetTarget)} onClose={() => { setResetTarget(null); setResetPassword(''); }} title="بازنشانی رمز" size="md">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">کاربر: <span dir="ltr">{resetTarget?.username}</span></p>
          <Input label="رمز جدید" type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} dir="ltr" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setResetTarget(null); setResetPassword(''); }} disabled={actionSaving}>انصراف</Button>
            <Button onClick={() => void handleResetPassword()} loading={actionSaving} disabled={resetPassword.length < 8}>ذخیره</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
