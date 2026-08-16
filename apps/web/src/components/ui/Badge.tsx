import React from 'react';
import { cn } from '../../utils/cn';
interface BadgeProps {
    children: React.ReactNode;
    variant?: ('default' | 'success' | 'warning' | 'danger' | 'info' | 'secondary') | undefined;
    size?: ('sm' | 'md') | undefined;
    className?: string | undefined;
}
export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', size = 'md', className, }) => {
    const variants = {
        default: 'bg-gray-100 text-gray-700',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-amber-100 text-amber-700',
        danger: 'bg-red-100 text-red-700',
        info: 'bg-blue-100 text-blue-700',
        secondary: 'bg-purple-100 text-purple-700',
    };
    const sizes = {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-1 text-sm',
    };
    return (<span className={cn('inline-flex items-center font-medium rounded-full', variants[variant], sizes[size], className)}>
      {children}
    </span>);
};
// Status badge helper component
interface StatusBadgeProps {
    status: string;
    labels: Record<string, string>;
    className?: string | undefined;
}
const statusColors: Record<string, BadgeProps['variant']> = {
    // Test Request
    DRAFT: 'secondary',
    SUBMITTED: 'info',
    UNDER_REVIEW: 'warning',
    ACCEPTED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'default',
    IN_PROGRESS: 'info',
    COMPLETED: 'success',
    // Bug
    NEW: 'info',
    ASSIGNED: 'warning',
    FIXED: 'info',
    RETEST_READY: 'warning',
    RETEST_PASSED: 'success',
    RETEST_FAILED: 'danger',
    REOPENED: 'danger',
    CLOSED: 'default',
    NO_ACTION_NEEDED: 'default',
    // Test Run
    PENDING: 'secondary',
    PASSED: 'success',
    FAILED: 'danger',
    BLOCKED: 'warning',
    SKIPPED: 'default',
    // Playwright
    RUNNING: 'info',
    ERROR: 'danger',
    // Release
    QA_REVIEW: 'info',
    PENDING_DECISION: 'warning',
    APPROVED: 'success',
    CONDITIONAL: 'warning',
    EMERGENCY: 'danger',
    PUBLISHED: 'success',
    // Checklist
    NOT_APPLICABLE: 'default',
    // Requirement
    // Priority
    CRITICAL: 'danger',
    HIGH: 'warning',
    MEDIUM: 'info',
    LOW: 'default',
    // QA Quality
    NOT_STARTED: 'default',
    READY: 'success',
    NOT_READY: 'danger',
};
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, labels, className }) => {
    return (<Badge variant={statusColors[status] || 'default'} className={className}>
      {labels[status] || status}
    </Badge>);
};
// Priority badge
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
    return (<Badge variant={statusColors[priority] || 'default'} className={className}>
      {priorityLabels[priority] || priority}
    </Badge>);
};

