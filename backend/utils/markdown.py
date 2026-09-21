"""The app's small Markdown, for the mail that leaves the server.

A team reply is stored the way the composer wrote it: Markdown (frontend/src/features/rich/markdown-core.ts). The
pages turn it into HTML when they show it; an email has to carry its own, so the same rules live here as well. The
two must agree, so this is a faithful port: the same token pattern, the same checks in the same order, the same
allowlist of tags. `tests/test_markdown.py` holds the cases both sides are expected to answer alike.

Every piece of source text is escaped and only the allowlisted tags are ever built, so a reply can carry no markup of
its own into the reader's mail client."""
import html
import re
from urllib.parse import urlsplit, urlunsplit

# One capturing group only, so split() returns text and tokens alternately (as the TypeScript does).
TOKENS = re.compile(r'(!?\[[^\]\n]*\]\([^\s)]+\)|`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*(?:(?!\*\*)[^\n])+\*\*|'
                    r'__(?:(?!__)[^\n])+__|\*[^*\n]+\*)')
LINK = re.compile(r'^(!?)\[([^\]]*)\]\(([^)]+)\)$')
ITEM = re.compile(r'^\s*(?:([-*•])|\d+\.)\s+(.*)$')
HEAD = re.compile(r'^(#{1,2})\s+(.*)$')
DEFAULT_BASE = 'http://localhost'


def esc(value):
    """HTML-escape a value, quotes included (the esc() of markdown-core.ts)."""
    return html.escape('' if value is None else str(value),quote=True).replace('&#x27;','&#39;')


def safe_url(value, image=False, base=DEFAULT_BASE):
    """An https:// address (http:// too for links, not for images) without credentials, as an absolute URL, or None."""
    try:
        parts = urlsplit(value.strip())
        if not parts.scheme:
            # Relative: resolve against the base the way the browser's URL() does.
            from urllib.parse import urljoin
            parts = urlsplit(urljoin(base if base.endswith('/') else base+'/',value.strip()))
        if parts.username or parts.password:
            return None
        if parts.scheme=='https' or (not image and parts.scheme=='http'):
            return urlunsplit(parts)
    except ValueError:
        pass
    return None


def parse_inline(text, base=DEFAULT_BASE):
    """One line's inline marks, as a list of (kind, payload) the writer below understands."""
    out = []
    for part in TOKENS.split(text):
        if not part:
            continue
        link = LINK.match(part)
        if link:
            url = safe_url(link.group(3),bool(link.group(1)),base)
            if not url:
                out.append(('text',part))
            elif link.group(1):
                out.append(('image',(url,link.group(2))))
            else:
                out.append(('link',(url,link.group(2))))
            continue
        # Marks may be combined (bold + italic, bold + underline), so the text inside a mark is read the same way.
        if part.startswith('***') and part.endswith('***'):
            out.append(('strongEm',parse_inline(part[3:-3],base)))
        elif part.startswith('**') and part.endswith('**'):
            out.append(('strong',parse_inline(part[2:-2],base)))
        elif part.startswith('__') and part.endswith('__'):
            out.append(('u',parse_inline(part[2:-2],base)))
        elif part.startswith('*') and part.endswith('*'):
            out.append(('em',parse_inline(part[1:-1],base)))
        elif part.startswith('`') and part.endswith('`'):
            out.append(('code',part[1:-1]))
        else:
            out.append(('text',part))
    return out


def parse_markdown(text, base=DEFAULT_BASE):
    """Paragraphs, headings (# -> h3, ## -> h4), bullet / numbered lists and ``` code blocks."""
    blocks,open_list,code = [],None,None

    def close():
        nonlocal open_list
        if open_list:
            blocks.append(open_list)
        open_list = None

    for line in str(text if text is not None else '').split('\n'):
        if line.startswith('```'):
            close()
            if code is None:
                code = []
            else:
                blocks.append(('pre','\n'.join(code)))
                code = None
            continue
        if code is not None:
            code.append(line)
            continue
        # People type "•" as often as "-" for a bullet; both make the same list.
        item,head = ITEM.match(line),HEAD.match(line)
        if item:
            kind = 'ul' if item.group(1) else 'ol'
            if not open_list or open_list[0]!=kind:
                close()
                open_list = (kind,[])
            open_list[1].append(parse_inline(item.group(2),base))
        else:
            close()
            if head:
                blocks.append(('h3' if len(head.group(1))==1 else 'h4',parse_inline(head.group(2),base)))
            elif line.strip():
                blocks.append(('p',parse_inline(line,base)))
    close()
    if code is not None:
        blocks.append(('pre','\n'.join(code)))
    return blocks


def inline_html(nodes):
    out = []
    for kind,value in nodes:
        if kind=='text':
            out.append(esc(value))
        elif kind=='strongEm':
            out.append(f'<strong><em>{inline_html(value)}</em></strong>')
        elif kind=='strong':
            out.append(f'<strong>{inline_html(value)}</strong>')
        elif kind=='u':
            out.append(f'<u>{inline_html(value)}</u>')
        elif kind=='em':
            out.append(f'<em>{inline_html(value)}</em>')
        elif kind=='code':
            out.append(f'<code>{esc(value)}</code>')
        elif kind=='link':
            href,label = value
            out.append(f'<a href="{esc(href)}">{esc(label)}</a>')
        elif kind=='image':
            src,alt = value
            out.append(f'<img src="{esc(src)}" alt="{esc(alt)}" style="max-width:100%;height:auto">')
    return ''.join(out)


def to_html(text, base=DEFAULT_BASE):
    """Markdown as HTML: all source text escaped, only the allowlisted tags created."""
    out = []
    for block in parse_markdown(text,base):
        kind,value = block
        if kind=='pre':
            out.append(f'<pre><code>{esc(value)}</code></pre>')
        elif kind in ('ul','ol'):
            items = ''.join(f'<li>{inline_html(item)}</li>' for item in value)
            out.append(f'<{kind}>{items}</{kind}>')
        else:
            out.append(f'<{kind}>{inline_html(value)}</{kind}>')
    return ''.join(out)
