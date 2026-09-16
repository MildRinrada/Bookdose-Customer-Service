import { JoinScreen } from '@/features/org-links/JoinScreen';

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinScreen token={token} />;
}
