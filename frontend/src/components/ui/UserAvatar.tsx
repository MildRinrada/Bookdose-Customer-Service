'use client';

import { useWorkspace } from '@/lib/session';
import { Avatar } from './display';

/* A colleague's picture wherever the team sees one of their own: beside a message, in the mention menu, on the
   board, in a report. The photo is not in the workspace answer (one is up to 128 KB, a team of twenty would be
   megabytes in every reply); the answer only says who has one, and the picture is fetched per member and kept by
   the browser for an hour (GET /api/members/<id>/photo).

   Without an id, or for someone who never chose a photo, it falls back to the initials everything used before, so
   nothing ever shows a broken image. */

export function memberPhotoUrl(userId: string) {
  return `/api/members/${userId}/photo`;
}

export function UserAvatar({ id, name, index = 0 }: { id?: string | null; name: string | null | undefined; index?: number }) {
  // useWorkspace, not useWork: the same thread is drawn on the customer's own pages, where there is no workspace.
  const { data: work } = useWorkspace();
  const member = id ? work?.members?.find((m) => m.id === id) : undefined;
  if (!id || !member?.has_photo) return <Avatar name={name} index={index} />;
  // A data-backed PNG served by this app; next/image adds nothing for it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="avatar profile-avatar" src={memberPhotoUrl(id)} alt={`รูปโปรไฟล์ของ ${name ?? 'สมาชิก'}`} loading="lazy" />;
}
