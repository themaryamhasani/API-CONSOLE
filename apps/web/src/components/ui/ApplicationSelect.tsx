import React from 'react';
import { Select } from './Input';
import { cn } from '../../utils/cn';
import { useApplicationLookup } from '../../utils/useApplicationLookup';

export interface ApplicationSelectProps {
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  /** When true, adds an "ALL" option for unrestricted assignment. */
  includeAllOption?: boolean | undefined;
  allOptionLabel?: string | undefined;
}

export const ApplicationSelect: React.FC<ApplicationSelectProps> = ({
  value,
  onChange,
  label = 'سامانه',
  required = false,
  disabled = false,
  error,
  hint,
  className,
  includeAllOption = false,
  allOptionLabel = 'همه سامانه‌ها (ALL)',
}) => {
  const { applications, loading } = useApplicationLookup();
  const hasApplications = applications.length > 0 || includeAllOption;
  const placeholder = loading
    ? 'در حال بارگذاری سامانه‌ها…'
    : hasApplications
      ? 'سامانه را انتخاب کنید'
      : 'سامانه‌ای در محدوده دسترسی یافت نشد';

  const options = [
    ...(includeAllOption ? [{ value: 'ALL', label: allOptionLabel }] : []),
    ...applications.map(application => ({
      value: application.id,
      label: application.code
        ? `${application.name} (${application.code})`
        : application.name,
    })),
  ];

  return (
    <div className={cn('w-full', className)}>
      <Select
        label={`${label}${required ? ' *' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
        placeholder={placeholder}
        required={required}
        disabled={disabled || loading || !hasApplications}
        error={error}
        aria-busy={loading || undefined}
      />
      {hint && !error && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
    </div>
  );
};
