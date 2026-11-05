'use client';

import { useEffect, useRef, useState, type FormEvent, type FormHTMLAttributes, type ReactNode } from 'react';

/* Every form that sends something. Submitting runs the browser's checks first (the fields say what is wrong), then
   `onSubmit` with the form's values; meanwhile the submit buttons are disabled and a second submit is ignored.
   If `onSubmit` throws, its message is shown at the top of the form (role="alert"), the same place for every form.
   Once it succeeds the form carries data-saved for SAVED_MS, and the settings screens' save buttons read บันทึกแล้ว
   meanwhile (pages/settings.css). A form drawn again from what it saved (a new key) is the same form by its
   data-form (and data-kind) name, so it keeps saying so for the rest of the moment.
   Files are not in `values`: read them with filesOf(form) and readFiles(). */

export type FormValues = Record<string, string>;

export function valuesOf(form: HTMLFormElement): FormValues {
  const values: FormValues = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}

const SAVED_MS = 1800;
/** When each named form last saved (this page's life only). */
const savedAt = new Map<string, number>();

function markSaved(form: HTMLFormElement | null, ms: number) {
  if (!form) return;
  form.setAttribute('data-saved', '');
  window.setTimeout(() => form.removeAttribute('data-saved'), ms);
}

type Props = Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onSubmit: (values: FormValues, form: HTMLFormElement) => Promise<unknown> | unknown;
  children: ReactNode;
};

export function Form({ onSubmit, children, ...rest }: Props) {
  const [error, setError] = useState('');
  const busy = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const self = useRef<HTMLFormElement>(null);
  const named = rest as Record<string, unknown>;
  const name = [named['data-form'], named['data-kind']].filter((part) => typeof part === 'string' && part).join(':');

  useEffect(() => {
    const at = name ? savedAt.get(name) : undefined;
    if (at && Date.now() - at < SAVED_MS) markSaved(self.current, SAVED_MS - (Date.now() - at));
  }, [name]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy.current) return;
    busy.current = true;
    setError('');
    const buttons = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"],button:not([type])')].filter((b) => !b.disabled);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await onSubmit(valuesOf(form), form);
      if (name) savedAt.set(name, Date.now());
      markSaved(form, SAVED_MS);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      busy.current = false;
    }
  };

  return (
    <form {...rest} ref={self} onSubmit={submit}>
      {error && (
        <div ref={errorRef} className="error-message" role="alert">
          {error}
        </div>
      )}
      {children}
    </form>
  );
}
