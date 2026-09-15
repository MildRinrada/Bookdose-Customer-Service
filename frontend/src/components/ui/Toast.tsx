'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/* The one-line message at the bottom of the screen ("บันทึกแล้ว"); errors in red. Gone after 4.5 seconds. */

type Toast = (message: string, error?: boolean) => void;

const ToastContext = createContext<Toast>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ message: string; error: boolean; visible: boolean }>({ message: '', error: false, visible: false });
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback<Toast>((message, error = false) => {
    setState({ message, error, visible: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState((s) => ({ ...s, visible: false })), 4500);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" role="status" aria-live="polite" className={state.visible ? `visible${state.error ? ' error' : ''}` : ''}>
        {state.message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toast {
  return useContext(ToastContext);
}
