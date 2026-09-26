import React, { createContext, useContext, useState, useCallback } from 'react';

interface ToastContextType {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({
    message: '',
    visible: false,
  });

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Floating Toast Notification */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed top-20 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-2xl transition-all duration-300 ${
          toast.visible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 pointer-events-none translate-y-2'
        }`}
      >
        <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
        <span>{toast.message}</span>
      </div>
    </ToastContext.Provider>
  );
}
