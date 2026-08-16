import React from 'react';
import { cn } from '../../utils/cn';
type LoaderSize = 'xs' | 'sm' | 'md';
interface MinimalLoaderProps {
    size?: LoaderSize | undefined;
    label?: string | undefined;
    className?: string | undefined;
}
const loaderSizes: Record<LoaderSize, string> = {
    xs: 'h-3 w-3 border',
    sm: 'h-4 w-4 border-2',
    md: 'h-5 w-5 border-2',
};
export const MinimalLoader: React.FC<MinimalLoaderProps> = ({ size = 'sm', label, className }) => (<span className={cn('inline-flex items-center gap-2 text-current', className)} role="status" aria-live="polite">
    <span className={cn('inline-block rounded-full border-current border-t-transparent animate-spin', loaderSizes[size])}/>
    {label && <span className="text-sm">{label}</span>}
  </span>);
interface LoadingStateProps {
    label?: string | undefined;
    className?: string | undefined;
}
export const LoadingState: React.FC<LoadingStateProps> = ({ label = 'در حال بارگذاری...', className }) => (<div className={cn('flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-sm text-gray-500', className)}>
    <MinimalLoader size="sm"/>
    <span>{label}</span>
  </div>);

