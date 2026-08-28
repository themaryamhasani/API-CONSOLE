import React from 'react';
import { cn } from '../../utils/cn';

interface BadgeProps {
  children: React.ReactNode;
  variant?: ('default' | 'success' | 'warning' | 'danger' | 'info' | 'secondary') | undefined;
  size?: ('sm' | 'md') | undefined;
  className?: string | undefined;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className,
}) => {
  const variants = {
    default: 'bg-[var(--theme-surface-muted)] text-[var(--theme-text-muted)] border border-[var(--theme-border)]',
    success: 'bg-emerald-50 text-emerald-800 border border-emerald-100',
    warning: 'bg-amber-50 text-amber-800 border border-amber-100',
    danger: 'bg-red-50 text-red-800 border border-red-100',
    info: 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-ink)] border border-[var(--theme-accent)]/20',
    secondary: 'bg-[var(--theme-surface-subtle)] text-[var(--theme-text-subtle)] border border-[var(--theme-border)]',
  };
  const sizes = {
    sm: 'px-2 py-0.5 text-[11px]',
    md: 'px-2.5 py-0.5 text-xs',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-medium tracking-tight',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </span>
  );
};

interface StatusBadgeProps {
  status: string;
  labels: Record<string, string>;
  className?: string | undefined;
}

const statusColors: Record<string, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'default',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  NEW: 'info',
  ASSIGNED: 'warning',
  FIXED: 'info',
  RETEST_READY: 'warning',
  RETEST_PASSED: 'success',
  RETEST_FAILED: 'danger',
  REOPENED: 'danger',
  CLOSED: 'default',
  NO_ACTION_NEEDED: 'default',
  PENDING: 'secondary',
  PASSED: 'success',
  FAILED: 'danger',
  BLOCKED: 'warning',
  SKIPPED: 'default',
  RUNNING: 'info',
  ERROR: 'danger',
  QA_REVIEW: 'info',
  PENDING_DECISION: 'warning',
  APPROVED: 'success',
  CONDITIONAL: 'warning',
  EMERGENCY: 'danger',
  PUBLISHED: 'success',
  NOT_APPLICABLE: 'default',
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'default',
  NOT_STARTED: 'default',
  READY: 'success',
  NOT_READY: 'danger',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, labels, className }) => {
  return (
    <Badge variant={statusColors[status] || 'default'} className={className}>
      {labels[status] || status}
    </Badge>
  );
};

interface PriorityBadgeProps {
  priority: string;
  className?: string | undefined;
}

const priorityLabels: Record<string, string> = {
  CRITICAL: 'بحرانی',
  HIGH: 'بالا',
  MEDIUM: 'متوسط',
  LOW: 'پایین',
};

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority, className }) => {
  return (
    <Badge variant={statusColors[priority] || 'default'} className={className}>
      {priorityLabels[priority] || priority}
    </Badge>
  );
};
