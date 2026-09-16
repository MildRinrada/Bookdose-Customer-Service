import { redirect } from 'next/navigation';

// /customer on its own opens the overview (the customer's landing page).
export default function Page() {
  redirect('/customer/dashboard');
}
