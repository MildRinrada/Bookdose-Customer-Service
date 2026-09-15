import { api } from "@/lib/api/client";
import type { Upload } from "@/lib/files";
import type { DriveUploaded } from "./types";

/* Endpoints of backend/modules/drive/routes.py. `base` is the project's drive address for the side looking at it
   (ProjectLinks.drive: /api/contracts/<id>/drive or /api/public/<org>/contracts/<id>/drive). Read it with
   useApi(base); after a write refresh the contract's path (ProjectLinks.base), which also brings its events. */

export function driveApi(base: string) {
  return {
    path: base,
    /** Download one version (always an attachment). */
    versionPath: (versionId: string) => `${base}/versions/${versionId}`,
    createFolder: (name: string) =>
      api<{ id: string }>(`${base}/folders`, { name }),
    /** One file; folderId '' puts it in the general folder. A name already in the folder becomes its next version. */
    upload: (folderId: string, file: Upload, note: string) =>
      api<DriveUploaded>(`${base}/files`, {
        folder_id: folderId,
        note,
        files: [file],
      }),
    removeFile: (fileId: string) =>
      api<{ ok: true }>(`${base}/files/${fileId}`, undefined, "DELETE"),
    removeFolder: (folderId: string) =>
      api<{ ok: true }>(`${base}/folders/${folderId}`, undefined, "DELETE"),
  };
}

export type DriveApi = ReturnType<typeof driveApi>;
