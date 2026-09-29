'use client';

import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { retryDelivery, revokeFileLinks } from '../api';
import { deliveryNames } from '../labels';
import type { ChannelDeliveryState } from '../types';
import { useRunAction } from '@/components/ui/actions';

/* Under a reply the team sent: read on the support page, or where a LINE / Email / Facebook delivery stands, with
   "withdraw file links" and "send again" when they apply. Markup: modules/channels/channel-delivery. */

// A retry or a withdrawal changes the message, which the inbox and the case screen both show.
const MESSAGE_PREFIXES = ['/api/conversations', '/api/tickets'];

export function ChannelDelivery({
  message,
}: {
  message: { id: string; delivery: string; channel_delivery: ChannelDeliveryState | null };
}) {
  const delivery = message.channel_delivery;
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  if (!delivery) return <div className="message-footer">พร้อมอ่านในแชทบนหน้าลูกค้า</div>;
  return (
    <div className="message-footer" role="status">
      {deliveryNames[message.delivery] || message.delivery}
      {message.delivery === 'accepted' && ' · ยังไม่ยืนยันการส่งถึงหรืออ่าน'}
      {delivery.error && <p>{delivery.error}</p>}
      {/* A row of their own: beside the status they landed in the middle of its wrapped text. */}
      {(delivery.has_file_links || delivery.retryable) && (
        <div className="message-footer-actions">
          {delivery.has_file_links && (
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                run(async () => {
                  await revokeFileLinks(message.id);
                  await refresh(...MESSAGE_PREFIXES);
                  toast('ถอนลิงก์ไฟล์แล้ว');
                })
              }
            >
              ถอนลิงก์ไฟล์
            </button>
          )}
          {delivery.retryable && (
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                run(async () => {
                  await retryDelivery(message.id);
                  await refresh(...MESSAGE_PREFIXES);
                  toast('นำข้อความกลับเข้าคิวแล้ว');
                })
              }
            >
              ลองส่งอีกครั้ง
            </button>
          )}
        </div>
      )}
    </div>
  );
}
