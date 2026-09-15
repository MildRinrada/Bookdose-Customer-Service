"""Project Drive: the central files of a signed project, in folders with versions, uploaded by both sides.

Organization database: drive_folders (made by either side, one name once per project), drive_files (one row per
name in a folder; deleting only marks it, so the history stays) and drive_versions (every upload of the same name in
the same folder is the next version of that file; the bytes are stored like other attachments). creator_id and
uploader_id keep who did it (a staff user id for party 'org', a customer account id for 'customer'), because a
customer may delete only what they uploaded themselves and names are not unique.
Next to these, the drive shows read-only folders made from what the project already has: the documents of the sent
versions, the delivered work and (for the team and whoever has billing) the payment slips."""

PARTIES = ('org','customer')

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS drive_folders (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL,
    party TEXT NOT NULL CHECK(party IN ('org','customer')), created_at TEXT NOT NULL, creator_id TEXT NOT NULL DEFAULT '',
    UNIQUE(contract_id,name)
);
CREATE TABLE IF NOT EXISTS drive_files (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, folder_id TEXT NOT NULL, name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, deleted_by TEXT
);
CREATE TABLE IF NOT EXISTS drive_versions (
    id TEXT PRIMARY KEY, file_id TEXT NOT NULL, version INTEGER NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
    storage_key TEXT NOT NULL, sha256 TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', uploaded_by TEXT NOT NULL,
    party TEXT NOT NULL CHECK(party IN ('org','customer')), created_at TEXT NOT NULL, uploader_id TEXT NOT NULL DEFAULT '',
    UNIQUE(file_id,version)
);
CREATE INDEX IF NOT EXISTS drive_folders_contract ON drive_folders(contract_id);
CREATE INDEX IF NOT EXISTS drive_files_folder ON drive_files(folder_id,deleted_at);
'''
