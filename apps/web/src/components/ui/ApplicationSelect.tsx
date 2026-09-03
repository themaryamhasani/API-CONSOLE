import React, { useMemo } from 'react';
import { SearchableSelect } from './Input';
import { cn } from '../../utils/cn';
import { useApplicationLookup } from '../../utils/useApplicationLookup';
import { PERSONAL_APPLICATION_ID, PERSONAL_APPLICATION_LABEL } from '../../types/apiConsole';

export interface ApplicationSelectProps {
  value: string;
  onChange: (id: string) => void;
  label?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
  searchPlaceholder?: string | undefined;
  size?: 'sm' | 'md' | undefined;
  clearable?: boolean | undefined;
  /** When true, adds an "ALL" option for unrestricted assignment. */
  includeAllOption?: boolean | undefined;
  allOptionLabel?: string | undefined;
  /** Empty option for optional system selection (filter / unbound create). */
  includeEmptyOption?: boolean | undefined;
  emptyOptionLabel?: string | undefined;
  /** Personal / free-form bucket not tied to a CDE system. */
  includePersonalOption?: boolean | undefined;
  personalOptionLabel?: string | undefined;
  /** Hide CDE project list (only special options). */
  hideProjects?: boolean | undefined;
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
  placeholder,
  searchPlaceholder = 'جستجوی سامانه…',
  size = 'md',
  clearable = false,
  includeAllOption = false,
  allOptionLabel = 'همه سامانه‌ها',
  includeEmptyOption = false,
  emptyOptionLabel = 'همه',
  includePersonalOption = false,
  personalOptionLabel = PERSONAL_APPLICATION_LABEL,
  hideProjects = false,
}) => {
  const { applications, loading } = useApplicationLookup();
  const hasApplications = !hideProjects && applications.length > 0
    || includeAllOption
    || includeEmptyOption
    || includePersonalOption;

  const options = useMemo(() => [
    ...(includeEmptyOption ? [{
      value: '',
      label: emptyOptionLabel,
      description: 'بدون فیلتر سامانه',
      keywords: 'all همه',
    }] : []),
    ...(includePersonalOption ? [{
      value: PERSONAL_APPLICATION_ID,
      label: personalOptionLabel,
      description: 'HTTP آزاد · بدون وابستگی CDE',
      keywords: 'personal free postman آزاد شخصی',
    }] : []),
    ...(includeAllOption ? [{
      value: 'ALL',
      label: allOptionLabel,
      description: 'کل محدوده دسترسی',
      keywords: 'all همه',
    }] : []),
    ...(hideProjects ? [] : applications.map(application => ({
      value: application.id,
      label: application.name,
      description: application.code && application.code !== application.name
        ? application.code
        : application.id !== application.name
          ? application.id
          : undefined,
      keywords: [application.id, application.name, application.code].filter(Boolean).join(' '),
    }))),
  ], [
    applications,
    includeAllOption,
    allOptionLabel,
    includeEmptyOption,
    emptyOptionLabel,
    includePersonalOption,
    personalOptionLabel,
    hideProjects,
  ]);

  return (
    <div className={cn('w-full', className)}>
      <SearchableSelect
        label={required ? `${label} *` : label}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={placeholder || (loading ? 'در حال بارگذاری…' : hasApplications ? 'جستجو و انتخاب سامانه' : 'سامانه‌ای نیست')}
        searchPlaceholder={searchPlaceholder}
        emptyMessage="سامانه‌ای با این عبارت پیدا نشد."
        disabled={disabled || loading || !hasApplications}
        error={error}
        hint={hint}
        clearable={clearable || includeEmptyOption}
        size={size}
      />
    </div>
  );
};
