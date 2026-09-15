import { TicketDetailScreen } from '@/features/tickets/TicketDetailScreen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailScreen id={id} />;
}
