'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { X } from 'lucide-react';

type Toast = {
  id: number;
  title: string;
  description?: string;
};

type ToastInput = Omit<Toast, 'id'>;

const ToastContext = createContext<{
  toast: (toast: ToastInput) => void;
}>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = Date.now();
      setToasts((current) => [...current, { id, ...input }]);
      window.setTimeout(() => removeToast(id), 3500);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-slate-200 bg-white p-4 text-slate-950 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.description && (
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeToast(item.id)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
