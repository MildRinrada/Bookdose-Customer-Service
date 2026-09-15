'use client';

import { RequiredStar, useFieldValidation } from '@/components/ui/fields';

/* The organization code on the setup and sign-up forms: it becomes part of the customer page's link, so only
   a-z, 0-9 and dashes (same rule as the server's slug_field). Markup as in pages/auth/auth.html. */

export function SlugField({ defaultValue = '' }: { defaultValue?: string }) {
  const { bind, errorNode } = useFieldValidation();
  return (
    <div className="field">
      <label htmlFor="auth-slug">
        รหัสองค์กร (ใช้ในลิงก์หน้าลูกค้า)
        <RequiredStar />
      </label>
      <input
        id="auth-slug"
        name="slug"
        required
        maxLength={60}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        defaultValue={defaultValue}
        placeholder="เช่น my-company"
        autoCapitalize="none"
        spellCheck={false}
        {...bind}
        aria-describedby={['slug-help', bind['aria-describedby']].filter(Boolean).join(' ')}
      />
      {errorNode}
      <small id="slug-help" className="muted">
        ใช้ a-z, 0-9 และขีดกลาง เช่น my-company
      </small>
    </div>
  );
}
