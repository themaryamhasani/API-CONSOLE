import React from 'react';
import { Input } from './Input';
import { JalaliDatePicker } from './JalaliDatePicker';
import { formatJalaliDate, parseJalaliDate } from '../../utils/jalaliDate';

interface JalaliDateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string | undefined;
  disabled?: boolean | undefined;
  hint?: string | undefined;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalDateTimeValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseStoredValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const JalaliDateTimePicker: React.FC<JalaliDateTimePickerProps> = ({
  value,
  onChange,
  label,
  error,
  disabled,
  hint,
}) => {
  const storedDate = parseStoredValue(value);
  const storedJalaliValue = storedDate ? formatJalaliDate(storedDate) : '';
  const storedTimeValue = storedDate
    ? `${pad(storedDate.getHours())}:${pad(storedDate.getMinutes())}`
    : '';
  const [dateInput, setDateInput] = React.useState(storedJalaliValue);
  const [timeInput, setTimeInput] = React.useState(storedTimeValue);

  React.useEffect(() => {
    setDateInput(storedJalaliValue);
    setTimeInput(storedTimeValue);
  }, [value]);

  const updateDate = (nextJalaliDate: string) => {
    setDateInput(nextJalaliDate);
    if (!nextJalaliDate) {
      onChange('');
      return;
    }
    const parsedDate = parseJalaliDate(nextJalaliDate);
    if (!parsedDate) return;
    parsedDate.setHours(storedDate?.getHours() ?? 0, storedDate?.getMinutes() ?? 0, 0, 0);
    onChange(toLocalDateTimeValue(parsedDate));
  };

  const updateTime = (nextTime: string) => {
    setTimeInput(nextTime);
    const parsedDate = parseJalaliDate(dateInput);
    if (!parsedDate) return;
    const [hours, minutes] = nextTime.split(':').map(Number);
    parsedDate.setHours(hours || 0, minutes || 0, 0, 0);
    onChange(toLocalDateTimeValue(parsedDate));
  };

  return (
    <div className="w-full">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <JalaliDatePicker
          value={dateInput}
          onChange={updateDate}
          disabled={disabled}
          inputClassName={error ? 'border-red-500' : undefined}
        />
        <Input
          type="time"
          aria-label={`${label} - ساعت`}
          value={timeInput}
          onChange={event => updateTime(event.target.value)}
          disabled={disabled || !parseJalaliDate(dateInput)}
          className={error ? 'border-red-500' : undefined}
        />
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      {!error && <p className="mt-1 text-xs text-gray-500">{hint || 'تاریخ بر اساس تقویم شمسی است.'}</p>}
    </div>
  );
};
