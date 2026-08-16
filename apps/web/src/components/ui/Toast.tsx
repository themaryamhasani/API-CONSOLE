import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../../utils/cn';
type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastData {
    id: number;
    type: ToastType;
    message: string;
    duration?: number | undefined;
}
let toastId = 0;
let addToastGlobal: ((type: ToastType, message: string, duration?: number) => void) | null = null;
export const showToast = (type: ToastType, message: string, duration = 4000) => {
    addToastGlobal?.(type, message, duration);
};
export const toast = {
    success: (message: string) => showToast('success', message),
    error: (message: string) => showToast('error', message),
    warning: (message: string) => showToast('warning', message),
    info: (message: string) => showToast('info', message),
};
export const ToastContainer: React.FC = () => {
    const [toasts, setToasts] = useState<ToastData[]>([]);
    const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, type, message, duration }]);
        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }
    }, []);
    useEffect(() => {
        addToastGlobal = addToast;
        return () => { addToastGlobal = null; };
    }, [addToast]);
    const removeToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };
    const icons = {
        success: <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0"/>,
        error: <XCircle className="w-5 h-5 text-red-500 flex-shrink-0"/>,
        warning: <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0"/>,
        info: <Info className="w-5 h-5 text-blue-500 flex-shrink-0"/>,
    };
    const bgColors = {
        success: 'bg-green-50 border-green-200',
        error: 'bg-red-50 border-red-200',
        warning: 'bg-amber-50 border-amber-200',
        info: 'bg-blue-50 border-blue-200',
    };
    if (toasts.length === 0)
        return null;
    return (<div className="fixed inset-x-3 top-3 z-[100] flex max-w-sm flex-col gap-2 sm:inset-x-auto sm:left-4 sm:top-4" dir="rtl" role="status" aria-live="polite">
      {toasts.map((t) => (<div key={t.id} className={cn('flex items-start gap-3 p-4 rounded-xl border shadow-lg animate-fadeIn', bgColors[t.type])}>
          {icons[t.type]}
          <p className="text-sm text-gray-800 flex-1">{t.message}</p>
          <button type="button" onClick={() => removeToast(t.id)} className="p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="بستن اعلان">
            <X className="w-4 h-4"/>
          </button>
        </div>))}
    </div>);
};
