import React from 'react';
import { cn } from '../../utils/cn';
import { MinimalLoader } from './Loading';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ('primary' | 'secondary' | 'danger' | 'warning' | 'ghost' | 'outline') | undefined;
    size?: ('sm' | 'md' | 'lg') | undefined;
    loading?: boolean | undefined;
    icon?: React.ReactNode | undefined;
}
export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', size = 'md', loading = false, icon, className, disabled, ...props }) => {
    const baseStyles = 'no-text-break inline-flex min-w-fit max-w-full items-center justify-center text-center font-medium leading-5 whitespace-nowrap rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
    const variants = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
        secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500',
        danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
        warning: 'bg-amber-700 text-white hover:bg-amber-800 focus:ring-amber-500',
        ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-500',
        outline: 'border-2 border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-gray-500',
    };
    const sizes = {
        sm: 'px-3 py-1.5 text-sm gap-1.5',
        md: 'px-4 py-2 text-sm gap-2',
        lg: 'px-6 py-3 text-base gap-2',
    };
    return (<button type={props.type ?? 'button'} className={cn(baseStyles, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading ? (<MinimalLoader size="sm"/>) : icon ? (<span className="flex-shrink-0">{icon}</span>) : null}
      {children}
    </button>);
};
