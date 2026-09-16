import { redirect } from 'next/navigation';

// /customer/chats/<org> without a chat (a trimmed link): the chats page, which opens the newest one.
export default function Page() {
  redirect('/customer/chats');
}
