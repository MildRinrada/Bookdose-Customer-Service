'use client';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { useHere, useViewing } from '@/lib/realtime-provider';
import { useStaffUser } from '@/lib/session';

/* "มีคนกำลังตอบแชทนี้อยู่" - the strip above the composer.

   Two members answering the same customer is not something the server can catch: both replies are real and both go
   out. What is missing is only that the second member never learns the first one is already writing. This says so,
   at the one place where it can still change what happens - between the thread and the box you are about to type in.

   It stops nothing and claims nothing. A member who has read the whole thread and knows the answer should still send
   it; a lock over a conversation would trade two replies for a customer waiting on somebody who wandered off. Both
   the words and the place are chosen for that: a line you see before typing, not a door.

   Presence comes from the open sockets alone (lib/realtime-provider), so it is right within about half a minute of
   anybody closing a tab, and it says nothing at all when the connection is down - an empty strip is honest, a stale
   name is not. Markup: pages/inbox/here-strip. */

/** Up to two names, then "และอีก N คน": the rest of a long list is a number, because the names stop being read. */
function nameList(people: Array<{ name: string }>): string {
  const named = people.slice(0, 2).map((p) => p.name || 'เพื่อนร่วมทีม');
  const rest = people.length - named.length;
  return named.join(' และ ') + (rest > 0 ? ` และอีก ${rest} คน` : '');
}

export function ColleaguesHere({ conversationId }: { conversationId: string }) {
  const me = useStaffUser().id;
  useViewing(conversationId);
  const here = useHere(conversationId, me);
  if (!here.length) return null;

  const writing = here.filter((c) => c.typing);
  const shown = writing.length ? writing : here;
  const alsoOpen = writing.length ? here.length - writing.length : 0;

  return (
    <div className={`here-strip${writing.length ? ' writing' : ''}`} role="status">
      <span className="here-faces" aria-hidden="true">
        {shown.slice(0, 3).map((c, i) => (
          <Avatar key={c.id} name={c.name} index={i} />
        ))}
      </span>
      <Icon name={writing.length ? 'edit' : 'eye'} />
      <span className="grow">
        {writing.length ? `${nameList(writing)} กำลังพิมพ์ตอบอยู่` : `${nameList(here)} เปิดแชทนี้อยู่`}
        {alsoOpen > 0 && ` · อีก ${alsoOpen} คนเปิดอยู่`}
      </span>
    </div>
  );
}
