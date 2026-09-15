/* What backend/modules/drive answers (service.view): the drive's folders with their files and every version, then the
   read-only folders made from the project's own files (system: true), whose files download through the contract's
   file route (`download`) and are grouped by version, milestone round or invoice (`group`). */

export type DriveParty = "org" | "customer";

export type DriveVersion = {
  id: string;
  version: number;
  size: number;
  note: string;
  uploaded_by: string;
  party: DriveParty;
  created_at: string;
};

export type DriveFile = {
  id: string;
  name: string;
  /** The latest version's number; null for a file of a read-only folder. */
  version: number | null;
  size: number;
  mime: string;
  updated_at: string;
  uploaded_by: string;
  party: DriveParty;
  can_delete: boolean;
  /** Newest first; empty for a file of a read-only folder. */
  versions: DriveVersion[];
  /** A read-only folder's file: the API path that downloads it. */
  download?: string;
  /** A read-only folder's file: what it belongs to (เวอร์ชัน 1.0, งวดที่ 1 · … · รอบที่ 2, INV-000001 · …). */
  group?: string;
};

export type DriveFolder = {
  /** A 32-hex id, or 'contract' / 'delivery' / 'payment' for the read-only folders. */
  id: string;
  name: string;
  system: boolean;
  party: DriveParty;
  created_by: string;
  /** Empty, and the viewer may remove it (the team any, a customer their own). */
  can_delete: boolean;
  files: DriveFile[];
};

export type DriveView = {
  folders: DriveFolder[];
  can_upload: boolean;
};

export type DriveUploaded = {
  id: string;
  version_id: string;
  version: number;
  /** Where it went (the general folder is made on the first upload without one). */
  folder_id: string;
};
