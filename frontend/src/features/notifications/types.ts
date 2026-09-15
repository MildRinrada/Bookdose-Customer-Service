/* Shapes of what the bell and the notifications screen list. Built in the browser from data other screens load
   (cases, conversations, the member's alerts); there is no notifications endpoint. */

export type NotificationKind = 'me' | 'ticket' | 'inbox';

export type NotificationItem = {
  kind: NotificationKind;
  /** note-<tone> class: late | waiting | new */
  tone: 'late' | 'waiting' | 'new';
  icon: string;
  title: string;
  detail: string;
  /** ISO time the list is sorted by (newest first). */
  at: string;
  href: string;
};
