'use client';

import { LegalButton } from '@/features/legal/LegalDocument';

/* ประกาศความเป็นส่วนตัว for a customer: the document the platform admin publishes (console → เอกสารกฎหมาย,
   backend modules/legal 'customer-privacy'), opened in a window from the sign-up form and the account page, with the
   organization's name put in for {{องค์กร}}. On the form, agreeing at the foot of the text is what ticks the box:
   consent that was never shown is not consent. The version the customer agreed to is written against the account
   (customer_accounts.consent_version), from the version published at that moment. */

export function PrivacyNoticeButton({
  organization,
  label = 'อ่านประกาศความเป็นส่วนตัว',
  onAccept,
}: {
  organization?: string | null;
  label?: string;
  onAccept?: () => void;
}) {
  return <LegalButton doc="customer-privacy" organization={organization || 'องค์กร'} label={label} onAccept={onAccept} />;
}
