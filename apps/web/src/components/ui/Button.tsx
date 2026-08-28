import React from 'react';
import { cn } from '../../utils/cn';
import { MinimalLoader } from './Loading';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ('primary' | 'secondary' | 'danger' | 'warning' | 'ghost' | 'outline') | undefined;
  size?: ('sm' | 'md' | 'lg') | undefined;
  loading?: boolean | undefined;
  icon?: React.ReactNode | undefined;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  disabled,
  ...props
}) => {
  const baseStyles =
    'no-text-break inline-flex min-w-fit max-w-full items-center justify-center text-center font-medium leading-5 whitespace-nowrap rounded-lg transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-canvas)] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';
  const variants = {
    primary:
      'bg-[var(--theme-accent)] text-white hover:bg-[var(--theme-accent-hover)] shadow-sm',
    secondary:
      'bg-[var(--theme-surface-muted)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-subtle)] border border-[var(--theme-border)]',
    danger: 'bg-[var(--theme-danger)] text-white hover:opacity-90',
    warning: 'bg-[var(--theme-warning)] text-white hover:opacity-90',
    ghost: 'bg-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]',
    outline:
      'border border-[var(--theme-border-strong)] bg-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-surface-muted)]',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-3.5 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2',
  };
  return (
    <button
      type={props.type ?? 'button'}
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <MinimalLoader size="sm" /> : icon ? <span className="flex-shrink-0">{icon}</span> : null}
      {children}
    </button>
  );
};
