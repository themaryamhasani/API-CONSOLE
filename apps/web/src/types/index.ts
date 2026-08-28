export type UserRole =
  | 'SYSTEM_ADMIN'
  | 'DEVELOPER'
  | 'QA_LEAD'
  | 'QA_SPECIALIST'
  | 'BA'
  | 'SECURITY_REVIEWER'
  | 'TECH_LEAD'
  | 'PRODUCT_OWNER';

export const ROLE_LABELS: Record<UserRole, string> = {
  SYSTEM_ADMIN: 'مدیر سیستم',
  DEVELOPER: 'توسعه‌دهنده',
  QA_LEAD: 'سرپرست QA',
  QA_SPECIALIST: 'متخصص QA',
  BA: 'تحلیلگر کسب‌وکار',
  SECURITY_REVIEWER: 'بازبین امنیت',
  TECH_LEAD: 'سرپرست فنی',
  PRODUCT_OWNER: 'مالک محصول',
};

export type AccessScope = 'APP' | 'SYSTEMS';
export type ApplicationScopeFilter = string | string[] | undefined;

export interface Application {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

export interface User {
  id: string;
  phoneNumber: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActiveContext {
  contextId: string;
  userId: string;
  user: User;
  assignmentId: string;
  assignmentIds: string[];
  applicationId: string;
  scopeApplicationIds: string[];
  application: Application;
  applications: Application[];
  role: UserRole;
  scope: AccessScope;
  automatedTestsEnabled?: boolean;
  token: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type?: string;
  entityType?: string;
  entityId?: string;
  correlationId?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}

export interface NotificationListResponse extends PaginatedResponse<Notification> {
  unreadCount: number;
}

export interface ApiAuditEvent {
  id: string;
  eventType: string;
  actorUserId: string;
  actorRole: string;
  details: Record<string, unknown>;
  createdAt: string;
}
