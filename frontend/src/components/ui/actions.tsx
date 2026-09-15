'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDialogs } from './Dialogs';
import { useToast } from './Toast';

/* Button actions shared by every screen: the old click dispatcher's red toast on failure and ui.js copyText. */

/** Run a button's action the way the old click dispatcher did: a failure is shown as a red toast. */
export function useRunAction() {
  const toast = useToast();
  return useCallback(
    async (action: () => unknown | Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      }
    },
    [toast],
  );
}

/** Copy a value; when the browser refuses, show it in a dialog to copy by hand (the old copyText). */
export function useCopyText() {
  const toast = useToast();
  const { openModal } = useDialogs();
  return useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast('คัดลอกลิงก์แล้ว');
      } catch {
        openModal('คัดลอกลิงก์', <CopyLink url={value} />);
      }
    },
    [toast, openModal],
  );
}

function CopyLink({ url }: { url: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.select());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="field">
      <label htmlFor="copy-url">เลือกลิงก์ด้านล่างแล้วคัดลอก</label>
      <input ref={ref} id="copy-url" defaultValue={url} readOnly />
    </div>
  );
}
