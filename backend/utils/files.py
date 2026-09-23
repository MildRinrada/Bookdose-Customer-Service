"""File checks shared by staff/portal uploads and channel imports, and private credential files."""
import base64
import os
import secrets
import struct

# A picture a person or an organization sets as its own: the browser crops it to a square PNG and sends it as a data
# URL, which is stored as text beside the row it belongs to. The ceiling is what a page can carry inline without
# being slow, not what a picture needs: 512 pixels is already more than any avatar is drawn at.
PICTURE_MAX_SIDE = 512
PICTURE_MAX_BYTES = 128*1024
PICTURE_PREFIX = 'data:image/png;base64,'
PICTURE_FIELD_MAX = 180000        # the data URL itself, base64 being a third longer than the bytes


def png_data_url(value, label):
    """Check a square-ish PNG data URL from the picture cropper; returns (ok, message). '' is "no picture"."""
    if not value:
        return True,''
    if not value.startswith(PICTURE_PREFIX):
        return False,f'{label}ต้องเป็น PNG'
    try:
        raw = base64.b64decode(value.split(',',1)[1],validate=True)
        if not (len(raw)>=33 and raw.startswith(b'\x89PNG\r\n\x1a\n') and raw[12:16]==b'IHDR'):
            return False,f'{label}ไม่ถูกต้อง'
        width,height = struct.unpack('>II',raw[16:24])
    except (ValueError,struct.error):
        return False,f'{label}ไม่ถูกต้อง'
    if not (0<width<=PICTURE_MAX_SIDE and 0<height<=PICTURE_MAX_SIDE and len(raw)<=PICTURE_MAX_BYTES):
        return False,f'{label}ต้องไม่เกิน {PICTURE_MAX_SIDE} × {PICTURE_MAX_SIDE} และ {PICTURE_MAX_BYTES//1024} KB'
    return True,''


def matches_file_type(extension, content):
    """Check the signature of supported image, video and document containers (extension without dot)."""
    if extension == 'mp4':
        if len(content)<24 or content[4:8]!=b'ftyp':
            return False
        box_size = int.from_bytes(content[:4],'big')
        brands = {b'isom',b'iso2',b'iso3',b'iso4',b'iso5',b'iso6',b'mp41',b'mp42',b'avc1',b'M4V '}
        return 16<=box_size<=len(content) and content[8:12] in brands
    if extension == 'webm':
        return content.startswith(b'\x1a\x45\xdf\xa3') and b'\x42\x82\x84webm' in content[:128]
    if extension == 'txt':
        try:
            content.decode('utf-8')
        except UnicodeDecodeError:
            return False
        return b'\x00' not in content
    return ((extension == 'png' and content.startswith(b'\x89PNG\r\n\x1a\n')) or
            (extension in ('jpg', 'jpeg') and content.startswith(b'\xff\xd8\xff')) or
            (extension == 'gif' and content.startswith((b'GIF87a',b'GIF89a'))) or
            (extension == 'webp' and content.startswith(b'RIFF') and content[8:12]==b'WEBP') or
            (extension == 'pdf' and content.startswith(b'%PDF-')))


def write_private_file(path, text):
    """Atomically replace `path` with `text`, readable only by this account (0600 where supported)."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f'.{path.name}.{secrets.token_hex(8)}.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
