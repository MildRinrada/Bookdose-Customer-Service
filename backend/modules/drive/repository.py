"""Project Drive queries (organization database): folders, files and their versions, and the project's own files
(contract_files) that the read-only folders are made from."""
from backend.database.db import one, rows
from backend.utils.dates import now


# Folders
def folders(db, contract_id):
    return rows(db,'SELECT * FROM drive_folders WHERE contract_id=? ORDER BY name COLLATE NOCASE,created_at',(contract_id,))


def find_folder(db, contract_id, folder_id):
    return one(db,'SELECT * FROM drive_folders WHERE contract_id=? AND id=?',(contract_id,folder_id))


def folder_named(db, contract_id, name):
    """The project's folder with this name, whatever its letter case."""
    return one(db,'SELECT * FROM drive_folders WHERE contract_id=? AND lower(name)=lower(?)',(contract_id,name))


def insert_folder(db, folder_id, contract_id, name, author, party, creator_id):
    db.execute('INSERT INTO drive_folders(id,contract_id,name,created_by,party,created_at,creator_id) VALUES(?,?,?,?,?,?,?)',
               (folder_id,contract_id,name,author,party,now(),creator_id))


def delete_folder(db, folder_id):
    db.execute('DELETE FROM drive_folders WHERE id=?',(folder_id,))


def count_folders(db, contract_id):
    return db.execute('SELECT COUNT(*) FROM drive_folders WHERE contract_id=?',(contract_id,)).fetchone()[0]


# Files (deleted ones stay, marked)
def live_files(db, contract_id):
    return rows(db,'SELECT * FROM drive_files WHERE contract_id=? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE,created_at',(contract_id,))


def find_file(db, contract_id, file_id):
    return one(db,'SELECT * FROM drive_files WHERE contract_id=? AND id=? AND deleted_at IS NULL',(contract_id,file_id))


def file_named(db, folder_id, name):
    """The live file with this name in the folder, whatever its letter case (the next upload is its next version)."""
    return one(db,'SELECT * FROM drive_files WHERE folder_id=? AND lower(name)=lower(?) AND deleted_at IS NULL',(folder_id,name))


def folder_in_use(db, folder_id):
    return bool(one(db,'SELECT 1 FROM drive_files WHERE folder_id=? AND deleted_at IS NULL',(folder_id,)))


def insert_file(db, file_id, contract_id, folder_id, name):
    db.execute('INSERT INTO drive_files(id,contract_id,folder_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)',
               (file_id,contract_id,folder_id,name,now(),now()))


def touch_file(db, file_id):
    db.execute('UPDATE drive_files SET updated_at=? WHERE id=?',(now(),file_id))


def mark_deleted(db, file_id, by):
    db.execute('UPDATE drive_files SET deleted_at=?,deleted_by=? WHERE id=?',(now(),by,file_id))


# Versions
def versions_of(db, file_ids):
    """{file id: [versions, newest first]} for many files at once."""
    found = {}
    if file_ids:
        marks = ','.join('?'*len(file_ids))
        for v in rows(db,f'SELECT * FROM drive_versions WHERE file_id IN ({marks}) ORDER BY version DESC',tuple(file_ids)):
            found.setdefault(v['file_id'],[]).append(v)
    return found


def latest_version(db, file_id):
    return one(db,'SELECT * FROM drive_versions WHERE file_id=? ORDER BY version DESC LIMIT 1',(file_id,))


def insert_version(db, version_id, file_id, number, mime, size, storage_key, sha256, note, author, party, uploader_id):
    db.execute('''INSERT INTO drive_versions(id,file_id,version,mime,size,storage_key,sha256,note,uploaded_by,party,created_at,uploader_id)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',(version_id,file_id,number,mime,size,storage_key,sha256,note,author,party,now(),uploader_id))


def find_version(db, contract_id, version_id):
    """A version of a live file of this project, with the file's name."""
    return one(db,'''SELECT v.*,f.name FROM drive_versions v JOIN drive_files f ON f.id=v.file_id
                     WHERE v.id=? AND f.contract_id=? AND f.deleted_at IS NULL''',(version_id,contract_id))


# The project's own files (the read-only folders)
def document_files(db, contract_id):
    """The documents attached to every version of the contract, with their version's sent time."""
    return rows(db,'''SELECT f.id,f.version,f.name,f.mime,f.size,f.uploaded_by,f.created_at,v.sent_at FROM contract_files f
                      JOIN contract_versions v ON v.contract_id=f.contract_id AND v.version=f.version
                      WHERE f.contract_id=? AND f.milestone_id IS NULL ORDER BY v.created_at DESC,f.created_at,f.rowid''',(contract_id,))
