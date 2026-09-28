"""ค้นหาด่วน (the search box in the top bar, Ctrl+K): a few cases, customers and articles whose words match what the
member typed, to jump straight to one instead of opening a list and searching there. The pages of the app are matched
in the browser (they are the same for everybody with the same role).

Each kind is what the member may already open: an agent's cases are their team's, their customers are the ones the
customer list shows them (made by them, or with work in their team), and articles are the whole knowledge base, which
every member reads."""
import re

from backend.database.db import rows
from backend.middleware.access import visible_team

QUERY_MAX = 80
PER_KIND = 5
# "BD-1024", "bd1024", "#1024" or "1024": a case number.
CASE_NUMBER = re.compile(r'(?:bd-?|#)?\s*(\d{1,9})',re.I)
DONE = "('resolved','closed')"


def _like(text):
    return '%'+text.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'


def query_of(value):
    """The words to look for: one line, spaces collapsed, at most QUERY_MAX characters."""
    return re.sub(r'\s+',' ',value if isinstance(value,str) else '').strip()[:QUERY_MAX]


def _cases(db, ctx, text):
    number = CASE_NUMBER.fullmatch(text)
    wanted = int(number.group(1)) if number else -1
    # A number still being typed finds the cases it begins: "BD-10" finds BD-10, BD-102 and BD-1009.
    begins = f'{wanted}%' if number else ''
    team = visible_team(ctx)
    where,args = ('t.team_id=?',[team]) if team is not None else ('1=1',[])
    like = _like(text)
    # The case with that number first, then work still going on, then the most recently changed.
    return rows(db,f'''SELECT t.id,t.number,t.subject,t.status,t.updated_at,c.name AS contact_name FROM tickets t
                      JOIN contacts c ON c.id=t.contact_id
                      WHERE {where} AND (t.number=? OR CAST(t.number AS TEXT) LIKE ? OR t.subject LIKE ? ESCAPE '\\'
                                         OR c.name LIKE ? ESCAPE '\\')
                      ORDER BY t.number=? DESC,t.status IN {DONE},t.updated_at DESC LIMIT ?''',
                (*args,wanted,begins,like,like,wanted,PER_KIND))


def _customers(db, ctx, text):
    team = visible_team(ctx)
    if team is None:
        where,args = '1=1',[]
    else:
        where = '''(c.created_by=? OR c.id IN (SELECT contact_id FROM conversations WHERE team_id=?)
                   OR c.id IN (SELECT contact_id FROM tickets WHERE team_id=?))'''
        args = [ctx['id'],team,team]
    like = _like(text)
    matches = ["c.name LIKE ? ESCAPE '\\'","c.email LIKE ? ESCAPE '\\'","c.company LIKE ? ESCAPE '\\'"]
    params = [like,like,like]
    # A phone number is found however it was written: 081-234-5678, 081 234 5678 and 0812345678 are one number.
    digits = re.sub(r'\D','',text)
    if len(digits)>=4:
        matches.append("REPLACE(REPLACE(REPLACE(c.phone,'-',''),' ',''),'+','') LIKE ?")
        params.append('%'+digits+'%')
    return rows(db,f'''SELECT c.id,c.name,c.email,c.phone,c.company FROM contacts c
                      WHERE {where} AND ({' OR '.join(matches)}) ORDER BY c.name LIKE ? ESCAPE '\\' DESC,c.name LIMIT ?''',
                (*args,*params,_like(text)[1:],PER_KIND))


def _articles(db, text):
    like = _like(text)
    return rows(db,'''SELECT id,title,category,visibility FROM knowledge_articles
                      WHERE title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\'
                      ORDER BY title LIKE ? ESCAPE '\\' DESC,updated_at DESC LIMIT ?''',(like,like,_like(text)[1:],PER_KIND))


def search(db, ctx, value):
    """{'query', 'cases', 'customers', 'articles'}: at most PER_KIND of each, nothing for an empty query."""
    text = query_of(value)
    if not text:
        return {'query':'','cases':[],'customers':[],'articles':[]}
    return {'query':text,'cases':_cases(db,ctx,text),'customers':_customers(db,ctx,text),'articles':_articles(db,text)}
