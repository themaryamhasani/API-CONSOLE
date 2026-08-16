import React from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format as formatJalali,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns-jalali';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import {
  JALALI_DATE_FORMAT,
  formatJalaliDate,
  jalaliDatePlaceholder,
  parseJalaliDate,
  sanitizeJalaliDateInput,
} from '../../utils/jalaliDate';

const WEEK_DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

interface JalaliDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  inputClassName?: string | undefined;
  disabled?: boolean | undefined;
}

export const JalaliDatePicker: React.FC<JalaliDatePickerProps> = ({
  value,
  onChange,
  label,
  placeholder = jalaliDatePlaceholder(),
  className,
  inputClassName,
  disabled,
}) => {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const selectedDate = parseJalaliDate(value);
  const [open, setOpen] = React.useState(false);
  const [visibleMonth, setVisibleMonth] = React.useState<Date>(selectedDate || new Date());

  React.useEffect(() => {
    if (selectedDate) setVisibleMonth(selectedDate);
  }, [selectedDate?.getTime()]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 6 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 6 }),
  });
  const today = new Date();

  const selectDate = (date: Date) => {
    onChange(formatJalali(date, JALALI_DATE_FORMAT));
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={cn('relative w-full', className)}>
      {label && <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>}
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          dir="ltr"
          inputMode="numeric"
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => onChange(sanitizeJalaliDateInput(event.target.value))}
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:cursor-not-allowed',
            value && 'pl-9',
            inputClassName
          )}
        />
        {value && !disabled && (
          <button
            type="button"
            aria-label="پاک کردن تاریخ"
            onClick={() => onChange('')}
            className="absolute left-2 top-1/2 rounded-md p-1 text-gray-400 transition-colors -translate-y-1/2 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="ماه قبل"
              onClick={() => setVisibleMonth(prev => subMonths(prev, 1))}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold text-gray-900">
              {formatJalali(visibleMonth, 'MMMM yyyy')}
            </div>
            <button
              type="button"
              aria-label="ماه بعد"
              onClick={() => setVisibleMonth(prev => addMonths(prev, 1))}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
            {WEEK_DAYS.map(day => <div key={day} className="py-1">{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map(day => {
              const selected = selectedDate ? isSameDay(day, selectedDate) : false;
              const currentMonth = isSameMonth(day, visibleMonth);
              const currentDay = isSameDay(day, today);
              return (
                <button
                  type="button"
                  key={day.toISOString()}
                  onClick={() => selectDate(day)}
                  className={cn(
                    'aspect-square rounded-md text-sm font-medium transition-colors',
                    currentMonth ? 'text-gray-800 hover:bg-blue-50' : 'text-gray-300 hover:bg-gray-50',
                    currentDay && 'ring-1 ring-blue-200',
                    selected && 'bg-blue-600 text-white hover:bg-blue-600'
                  )}
                >
                  {formatJalali(day, 'd')}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
            <button type="button" className="font-medium text-blue-600 hover:text-blue-700" onClick={() => selectDate(today)}>
              امروز: {formatJalaliDate(today)}
            </button>
            <button type="button" className="text-gray-500 hover:text-gray-700" onClick={() => setOpen(false)}>
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
