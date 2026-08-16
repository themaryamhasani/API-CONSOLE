import React from 'react';
import { cn } from '../../utils/cn';
interface CardProps {
    children: React.ReactNode;
    className?: string | undefined;
    padding?: ('none' | 'sm' | 'md' | 'lg') | undefined;
}
export const Card: React.FC<CardProps> = ({ children, className, padding = 'md', }) => {
    const paddings = {
        none: '',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
    };
    return (<div className={cn('min-w-0 max-w-full bg-white rounded-xl border border-gray-200 shadow-sm', paddings[padding], className)}>
      {children}
    </div>);
};
interface CardHeaderProps {
    title: string;
    subtitle?: string | undefined;
    action?: React.ReactNode | undefined;
    className?: string | undefined;
}
export const CardHeader: React.FC<CardHeaderProps> = ({ title, subtitle, action, className, }) => {
    return (<div className={cn('flex flex-wrap items-start justify-between gap-3 mb-4', className)}>
      <div className="min-w-0 flex-1">
        <h3 className="break-words text-lg font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
    </div>);
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
export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, trend, variant = 'default', }) => {
    const variants = {
        default: 'bg-white border-gray-200',
        primary: 'bg-blue-50 border-blue-200',
        success: 'bg-green-50 border-green-200',
        warning: 'bg-amber-50 border-amber-200',
        danger: 'bg-red-50 border-red-200',
    };
    const iconVariants = {
        default: 'bg-gray-100 text-gray-600',
        primary: 'bg-blue-100 text-blue-600',
        success: 'bg-green-100 text-green-600',
        warning: 'bg-amber-100 text-amber-600',
        danger: 'bg-red-100 text-red-600',
    };
    return (<div className={cn('min-w-0 rounded-xl border p-4', variants[variant])}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-gray-700 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {trend && (<div className="flex items-center mt-1 text-sm">
              <span className={trend.positive ? 'text-green-600' : 'text-red-600'}>
                {trend.positive ? '↑' : '↓'} {trend.value}%
              </span>
              <span className="text-gray-700 mr-1">{trend.label}</span>
            </div>)}
        </div>
        {icon && (<div className={cn('flex-shrink-0 p-2 rounded-lg', iconVariants[variant])}>
            {icon}
          </div>)}
      </div>
    </div>);
};
