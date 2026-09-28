"""กำแพงคำชม: the customers' good words about the team, on the overview, for the whole organization to read.

Nobody types a praise in. It goes up by itself when
  a customer gives five stars with a comment on the survey (automation.rate_from_portal): the case's owner is praised;
  a customer's message praises the team, or thanks them in a sentence rather than a word ("ขอบคุณค่ะ" alone is
  manners, not praise): whoever on the team wrote the last reply before it is praised. A message that is also upset
  (ai/mood.py) or asks something more is not praise;
  a customer sends a heart back from the thank-you card of a finished case (automation/thanks.py): the member the
  card thanks is praised, with HEART_TEXT in place of words.

The wall shows the words (email addresses and phone numbers masked, at most TEXT_MAX), the stars, who was praised and
when: never the customer's name, the case or the conversation, so a colleague of another team reads the praise and
nothing of the work behind it. Colleagues cheer (one cheer each; the praised member does not cheer their own), and the
praised member and the organization's owners may take an item down.

  kudos         one row per praise: source 'csat', 'message' or 'thanks' and the survey's, the message's or the card's
                id and closing (once each).
  kudos_cheers  who cheered which, with the name they had then.

The words are the customer's, so they go with the customer: a PDPA erasure and the retention round take them off the
wall (forget_conversations), and an item whose conversation is in the recycle bin is not shown until it comes back."""

TEXT_MAX = 300
# The overview's card and the whole wall (its dialog), newest first.
CARD_SHOWN = 5
WALL_MAX = 60
WALL_DAYS = 90
# The customer's thanks refers to replies of the last fortnight at most; one praise per member per conversation a day.
REPLY_DAYS = 14
# "ขอบคุณ" in a sentence at least this long (letters only) is more than manners.
THANKS_MIN_LETTERS = 18

# What the wall says for a heart from the thank-you card, which has no words of the customer's.
HEART_TEXT = 'ส่งหัวใจขอบคุณกลับมาจากการ์ดขอบคุณ'

KUDOS_TABLE = '''CREATE TABLE IF NOT EXISTS {name} (
    id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('csat','message','thanks')), source_id TEXT NOT NULL,
    user_id TEXT NOT NULL, user_name TEXT NOT NULL, text TEXT NOT NULL, rating INTEGER, conversation_id TEXT NOT NULL,
    ticket_id TEXT, created_at TEXT NOT NULL, hidden_at TEXT, hidden_by TEXT NOT NULL DEFAULT '', UNIQUE(source,source_id)
)'''

TENANT_TABLES = KUDOS_TABLE.format(name='kudos')+''';
CREATE INDEX IF NOT EXISTS kudos_recent ON kudos(created_at);
CREATE INDEX IF NOT EXISTS kudos_user ON kudos(user_id,created_at);
CREATE TABLE IF NOT EXISTS kudos_cheers (
    kudos_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(kudos_id,user_id)
);
CREATE INDEX IF NOT EXISTS kudos_cheers_user ON kudos_cheers(user_id);
'''
