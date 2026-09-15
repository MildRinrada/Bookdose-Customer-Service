import { redirect } from 'next/navigation';

// /customer on its own opens the chats, like the old #chats default.
export default function Page() {
  redirect('/customer/chats');
}
