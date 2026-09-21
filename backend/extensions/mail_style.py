"""The frame around a team's reply in the reader's mail client.

Email is not the web: no stylesheet survives the trip, so every rule is written on the tag itself; layout is made of
tables because that is what every client still agrees on; and colours are stated outright, or a dark-mode client
invents its own. Rounded corners simply square off in Outlook, which is fine.

Nothing is fetched from a server. Gmail and Outlook hide remote images until the reader asks for them, so a logo
file or a photograph would be an empty box for most people; a letter drawn in a circle always shows. The palette is
the app's own charcoal on white, so it never fights the organization's own colours.

The frame has five bands: the organization's name, a dark strip saying what the mail is, the reply itself, the card
of the person who wrote it, and the ways to carry on."""

# Mail clients do not load web fonts (Gmail strips @font-face, Outlook ignores it), so Sarabun shows only for a
# reader who has it on their machine. Naming it first costs nothing and the rest of the stack catches everyone else.
FONT = "'Sarabun',-apple-system,BlinkMacSystemFont,'Segoe UI','Leelawadee UI',Tahoma,sans-serif"
INK = '#26292d'
SOFT_INK = '#4a4f52'
MUTED = '#71766f'
LINE = '#e6e6e1'
PAPER = '#ffffff'
BACKDROP = '#eeeeea'
BAND = '#26292d'
BAND_TEXT = '#c6c9c4'
TEXT = f'font-family:{FONT};font-size:15px;line-height:1.8;color:{INK}'


def circle(letter, size=44, background=PAPER, colour=INK, border=''):
    """A letter in a circle: the mark used for the organization and for the person who replied."""
    edge = f'border:2px solid {border};' if border else ''
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td width="{size}" height="{size}" align="center" valign="middle" '
            f'style="width:{size}px;height:{size}px;background:{background};{edge}border-radius:{size//2}px;'
            f'font-family:{FONT};font-size:{max(14,size//2-3)}px;font-weight:700;color:{colour};text-align:center">'
            f'{letter}</td></tr></table>')


def brand_bar(brand, mark):
    """The organization's name across the top, the way a letterhead carries it."""
    return ('<tr><td align="center" style="padding:24px 26px 18px">'
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td valign="middle">{circle(mark,38,BAND,PAPER)}</td>'
            f'<td valign="middle" style="padding-left:12px;font-family:{FONT};font-size:19px;font-weight:700;'
            f'letter-spacing:.2px;color:{INK}">{brand}</td>'
            '</tr></table></td></tr>')


def hero(title, line):
    """The dark strip: what this letter is, before a word of it is read."""
    return (f'<tr><td style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'border="0" style="background:{BAND}"><tr><td style="padding:26px 30px">'
            f'<div style="font-family:{FONT};font-size:20px;line-height:1.5;font-weight:650;color:{PAPER}">{title}</div>'
            f'<div style="font-family:{FONT};font-size:14px;line-height:1.7;color:{BAND_TEXT};padding-top:4px">{line}</div>'
            '</td></tr></table></td></tr>')


def signature(name, role, mark, lines):
    """Who wrote the reply, as a card: the mark, the name, what they do, and how else to reach them."""
    extra = ''.join(f'<div style="font-family:{FONT};font-size:13px;line-height:1.8;color:{MUTED}">{line}</div>'
                    for line in lines if line)
    return (f'<tr><td style="padding:4px 30px 26px">'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="background:#f7f7f4;border:1px solid {LINE};border-radius:14px"><tr>'
            f'<td width="58" valign="top" style="padding:18px 0 18px 18px">{circle(mark,46,BAND,PAPER)}</td>'
            f'<td valign="top" style="padding:18px 18px 18px 14px">'
            f'<div style="font-family:{FONT};font-size:15px;font-weight:650;color:{INK};line-height:1.5">{name}</div>'
            f'<div style="font-family:{FONT};font-size:13px;color:{SOFT_INK};line-height:1.7">{role}</div>'
            f'{extra}</td></tr></table></td></tr>')


