import { TrashScreen } from '@/features/trash/TrashScreen';

// Admins and team leads only: the staff layout sends other members back to the overview (lib/routes.ts roles).
export default function Page() {
  return <TrashScreen />;
}
