import type { IpInfo } from '../types';

/* An address with what the IP database knows of it (backend security/ip_intel.py): the country, the network, and a
   badge when the network rents out servers (a cloud or a VPN), which is a sign to look closer, never proof. Nothing
   beside the address while the database is off. Markup: pages/security.css (ip-info). */

let regionNames: Intl.DisplayNames | null | undefined;

/** The country's name in Thai (the browser knows every one), or the code as it came. */
export function countryName(code: string): string {
  if (!code) return '';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['th'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function IpInfoText({ info }: { info?: IpInfo }) {
  if (!info) return null;
  const place = [countryName(info.country), info.org].filter(Boolean).join(' ');
  return (
    <span className="ip-info">
      {place && <span className="ip-info-place">{place}</span>}
      {info.hosting && (
        <span className="ip-info-hosting" title="เครือข่ายของผู้ให้บริการคลาวด์หรือ VPN มักใช้ปิดบังที่อยู่จริง ใช้ประกอบการตัดสินใจ ไม่ใช่หลักฐาน">
          คลาวด์หรือ VPN
        </span>
      )}
    </span>
  );
}

/** A table cell's content: the address, and under it what is known of it. */
export function IpWithInfo({ ip, info }: { ip: string | null | undefined; info?: IpInfo }) {
  if (!ip) return <>-</>;
  return (
    <>
      <span className="mono">{ip}</span>
      <IpInfoText info={info} />
    </>
  );
}
