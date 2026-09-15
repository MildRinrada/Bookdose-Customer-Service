'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from '@/components/Icon';

/* Form fields with the app's validation: a red message under the field after leaving it or submitting, in Thai,
   a star on required labels and an eye on password boxes. Browser validation (required, type, maxLength) does the
   checking; these components only say it the same way everywhere. */

type Checkable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const PERSON_NAME = /^[\p{L}\p{M} .’'·-]+$/u;

/** The message for an invalid field, or '' when it is fine. `custom` returns an extra reason ('' when fine). */
export function fieldMessage(input: Checkable, custom?: (input: Checkable) => string): string {
  input.setCustomValidity(custom?.(input) ?? '');
  if (input.validity.valid) return '';
  if (input.validity.valueMissing) return 'กรุณากรอกข้อมูลช่องนี้';
  if (input.validity.typeMismatch) return 'กรุณาระบุรูปแบบให้ถูกต้อง เช่น name@example.com';
  // The browser's own words for these follow its language, not the app's.
  if (input instanceof HTMLInputElement) {
    if (input.validity.rangeUnderflow) return `กรุณาระบุค่าไม่น้อยกว่า ${input.min}`;
    if (input.validity.rangeOverflow) return `กรุณาระบุค่าไม่เกิน ${input.max}`;
    if (input.validity.stepMismatch) return input.step === 'any' || Number(input.step || 1) === 1 ? 'กรุณาระบุเป็นจำนวนเต็ม' : `กรุณาระบุค่าทีละ ${input.step}`;
    if (input.validity.badInput) return 'กรุณาระบุเป็นตัวเลข';
  }
  return input.validationMessage;
}

/** Wire any input to the app's validation. Spread `bind` on the input and render `error` (if any) after it. */
export function useFieldValidation(custom?: (input: Checkable) => string) {
  const [error, setError] = useState('');
  const errorId = useId();
  const check = (input: Checkable) => setError(fieldMessage(input, custom));
  return {
    error,
    errorId,
    bind: {
      onBlur: (e: { currentTarget: Checkable }) => check(e.currentTarget),
      onInvalid: (e: { currentTarget: Checkable }) => check(e.currentTarget),
      onInput: (e: { currentTarget: Checkable }) => {
        // Keep the custom reason current so submitting sees it; redraw only a message already shown.
        const message = fieldMessage(e.currentTarget, custom);
        if (error) setError(message);
      },
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined,
    },
    errorNode: error ? (
      <span className="field-error" id={errorId} role="alert">
        {error}
      </span>
    ) : null,
  };
}

export function RequiredStar() {
  return (
    <span className="required-star" title="จำเป็นต้องกรอก">
      {' '}
      *
    </span>
  );
}

/** The eye beside a password box: shows or hides what was typed, with a short blink. */
function PasswordEye({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [shown, setShown] = useState(false);
  const [symbol, setSymbol] = useState<'eye' | 'eyeOff'>('eye');
  const [blink, setBlink] = useState<'' | 'blink-close' | 'blink-open'>('');
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const toggle = () => {
    const input = inputRef.current;
    if (!input) return;
    const next = !shown;
    input.type = next ? 'text' : 'password';
    setShown(next);
    timers.current.forEach(clearTimeout);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSymbol(next ? 'eyeOff' : 'eye');
      return;
    }
    setBlink('blink-close');
    timers.current = [
      window.setTimeout(() => {
        setSymbol(next ? 'eyeOff' : 'eye');
        setBlink('blink-open');
        timers.current.push(window.setTimeout(() => setBlink(''), 200));
      }, 140),
    ];
  };
  return (
    <button
      type="button"
      className={`password-eye${blink ? ` ${blink}` : ''}`}
      aria-label={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
      aria-pressed={shown}
      onClick={toggle}
    >
      <Icon name={symbol} />
    </button>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'required'> & {
  label: ReactNode;
  name: string;
  /** Required unless said otherwise, like the old inputField(). */
  required?: boolean;
  /** maxLength; 300 unless said otherwise. */
  max?: number;
  /** Letters, spaces, dots, dashes and apostrophes only (a person's name). */
  personName?: boolean;
  /** The name of another field in the same form that this one must equal (e.g. "password"). */
  matches?: string;
  hint?: ReactNode;
};

/** A labelled input. Password boxes get the eye, minlength 10 and autocomplete="new-password" unless overridden. */
export function TextField({
  label,
  name,
  type = 'text',
  required = true,
  max = 300,
  personName,
  matches,
  hint,
  id,
  className,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `f-${name}-${autoId.replace(/:/g, '')}`;
  const ref = useRef<HTMLInputElement>(null);
  const password = type === 'password';
  const { bind, errorNode } = useFieldValidation((input) => {
    const value = input.value.trim();
    if (personName && value && !PERSON_NAME.test(value)) return 'ใช้ตัวอักษร เว้นวรรค จุด ขีด หรืออัญประกาศสำหรับชื่อ';
    if (matches && input.value) {
      const other = (input as HTMLInputElement).form?.elements.namedItem(matches) as HTMLInputElement | null;
      if (other && other.value !== input.value) return 'รหัสผ่านยืนยันไม่ตรงกัน';
    }
    return '';
  });
  const input = (
    <input
      ref={ref}
      id={inputId}
      name={name}
      type={type}
      required={required}
      maxLength={max}
      {...(password ? { minLength: 10, autoComplete: 'new-password' } : {})}
      {...rest}
      {...bind}
    />
  );
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={inputId}>
        {label}
        {required && <RequiredStar />}
      </label>
      {password ? (
        <div className="password-control">
          {input}
          <PasswordEye inputRef={ref} />
          {errorNode}
        </div>
      ) : (
        <>
          {input}
          {errorNode}
        </>
      )}
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'name' | 'required'> & {
  label: ReactNode;
  name: string;
  required?: boolean;
  max?: number;
  hint?: ReactNode;
};

export function TextArea({ label, name, required = true, max = 5000, hint, id, className, rows = 4, ...rest }: TextAreaProps) {
  const autoId = useId();
  const inputId = id ?? `f-${name}-${autoId.replace(/:/g, '')}`;
  const { bind, errorNode } = useFieldValidation();
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={inputId}>
        {label}
        {required && <RequiredStar />}
      </label>
      <textarea id={inputId} name={name} required={required} maxLength={max} rows={rows} {...rest} {...bind} />
      {errorNode}
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'name'> & {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  children: ReactNode;
};

export function SelectField({ label, name, required = false, hint, id, className, children, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const inputId = id ?? `f-${name}-${autoId.replace(/:/g, '')}`;
  const { bind, errorNode } = useFieldValidation();
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={inputId}>
        {label}
        {required && <RequiredStar />}
      </label>
      <select id={inputId} name={name} required={required} {...rest} {...bind}>
        {children}
      </select>
      {errorNode}
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}

/** A required number field with min / max (TextField's `max` is the text length, not the number). */
export function NumberField({
  id,
  label,
  name,
  min,
  max,
  step,
  defaultValue,
}: {
  id?: string;
  label: ReactNode;
  name: string;
  min: number;
  max: number;
  step?: number | 'any';
  defaultValue: number | string;
}) {
  const autoId = useId();
  const inputId = id ?? `f-${name}-${autoId.replace(/:/g, '')}`;
  const { bind, errorNode } = useFieldValidation();
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        <RequiredStar />
      </label>
      <input id={inputId} name={name} type="number" min={min} max={max} step={step} defaultValue={defaultValue} required {...bind} />
      {errorNode}
    </div>
  );
}

/** Buttons at the bottom of a dialog's form: cancel (closes the dialog) and the main action. */
export function FormActions({ label = 'บันทึก', onCancel, busyLabel }: { label?: ReactNode; onCancel: () => void; busyLabel?: ReactNode }) {
  return (
    <div className="form-actions">
      <button type="button" className="btn" onClick={onCancel}>
        ยกเลิก
      </button>
      <button className="btn primary" type="submit" data-busy-label={typeof busyLabel === 'string' ? busyLabel : undefined}>
        {label}
      </button>
    </div>
  );
}
