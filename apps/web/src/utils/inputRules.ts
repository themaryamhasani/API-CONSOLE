export const DESCRIPTION_MAX_LENGTH = 700;

const REQUEST_TITLE_FORBIDDEN_PATTERN = /`/g;
const VERSION_ALLOWED_PATTERN = /[^0-9A-Za-z.+-]/g;
const NON_ASCII_PRINTABLE_PATTERN = /[^\x20-\x7E]/g;

export const REQUEST_TITLE_HINT = 'عنوان درخواست نباید با فاصله شروع شود و کاراکتر ` مجاز نیست.';
export const VERSION_INPUT_HINT = 'فرمت نسخه باید SemVer باشد؛ مثال: 1.2.3 یا 1.2.3-beta.1';
export const BUILD_NUMBER_INPUT_HINT = 'شماره بیلد فقط می‌تواند شامل حروف، اعداد و کاراکترهای انگلیسی باشد.';
export const SYSTEM_URL_INPUT_HINT = 'آدرس سامانه باید URL معتبر باشد؛ مثال: https://app.example.com';
const SYSTEM_URL_PATTERN = /^https?:\/\/(?:(?:localhost)|(?:(?:\d{1,3}\.){3}\d{1,3})|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/;

export function sanitizeRequestTitleInput(rawValue: string): { value: string; error?: string } {
  const hasLeadingWhitespace = /^\s/.test(rawValue);
  const hasForbiddenChar = REQUEST_TITLE_FORBIDDEN_PATTERN.test(rawValue);
  REQUEST_TITLE_FORBIDDEN_PATTERN.lastIndex = 0;

  const value = rawValue
    .replace(REQUEST_TITLE_FORBIDDEN_PATTERN, '')
    .replace(/^\s+/, '');

  if (hasLeadingWhitespace) {
    return { value, error: 'عنوان درخواست نمی‌تواند با فاصله شروع شود.' };
  }
  if (hasForbiddenChar) {
    return { value, error: 'کاراکتر ` در عنوان درخواست مجاز نیست.' };
  }
  return { value };
}

export function validateRequestTitle(value: string): string | undefined {
  if (!value.trim()) return 'عنوان الزامی است.';
  if (/^\s/.test(value)) return 'عنوان درخواست نمی‌تواند با فاصله شروع شود.';
  if (value.includes('`')) return 'کاراکتر ` در عنوان درخواست مجاز نیست.';
  return undefined;
}

export function sanitizeVersionInput(rawValue: string): { value: string; error?: string } {
  const value = rawValue.replace(VERSION_ALLOWED_PATTERN, '');
  if (value !== rawValue) {
    return { value, error: VERSION_INPUT_HINT };
  }
  return { value };
}

export function sanitizeBuildNumberInput(rawValue: string): { value: string; error?: string } {
  const value = rawValue.replace(NON_ASCII_PRINTABLE_PATTERN, '');
  if (value !== rawValue) {
    return { value, error: BUILD_NUMBER_INPUT_HINT };
  }
  return { value };
}

export function hasInvalidBuildNumber(value: string | undefined | null): boolean {
  if (!value) return false;
  NON_ASCII_PRINTABLE_PATTERN.lastIndex = 0;
  return NON_ASCII_PRINTABLE_PATTERN.test(value);
}

export function isValidSystemUrl(value: string | undefined | null): boolean {
  if (!value?.trim()) return true;
  return SYSTEM_URL_PATTERN.test(value.trim());
}
