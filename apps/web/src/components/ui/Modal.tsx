import React, { useEffect, useId, useRef } from 'react';
import { cn } from '../../utils/cn';
import { X } from 'lucide-react';
import { Button } from './Button';
interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string | undefined;
    children: React.ReactNode;
    size?: ('sm' | 'md' | 'lg' | 'xl' | 'full' | 'wide') | undefined;
    showCloseButton?: boolean | undefined;
}
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md', showCloseButton = true, }) => {
    const titleId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedElement = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        if (isOpen) {
            previouslyFocusedElement.current = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            document.body.style.overflow = 'hidden';
            window.requestAnimationFrame(() => {
                if (!dialogRef.current?.contains(document.activeElement)) {
                    dialogRef.current?.focus();
                }
            });
            const handleKeyDown = (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                    onCloseRef.current();
                }
            };
            document.addEventListener('keydown', handleKeyDown);
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
                document.body.style.overflow = '';
                previouslyFocusedElement.current?.focus();
            };
        }
        document.body.style.overflow = '';
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);
    if (!isOpen)
        return null;
    const sizes = {
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-2xl',
        full: 'max-w-4xl',
        wide: 'max-w-[96vw]',
    };
    return (<div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose}/>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1} className={cn('relative flex w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:mx-4 sm:rounded-xl', 'max-h-[calc(100dvh-0.5rem)] sm:max-h-[90dvh]', sizes[size])}>
        {(title || showCloseButton) && (<div className="flex flex-shrink-0 items-start justify-between gap-3 border-b p-3 sm:p-4">
            {title && <h2 id={titleId} className="min-w-0 break-words text-base font-semibold leading-7 text-gray-900 sm:text-lg">{title}</h2>}
            {showCloseButton && (<button type="button" onClick={onClose} className="min-h-10 min-w-10 flex-shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="بستن">
                <X className="w-5 h-5"/>
              </button>)}
          </div>)}
        <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">{children}</div>
      </div>
    </div>);
};
interface ConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string | undefined;
    cancelText?: string | undefined;
    variant?: ('danger' | 'warning' | 'primary') | undefined;
    loading?: boolean | undefined;
}
export const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'تایید', cancelText = 'انصراف', variant = 'primary', loading = false, }) => {
    return (<Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-gray-600 mb-6">{message}</p>
      <div className="flex flex-wrap gap-3 justify-end">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>
          {confirmText}
        </Button>
      </div>
    </Modal>);
};
