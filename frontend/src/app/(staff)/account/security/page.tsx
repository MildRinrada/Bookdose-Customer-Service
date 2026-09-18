import { redirect } from 'next/navigation';

// The old address of a staff account's two-factor and passkey settings, now a section of ตั้งค่าบัญชี.
export default function Page() {
  redirect('/account?tab=security');
}
