'use client';

import { useRef, useState, type FormEvent, type FormHTMLAttributes, type ReactNode } from 'react';

/* Every form that sends something. Submitting runs the browser's checks first (the fields say what is wrong), then
   `onSubmit` with the form's values; meanwhile the submit buttons are disabled and a second submit is ignored.
   If `onSubmit` throws, its message is shown at the top of the form (role="alert"), the same place for every form.
   Files are not in `values`: read them with filesOf(form) and readFiles(). */

export type FormValues = Record<string, string>;

export function valuesOf(form: HTMLFormElement): FormValues {
  const values: FormValues = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}

type Props = Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onSubmit: (values: FormValues, form: HTMLFormElement) => Promise<unknown> | unknown;
  children: ReactNode;
};

export function Form({ onSubmit, children, ...rest }: Props) {
  const [error, setError] = useState('');
  const busy = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      busy.current = false;
    }
  };

  return (
    <form {...rest} onSubmit={submit}>
      {error && (
        <div ref={errorRef} className="error-message" role="alert">
          {error}
        </div>
      )}
      {children}
    </form>
  );
}
