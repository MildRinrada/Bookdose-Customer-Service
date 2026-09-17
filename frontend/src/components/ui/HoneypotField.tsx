'use client';

import { useId } from 'react';
import type { FormValues } from './Form';

/* A text box people never see, never reach and never fill (docs/HONEYPOT-DESIGN.md §1b): off the screen by class
   (.form-extra, no inline style), `inert` (never focusable, not even by a script's focus()), hidden from screen
   readers, left out of the tab order, and marked for the browser and password managers not to autofill. A bot that
   fills every box it finds fills this one too, and the server then quietly refuses the request with the answer a
   normal failure gets.

   The name is plausible for a form, and matches none of the autofill heuristics (no "name", "email", "company",
   "phone", "address", "code"), so a saved profile is never poured into it. Put it after the visible fields, and send
   its value with honeypotValue(values). */

export const HONEYPOT_FIELD = 'website';

export function HoneypotField({ name = HONEYPOT_FIELD, label = 'เว็บไซต์' }: { name?: string; label?: string }) {
  const id = `extra-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className="form-extra" aria-hidden="true" inert>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
      />
    </div>
  );
}

/** What the hidden box held when the form was sent ('' for every person). */
export const honeypotValue = (values: FormValues, name = HONEYPOT_FIELD) => values[name] ?? '';
