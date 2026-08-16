import React from 'react';
import { JalaliDatePicker } from './JalaliDatePicker';
import { formatJalaliDate, parseJalaliDate } from '../../utils/jalaliDate';

interface JalaliDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toStoredDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseStoredDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const JalaliDateField: React.FC<JalaliDateFieldProps> = ({
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  className,
}) => {
  const storedDate = parseStoredDate(value);
  const storedJalaliValue = storedDate ? formatJalaliDate(storedDate) : '';
  const [dateInput, setDateInput] = React.useState(storedJalaliValue);

  React.useEffect(() => {
    setDateInput(storedJalaliValue);
  }, [value]);

  const updateDate = (nextJalaliDate: string) => {
    setDateInput(nextJalaliDate);
    if (!nextJalaliDate) {
      onChange('');
      return;
    }
    const parsedDate = parseJalaliDate(nextJalaliDate);
    if (parsedDate) onChange(toStoredDate(parsedDate));
  };

  return (
    <div className={className}>
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required ? ' *' : ''}
      </span>
      <JalaliDatePicker
        value={dateInput}
        onChange={updateDate}
        disabled={disabled}
        inputClassName={error ? 'border-red-500' : undefined}
      />
      {error
        ? <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>
        : <p className="mt-1 text-xs text-gray-500">تاریخ بر اساس تقویم شمسی است.</p>}
    </div>
  );
};
