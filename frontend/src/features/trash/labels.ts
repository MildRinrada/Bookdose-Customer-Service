/* The kinds of thing a delete puts in the recycle bin. */

export const trashKinds: Record<string, { label: string; icon: string }> = {
  ticket: { label: 'เคสบริการ', icon: 'ticket' },
  contact: { label: 'ข้อมูลลูกค้า', icon: 'users' },
  article: { label: 'บทความ', icon: 'book' },
};

export const trashKind = (kind: string) => trashKinds[kind] || { label: kind, icon: 'file' };
