import { format as formatJalali, isValid as isValidDate, parse as parseJalali } from 'date-fns-jalali';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const JALALI_DATE_FORMAT = 'yyyy/MM/dd';
export const JALALI_DATE_TIME_FORMAT = 'yyyy/MM/dd HH:mm';

export function normalizeDateDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const persianIndex = PERSIAN_DIGITS.indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);
    const arabicIndex = ARABIC_DIGITS.indexOf(digit);
    return arabicIndex >= 0 ? String(arabicIndex) : digit;
  });
}

export function sanitizeJalaliDateInput(value: string): string {
  return normalizeDateDigits(value)
    .replace(/[.\-\s]+/g, '/')
    .replace(/[^\d/]/g, '')
    .replace(/\/{2,}/g, '/')
    .slice(0, 10);
}

export function parseJalaliDate(value: string): Date | null {
  const normalized = sanitizeJalaliDateInput(value);
  if (!normalized || normalized.length < 8) return null;
  const parsed = parseJalali(normalized, JALALI_DATE_FORMAT, new Date());
  if (!isValidDate(parsed) || formatJalali(parsed, JALALI_DATE_FORMAT) !== normalized) return null;
  return parsed;
}

export function parseJalaliFilterDate(value: string, endOfDay = false): Date | null {
  const parsed = parseJalaliDate(value);
  if (!parsed) return null;
  parsed.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return parsed;
}

export function formatJalaliDate(value: Date | string | number | undefined | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : formatJalali(date, JALALI_DATE_FORMAT);
}

export function formatJalaliDateTime(value: Date | string | number | undefined | null): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : formatJalali(date, JALALI_DATE_TIME_FORMAT);
}

export function jalaliDatePlaceholder(): string {
  return `مثال ${formatJalali(new Date(), JALALI_DATE_FORMAT)}`;
}
