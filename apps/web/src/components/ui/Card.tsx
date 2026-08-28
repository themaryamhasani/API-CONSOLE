import React from 'react';
import { cn } from '../../utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string | undefined;
  padding?: ('none' | 'sm' | 'md' | 'lg') | undefined;
}

export const Card: React.FC<CardProps> = ({ children, className, padding = 'md' }) => {
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
  };
  return (
    <div className={cn('ac-surface min-w-0 max-w-full', paddings[padding], className)}>
      {children}
    </div>
  );
};

interface CardHeaderProps {
  title: string;
  subtitle?: string | undefined;
  action?: React.ReactNode | undefined;
  className?: string | undefined;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, subtitle, action, className }) => {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0 flex-1">
        <h3 className="ac-page-title text-base">{title}</h3>
        {subtitle && <p className="ac-page-sub">{subtitle}</p>}
      </div>
      {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
};

interface StatCardProps {
  title: string;
  value: number | string;
  icon?: React.ReactNode | undefined;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  } | undefined;
  variant?: ('default' | 'primary' | 'success' | 'warning' | 'danger') | undefined;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  trend,
  variant = 'default',
}) => {
  const variants = {
    default: 'border-[var(--theme-border)] bg-[var(--theme-surface-raised)]',
    primary: 'border-[var(--theme-accent)]/25 bg-[var(--theme-accent-soft)]',
    success: 'border-emerald-200 bg-emerald-50/80',
    warning: 'border-amber-200 bg-amber-50/80',
    danger: 'border-red-200 bg-red-50/80',
  };
  const iconVariants = {
    default: 'bg-[var(--theme-surface-muted)] text-[var(--theme-text-muted)]',
    primary: 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent-ink)]',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-red-100 text-red-700',
  };
  return (
    <div className={cn('min-w-0 rounded-[var(--theme-radius)] border p-4', variants[variant])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-[var(--theme-text-subtle)]">{title}</p>
          <p className="font-display text-2xl font-semibold tracking-tight text-[var(--theme-text)]">{value}</p>
          {trend && (
            <div className="mt-1 flex items-center text-sm">
              <span className={trend.positive ? 'text-emerald-600' : 'text-red-600'}>
                {trend.positive ? '↑' : '↓'} {trend.value}%
              </span>
              <span className="mr-1 text-[var(--theme-text-subtle)]">{trend.label}</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('flex-shrink-0 rounded-lg p-2', iconVariants[variant])}>{icon}</div>
        )}
      </div>
    </div>
  );
};
