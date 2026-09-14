"""File checks shared by staff/portal uploads and channel imports, and private credential files."""
import os
import secrets


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