def actions(button, links):
    """One thing to press, and the quieter ways beside it."""
    if not button and not links:
        return ''
    label,href = button if button else ('','')
    press = ('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
             f'<td align="center" style="background:{BAND};border-radius:10px">'
             f'<a href="{href}" style="display:inline-block;padding:12px 24px;font-family:{FONT};font-size:15px;'
             f'font-weight:650;color:{PAPER};text-decoration:none">{label}</a></td></tr></table>') if button else ''
    beside = ' &nbsp;·&nbsp; '.join(f'<a href="{url}" style="color:{SOFT_INK};text-decoration:underline">{text}</a>'
                                    for text,url in links)
    row = (f'<div style="font-family:{FONT};font-size:13px;line-height:2;color:{MUTED};padding-top:{14 if button else 0}px">'
           f'{beside}</div>') if links else ''
    return f'<tr><td align="center" style="padding:0 30px 26px">{press}{row}</td></tr>'


def foot(note, sign):
    return (f'<tr><td style="padding:16px 30px 24px;border-top:1px solid {LINE};background:#fbfbf9">'
            f'<div style="font-family:{FONT};font-size:13px;line-height:1.7;color:{MUTED}">{note}</div>'
            f'<div style="font-family:{FONT};font-size:12px;line-height:1.7;color:#9a9a95;padding-top:6px">{sign}</div>'
            '</td></tr>')


FRAME = (
    '<!doctype html><html lang="th"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">'
    f'</head><body style="{TEXT};margin:0;padding:0;-webkit-text-size-adjust:100%;background:{BACKDROP}">'
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">{preview}</div>'
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
    f'style="background:{BACKDROP}"><tr><td align="center" style="padding:28px 12px">'
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
    f'style="width:600px;max-width:100%;background:{PAPER};border:1px solid {LINE};border-radius:18px;'
    'overflow:hidden">{bands}</table>'
    '</td></tr></table></body></html>'
)

# The marks the small Markdown can produce, given the spacing an email needs (the app's own stylesheet is not here).
RESET = (
    ('<p>', f'<p style="margin:0 0 15px;{TEXT}">'),
    ('<h3>', f'<h3 style="margin:24px 0 10px;font-family:{FONT};font-size:18px;font-weight:700;color:{INK}">'),
    ('<h4>', f'<h4 style="margin:20px 0 8px;font-family:{FONT};font-size:16px;font-weight:650;color:{INK}">'),
    ('<ul>', f'<ul style="margin:0 0 15px;padding-left:22px;{TEXT}">'),
    ('<ol>', f'<ol style="margin:0 0 15px;padding-left:22px;{TEXT}">'),
    ('<li>', '<li style="margin:0 0 7px">'),
    ('<a ', f'<a style="color:{INK};text-decoration:underline" '),
    ('<pre>', f'<pre style="margin:0 0 15px;padding:12px 14px;background:#f7f7f4;border:1px solid {LINE};'
              'border-radius:10px;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">'),
    ('<code>', f'<code style="font-family:Consolas,Menlo,monospace;font-size:13px;background:#f2f2ee;'
               f'border:1px solid {LINE};border-radius:6px;padding:1px 5px">'),
)


def styled(body):
    """The rendered Markdown with the spacing an email client needs written onto each tag."""
    for tag, replacement in RESET:
        body = body.replace(tag, replacement)
    return body


def initial(text):
    """The letter in the circle: the first one that is a letter or a digit, or a dot when there is none."""
    for character in (text or '').strip():
        if character.isalnum():
            return character.upper()
    return '·'


def frame(body, brand='', title='', line='', author='', role='', author_lines=(), button=None, links=(),
          note='', sign='', preview=''):
    """The whole letter. Every band is optional: without a name there is no letterhead, without an author no card."""
    from backend.utils.markdown import esc
    bands = []
    if brand:
        bands.append(brand_bar(esc(brand), esc(initial(brand))))
    if title:
        bands.append(hero(esc(title), esc(line)))
    bands.append(f'<tr><td style="padding:26px 30px 10px;{TEXT}">{styled(body)}</td></tr>')
    if author:
        bands.append(signature(esc(author), esc(role), esc(initial(author)), [esc(item) for item in author_lines]))
    bands.append(actions((esc(button[0]), esc(button[1])) if button else None,
                         [(esc(text), esc(url)) for text, url in links]))
    if note or sign:
        bands.append(foot(esc(note), esc(sign)))
    return FRAME.format(preview=esc(preview), bands=''.join(bands))
