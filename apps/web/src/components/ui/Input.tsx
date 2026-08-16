import React from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { DESCRIPTION_MAX_LENGTH } from '../../utils/inputRules';
function pasteIntoControlledField<T extends HTMLInputElement | HTMLTextAreaElement>(event: React.ClipboardEvent<T>, value: unknown, onPaste?: React.ClipboardEventHandler<T>) {
    onPaste?.(event);
    if (event.defaultPrevented || value === undefined || event.currentTarget.disabled || event.currentTarget.readOnly)
        return;
    const text = event.clipboardData.getData('text');
    if (!text)
        return;
    const field = event.currentTarget;
    const current = String(value ?? '');
    const start = field.selectionStart ?? current.length;
    const end = field.selectionEnd ?? start;
    const rawNextValue = `${current.slice(0, start)}${text}${current.slice(end)}`;
    const maxLength = field.maxLength > -1 ? field.maxLength : undefined;
    const nextValue = maxLength ? rawNextValue.slice(0, maxLength) : rawNextValue;
    const prototype = field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    event.preventDefault();
    setter?.call(field, nextValue);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
        const cursor = Math.min(start + text.length, nextValue.length);
        field.setSelectionRange(cursor, cursor);
    });
}
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string | undefined;
    error?: string | undefined;
    hint?: string | undefined;
}
export const Input: React.FC<InputProps> = ({ label, error, hint, className, id, onPaste, value, ...props }) => {
    const generatedId = React.useId();
    const inputId = id || `utms-input-${generatedId.replace(/:/g, '')}`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    return (<div className="w-full">
      {label && (<label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>)}
      <input id={inputId} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : hint ? hintId : undefined} className={cn('w-full px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400', 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent', 'disabled:bg-gray-100 disabled:cursor-not-allowed', error ? 'border-red-500' : 'border-gray-300', className)} value={value} onPaste={(event) => pasteIntoControlledField(event, value, onPaste)} {...props}/>
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      {hint && !error && <p id={hintId} className="mt-1 text-sm text-gray-500">{hint}</p>}
    </div>);
};
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string | undefined;
    error?: string | undefined;
    showCounter?: boolean | undefined;
}
export const Textarea: React.FC<TextareaProps> = ({ label, error, className, id, onPaste, value, maxLength, showCounter, ...props }) => {
    const generatedId = React.useId();
    const inputId = id || `utms-textarea-${generatedId.replace(/:/g, '')}`;
    const errorId = `${inputId}-error`;
    const autoLimitDescription = !!label && (label.includes('توضیح') || label.includes('توضیحات'));
    const effectiveMaxLength = maxLength ?? (autoLimitDescription ? DESCRIPTION_MAX_LENGTH : undefined);
    const shouldShowCounter = showCounter ?? effectiveMaxLength !== undefined;
    const currentLength = String(value ?? '').length;
    return (<div className="w-full">
      {label && (<label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>)}
      <textarea id={inputId} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={cn('w-full px-3 py-2 border rounded-lg text-gray-900 placeholder-gray-400', 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent', 'disabled:bg-gray-100 disabled:cursor-not-allowed resize-y min-h-[100px]', error ? 'border-red-500' : 'border-gray-300', className)} value={value} maxLength={effectiveMaxLength} onPaste={(event) => pasteIntoControlledField(event, value, onPaste)} {...props}/>
      {shouldShowCounter && effectiveMaxLength && (<div className={cn('mt-1 text-xs text-left', currentLength >= effectiveMaxLength ? 'text-red-600' : 'text-gray-500')}>
          {currentLength}/{effectiveMaxLength}
        </div>)}
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </div>);
};
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string | undefined;
    error?: string | undefined;
    options: Array<{
        value: string;
        label: string;
    }>;
    placeholder?: string | undefined;
}
export const Select: React.FC<SelectProps> = ({ label, error, options, placeholder, className, id, ...props }) => {
    const generatedId = React.useId();
    const inputId = id || `utms-select-${generatedId.replace(/:/g, '')}`;
    const errorId = `${inputId}-error`;
    return (<div className="w-full">
      {label && (<label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>)}
      <select id={inputId} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={cn('w-full px-3 py-2 border rounded-lg text-gray-900', 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent', 'disabled:bg-gray-100 disabled:cursor-not-allowed', error ? 'border-red-500' : 'border-gray-300', className)} {...props}>
        {placeholder && (<option value="" disabled>
            {placeholder}
          </option>)}
        {options.map((opt) => (<option key={opt.value} value={opt.value}>
            {opt.label}
          </option>))}
      </select>
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </div>);
};

interface SearchableSelectProps {
    label?: string | undefined;
    error?: string | undefined;
    hint?: string | undefined;
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{
        value: string;
        label: string;
        keywords?: string | undefined;
    }>;
    placeholder?: string | undefined;
    searchPlaceholder?: string | undefined;
    emptyMessage?: string | undefined;
    disabled?: boolean | undefined;
    className?: string | undefined;
    dir?: 'rtl' | 'ltr' | undefined;
    id?: string | undefined;
    clearable?: boolean | undefined;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
    label,
    error,
    hint,
    value,
    onValueChange,
    options,
    placeholder = 'یک گزینه انتخاب کنید',
    searchPlaceholder = 'جستجو در لیست...',
    emptyMessage = 'گزینه‌ای پیدا نشد.',
    disabled = false,
    className,
    dir = 'rtl',
    id,
    clearable = false,
}) => {
    const generatedId = React.useId();
    const inputId = id || `utms-combobox-${generatedId.replace(/:/g, '')}`;
    const listboxId = `${inputId}-listbox`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;
    const rootRef = React.useRef<HTMLDivElement>(null);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const selected = options.find(option => option.value === value);
    const normalizedQuery = query.trim().toLocaleLowerCase('fa-IR');
    const filteredOptions = React.useMemo(() => normalizedQuery
        ? options.filter(option => `${option.label} ${option.value} ${option.keywords || ''}`
            .toLocaleLowerCase('fa-IR')
            .includes(normalizedQuery))
        : options, [normalizedQuery, options]);

    React.useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        return () => document.removeEventListener('mousedown', closeOnOutsideClick);
    }, []);

    React.useEffect(() => {
        setActiveIndex(-1);
    }, [normalizedQuery, open]);

    const choose = (nextValue: string) => {
        onValueChange(nextValue);
        setOpen(false);
        setQuery('');
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => index < 0 ? 0 : Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => index < 0 ? Math.max(filteredOptions.length - 1, 0) : Math.max(index - 1, 0));
        } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
            event.preventDefault();
            choose(filteredOptions[activeIndex].value);
        } else if (event.key === 'Escape') {
            setOpen(false);
            setQuery('');
        }
    };

    return (<div ref={rootRef} className={cn('relative w-full', className)} dir={dir}>
      {label && (<label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>)}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && filteredOptions[activeIndex] ? `${inputId}-option-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          disabled={disabled}
          value={open ? query : selected?.label || ''}
          placeholder={open ? searchPlaceholder : placeholder}
          onFocus={() => {
              if (!disabled) {
                  setOpen(true);
                  setQuery('');
              }
          }}
          onClick={() => !disabled && setOpen(true)}
          onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
              'h-10 w-full rounded-lg border bg-white py-2 pr-9 pl-16 text-sm text-gray-900 outline-none transition',
              'placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
              'disabled:cursor-not-allowed disabled:bg-gray-100',
              error ? 'border-red-500' : 'border-gray-300',
          )}
        />
        <div className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {clearable && value && !disabled && (<button
            type="button"
            aria-label="پاک کردن انتخاب"
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose('')}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>)}
          <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} />
        </div>
      </div>
      {open && !disabled && (<div
        id={listboxId}
        role="listbox"
        className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
      >
        {filteredOptions.length ? filteredOptions.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (<button
              id={`${inputId}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option.value)}
              className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-right text-sm transition-colors',
                  isActive ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-blue-600" />}
            </button>);
        }) : (<div className="px-3 py-6 text-center text-sm text-gray-500">{emptyMessage}</div>)}
      </div>)}
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      {hint && !error && <p id={hintId} className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>);
};
