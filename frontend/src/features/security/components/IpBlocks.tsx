'use client';

import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { blockIp, IP_BLOCKS_PATH, SECURITY_PREFIX, unblockIp } from '../api';
import { durationLabels } from '../labels';
import type { BlockDuration, IpBlock, IpInfoMap } from '../types';
import { IpWithInfo } from './IpInfo';

/* The IP block list: requests from a blocked address get 403 before anything else runs. Add for 1 ชม. / 24 ชม. /
   7 วัน / ถาวร with a reason, remove any. The server refuses to block the address of the admin's own request. */

// IPv4, IPv6 or a CIDR range of either; the server decides what it accepts.
const IP_TEXT = /^[0-9A-Fa-f:.]{2,45}(\/\d{1,3})?$/;

function BlockFields({ ip = '', reason = '' }: { ip?: string; reason?: string }) {
  return (
    <>
      <TextField label="IP" name="ip" max={49} defaultValue={ip} placeholder="เช่น 203.0.113.7" spellCheck={false} autoComplete="off" />
      <SelectField label="ระยะเวลา" name="duration" required defaultValue="24h">
        {(Object.keys(durationLabels) as BlockDuration[]).map((value) => (
          <option key={value} value={value}>
            {durationLabels[value]}
          </option>
        ))}
      </SelectField>
      <TextField label="เหตุผล" name="reason" max={200} defaultValue={reason} placeholder="เช่น พยายามเข้าสู่ระบบจำนวนมาก" />
    </>
  );
}

async function submitBlock(values: Record<string, string>) {
  const ip = (values.ip ?? '').trim();
  if (!IP_TEXT.test(ip)) throw new Error('กรุณาระบุ IP ให้ถูกต้อง เช่น 203.0.113.7');
  await blockIp({ ip, reason: (values.reason ?? '').trim(), duration: (values.duration as BlockDuration) || '24h' });
  return ip;
}

/** The dialog behind "บล็อก" in the top IPs and the event detail. */
export function BlockIpDialog({ ip, reason }: { ip: string; reason?: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="security-block-ip"
      onSubmit={async (values) => {
        const blocked = await submitBlock(values);
        closeModal(true);
        toast(`บล็อก ${blocked} แล้ว`);
        await refresh(SECURITY_PREFIX);
      }}
    >
      <p className="notice warning">คำขอทั้งหมดจาก IP นี้จะถูกปฏิเสธทันที รวมถึงผู้ใช้ที่ใช้เครือข่ายเดียวกัน</p>
      <div className="form-grid security-block-grid">
        <BlockFields ip={ip} reason={reason} />
      </div>
      <FormActions label="บล็อก IP" onCancel={() => closeModal()} />
    </Form>
  );
}

export function IpBlocksCard() {
  const blocks = useApi<{ blocks: IpBlock[]; ip_info?: IpInfoMap }>(IP_BLOCKS_PATH);
  const refresh = useInvalidate();
  const toast = useToast();
  const run = useRunAction();
  const { confirm } = useDialogs();

  const remove = (block: IpBlock) =>
    confirm({
      title: 'ยกเลิกการบล็อก IP',
      message: `ให้ ${block.ip} กลับมาใช้งานระบบได้ตามปกติ`,
      confirmLabel: 'ยกเลิกการบล็อก',
      tone: 'danger',
      run: async () => {
        await unblockIp(block.ip);
        toast(`ยกเลิกการบล็อก ${block.ip} แล้ว`);
        await refresh(SECURITY_PREFIX);
      },
    });

  return (
    <section className="card security-card" id="security-ip-blocks" aria-labelledby="security-ip-blocks-title">
      <div className="card-header">
        <div>
          <h2 id="security-ip-blocks-title">บล็อก IP</h2>
          <p>IP ในรายการนี้เข้าใช้งานระบบไม่ได้จนกว่าจะหมดอายุหรือถูกนำออก</p>
        </div>
        <Icon name="shield" />
      </div>
      <div className="card-body">
        <Form
          className="security-inline-form"
          data-form="security-add-block"
          onSubmit={async (values, form) => {
            const blocked = await submitBlock(values);
            form.reset();
            toast(`บล็อก ${blocked} แล้ว`);
            await refresh(SECURITY_PREFIX);
          }}
        >
          <div className="security-block-grid">
            <BlockFields />
          </div>
          <div className="security-form-end">
            <button type="submit" className="btn primary">
              <Icon name="plus" />
              เพิ่มการบล็อก
            </button>
          </div>
        </Form>
      </div>
      {blocks.error ? (
        <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} />
      ) : !blocks.data ? (
        <PageLoading />
      ) : blocks.data.blocks.length ? (
        <div className="table-scroll">
          <table className="security-table">
            <thead>
              <tr>
                <th scope="col">IP</th>
                <th scope="col">เหตุผล</th>
                <th scope="col">หมดอายุ</th>
                <th scope="col">เพิ่มโดย</th>
                <th scope="col">
                  <span className="sr-only">การจัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {blocks.data.blocks.map((block) => (
                <tr key={block.ip}>
                  <td>
                    <IpWithInfo ip={block.ip} info={blocks.data?.ip_info?.[block.ip]} />
                  </td>
                  <td className="security-wrap">{block.reason || '-'}</td>
                  <td>{block.expires_at ? date(block.expires_at, true) : durationLabels.permanent}</td>
                  <td>
                    <span>{block.created_by || '-'}</span>
                    <div className="tiny muted" title={date(block.created_at, true)}>
                      {relative(block.created_at)}
                    </div>
                  </td>
                  <td className="security-actions-cell">
                    <button type="button" className="btn sm danger" onClick={() => void run(() => remove(block))}>
                      <Icon name="close" />
                      นำออก
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-body muted">ยังไม่มี IP ที่ถูกบล็อก</p>
      )}
    </section>
  );
}
