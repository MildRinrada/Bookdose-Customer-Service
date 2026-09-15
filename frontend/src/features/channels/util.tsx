'use client';

import { TextField } from '@/components/ui/fields';

/** One field of a channel's settings (the old channel-field template): secrets are never shown back, so a password
    box starts empty and says that leaving it empty keeps the saved value. */
export function ChannelField({
  kind,
  name,
  label,
  type = 'text',
  value = '',
  required = false,
}: {
  kind: string;
  name: string;
  label: string;
  type?: 'text' | 'password' | 'url' | 'email';
  value?: string;
  required?: boolean;
}) {
  const secret = type === 'password';
  return (
    <TextField
      id={`${kind}-${name}`}
      label={label}
      name={name}
      type={type}
      defaultValue={value}
      required={required}
      max={secret ? 2000 : 254}
      minLength={undefined}
      autoComplete={secret ? 'new-password' : 'off'}
      placeholder={secret ? 'เว้นว่างเพื่อใช้ข้อมูลเดิม' : undefined}
    />
  );
}
