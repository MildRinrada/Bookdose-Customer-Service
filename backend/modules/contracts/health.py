"""How a signed project stands against its plan (the customer's dashboard). Pure functions over the milestone rows, so
the rule is tested on its own; `today` is an ISO date ('YYYY-MM-DD').

Only delivery milestones make the plan (payments follow the money, not the work):
  all done     'ahead' when the last one was accepted before the latest due date, else 'done'
  otherwise    'delayed' when a delivery not done yet is past its due date; 'not_started' when no delivery has
               started (all pending at 0%); else 'on_track'
planned: the share (0-100) of the work that should be done by today, with the same weights as project.progress (the
amounts when every delivery has one, else equal): the deliveries whose due date is today or earlier."""
from datetime import date
from decimal import Decimal

from backend.modules.contracts import schema

STATES = ('on_track','delayed','ahead','done','not_started')


def deliveries(milestones):
    return [m for m in milestones if m['kind']=='delivery']


def weights(items):
    """Each delivery's weight: its amount when every delivery has one, else 1 (as project.progress)."""
    found = [schema.money(m['amount']) for m in items]
    return found if found and all(w>0 for w in found) else [Decimal(1)]*len(items)


def _day(value):
    return (value or '')[:10]


def planned(milestones, today):
    """0-100: the weighted share of deliveries due today or earlier (no due date: not planned yet)."""
    items = deliveries(milestones)
    if not items:
        return 0
    w = weights(items)
    return int(sum(x for x,m in zip(w,items) if m['due_date'] and m['due_date']<=today)*100/sum(w))


def state(milestones, today):
    """One of STATES (see the module notes). A project without deliveries is 'done'."""
    items = deliveries(milestones)
    if all(m['status']=='done' for m in items):
        dues = [m['due_date'] for m in items if m['due_date']]
        finished = max((_day(m['done_at']) for m in items if m['done_at']),default='')
        return 'ahead' if dues and finished and finished<max(dues) else 'done'
    if any(m['status']!='done' and m['due_date'] and m['due_date']<today for m in items):
        return 'delayed'
    if all(m['status']=='pending' and not m['progress'] for m in items):
        return 'not_started'
    return 'on_track'


def _days_between(start, end):
    return (date.fromisoformat(end)-date.fromisoformat(start)).days


def assess(milestones, today):
    """{planned, state, next:{title,due_date}|None, late:[{title,due_date,days_late}], finished_at, final_due}:
    next is the first delivery not done yet (in the contract's order); finished_at the last acceptance once every
    delivery is done; final_due the latest due date."""
    items = deliveries(milestones)
    open_items = [m for m in items if m['status']!='done']
    dues = [m['due_date'] for m in items if m['due_date']]
    first = open_items[0] if open_items else None
    return {'planned':planned(milestones,today),'state':state(milestones,today),
            'next':{'title':first['title'],'due_date':first['due_date'] or None} if first else None,
            'late':[{'title':m['title'],'due_date':m['due_date'],'days_late':_days_between(m['due_date'],today)}
                    for m in open_items if m['due_date'] and m['due_date']<today],
            'finished_at':max((m['done_at'] for m in items if m['done_at']),default=None) if items and not open_items else None,
            'final_due':max(dues) if dues else None}
