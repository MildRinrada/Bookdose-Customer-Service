import { redirect } from 'next/navigation';

// /platform on its own opens the console's first screen.
export default function Page() {
  redirect('/platform/system');
}
