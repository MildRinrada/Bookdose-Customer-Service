'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { joinOrganization, ORGS_PATH, OVERVIEW_PATH } from '../api';

/* Adding an organization by its code (the one in its link, …/?org=my-company): from the new-chat form's
   "เพิ่มองค์กรด้วยรหัส" and from the account page. */

/** Join by code, then (except on the account page) start a new chat with that organization, the likely next step. */
export function useJoinOrg() {
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    async (code: string) => {
      const { organization } = await joinOrganization(code.trim().toLowerCase());
      await refresh(ORGS_PATH, OVERVIEW_PATH);
      closeModal(true);
      toast(`เพิ่ม ${organization.name} แล้ว เริ่มแชทกับองค์กรนี้ได้เลย`);
      if (pathname !== '/customer/account') router.push(`/customer/chats/new?org=${organization.slug}`);
    },
    [refresh, closeModal, toast, router, pathname],
  );
}

/** The modal content of "เพิ่มองค์กรที่ติดต่อได้" (customer-join-org.html). */
export function JoinOrgForm() {
  const join = useJoinOrg();
  const { closeModal } = useDialogs();
  return (
    <Form onSubmit={(values) => join(values.slug ?? '')}>
      <p>
        กรอกรหัสองค์กรจากลิงก์ที่องค์กรนั้นให้ไว้ เช่น ลิงก์ <code>…/?org=my-company</code> รหัสคือ <strong>my-company</strong>{' '}
        เพิ่มแล้วเริ่มแชทกับองค์กรนั้นได้ทันที
      </p>
      <TextField label="รหัสองค์กร" name="slug" max={60} placeholder="เช่น my-company" />
      <FormActions label="เพิ่มองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The account page's inline form (same handler). */
export function JoinOrgInline() {
  const join = useJoinOrg();
  return (
    <Form className="customer-join-inline" onSubmit={(values) => join(values.slug ?? '')}>
      <TextField label="รหัสองค์กร" name="slug" max={60} placeholder="เช่น my-company" />
      <button className="btn" type="submit">
        <Icon name="plus" />
        เพิ่มองค์กร
      </button>
    </Form>
  );
}
