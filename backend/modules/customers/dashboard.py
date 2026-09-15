"""The customer's project dashboard across the organizations they are connected with (GET /api/customer/dashboard):
the budget and payments of the completed contracts the viewer has 'billing' on, the health of the completed projects
they have 'documents' on (plan against actual, contracts/health.py), and the service levels of their own cases per
organization. A team member sees only what their role allows: finance the money, technical the health.

Money (strings like "1234.50"): a milestone counts at its invoice's total once billed (VAT included) and, before that,
at its amount plus VAT when the organization is VAT-registered (what the invoice will say), so the contract total,
billed, paid and remaining (contract_total - paid) add up. Void invoices never count. Overdue: unpaid or slip
submitted with the due date before today. Health leaves out contracts without delivery milestones (an MA contract or
a pure payment schedule has no plan of work)."""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from backend.database import db as D
from backend.database.db import rows
from backend.modules.customers import repository
from backend.utils.dates import today, utc_now

ZERO = Decimal('0.00')
CENT = Decimal('0.01')
WAITING = ('unpaid','submitted')
HEALTH_ORDER = {'delayed':0,'on_track':1,'not_started':2,'ahead':3,'done':4}


def _text(amount):
    return f'{amount:.2f}'


def _expected(amount, vat):
    """What a milestone not billed yet will cost (the same sums as project._create_invoice)."""
    from backend.modules.contracts import project
    subtotal = amount.quantize(CENT)
    return subtotal+((subtotal*project.VAT_RATE/100).quantize(CENT,rounding=ROUND_HALF_UP) if vat else ZERO)


def _budget(contract, milestones, invoices, vat, day):
    """(project row with Decimal amounts, the invoices still to pay) of one contract."""
    from backend.modules.contracts import project, schema
    money = lambda i:schema.money(i['total'])
    billed_ms = {i['milestone_id'] for i in invoices}
    total = sum((money(i) for i in invoices),ZERO)+sum((_expected(schema.money(m['amount']),vat) for m in milestones
                                                        if m['id'] not in billed_ms and schema.money(m['amount'])>0),ZERO)
    waiting = sorted((i for i in invoices if i['status'] in WAITING),key=lambda i:(i['due_date'],i['number']))
    first = waiting[0] if waiting else None
    return ({'contract_id':contract['id'],'reference':schema.reference(contract),'title':contract['title'],'total':total,
             'billed':sum((money(i) for i in invoices),ZERO),'paid':sum((money(i) for i in invoices if i['status']=='paid'),ZERO),
             'outstanding':sum((money(i) for i in waiting),ZERO),'overdue':sum((money(i) for i in waiting if i['due_date']<day),ZERO),
             'next_due':{'invoice_id':first['id'],'reference':project.invoice_ref(first['number']),'due_date':first['due_date'],
                         'total':_text(money(first))} if first else None},waiting)


def _months(day):
    """The 12 months up to this one, oldest first ('YYYY-MM')."""
    year,month = int(day[:4]),int(day[5:7])
    found = []
    for _ in range(12):
        found.append(f'{year:04d}-{month:02d}')
        year,month = (year,month-1) if month>1 else (year-1,12)
    return found[::-1]


def _at(value):
    return dt.datetime.fromisoformat(value) if value else None


def _ratings(db, case_ids):
    if not case_ids:
        return []
    marks = ','.join('?'*len(case_ids))
    return [r['rating'] for r in rows(db,f'SELECT rating FROM csat_surveys WHERE ticket_id IN ({marks}) AND rating IS NOT NULL',tuple(case_ids))]


def _share(hits, count):
    return round(100*hits/count) if count else None


def sla(cases, ratings, moment):
    """Service levels of these cases (None when there is none). First response: minutes from the case's creation to the
    team's first reply, on time when not after first_response_due_at; resolution: hours to resolved_at against
    resolution_due_at. A case still waiting past its due time counts as late; one still within it is not counted yet."""
    if not cases:
        return None
    responses,response_hits,response_count = [],0,0
    resolutions,resolution_hits,resolution_count = [],0,0
    for t in cases:
        created,response_due,resolution_due = _at(t['created_at']),_at(t['first_response_due_at']),_at(t['resolution_due_at'])
        answered,resolved = _at(t['first_response_at']),_at(t['resolved_at'])
        if answered:
            responses.append((answered-created).total_seconds()/60)
            response_count += 1
            response_hits += not response_due or answered<=response_due
        elif response_due and response_due<moment:
            response_count += 1
        if resolved:
            resolutions.append((resolved-created).total_seconds()/3600)
            resolution_count += 1
            resolution_hits += not resolution_due or resolved<=resolution_due
        elif t['status'] not in ('resolved','closed') and resolution_due and resolution_due<moment:
            resolution_count += 1
    return {'cases':len(cases),'open':sum(t['status'] not in ('resolved','closed') for t in cases),
            'first_response_avg_minutes':round(sum(responses)/len(responses)) if responses else None,
            'first_response_on_time_pct':_share(response_hits,response_count),
            'resolution_avg_hours':round(sum(resolutions)/len(resolutions),1) if resolutions else None,
            'resolution_on_time_pct':_share(resolution_hits,resolution_count),
            'csat_avg':round(sum(ratings)/len(ratings),1) if ratings else None}


def build(cd, session):
    """{budget, health, sla} (see the module notes); amounts are strings like "1234.50", remaining = contract_total - paid.
    budget.projects: [{contract_id, org_slug, org_name, reference, title, total, billed, paid, outstanding, overdue,
    next_due}], budget.upcoming: [{invoice_id, contract_id, org_slug, org_name, reference, milestone_title, total,
    due_date, days_left (negative when overdue), status}] soonest first, budget.monthly: [{month 'YYYY-MM', paid}] over
    the last 12 months (empty before any payment); health.projects: [{contract_id, org_slug, org_name, reference, title,
    progress, planned, state, next, late, finished_at, final_due}] late ones first; sla.orgs: [{org_slug, org_name,
    cases, open, first_response_avg_minutes, first_response_on_time_pct, resolution_avg_hours, resolution_on_time_pct,
    csat_avg}] for organizations where the account has cases."""
    from backend.modules.client_team import access
    from backend.modules.contracts import health, project, repository as contracts, schema
    from backend.modules.customers import service
    found,_ = service._connected(cd,session)
    joined = set(repository.org_ids(cd,session['account_id']))
    day,moment = today(),utc_now()
    budget_rows,upcoming,paid,health_rows,sla_rows = [],[],[],[],[]
    for org in found:
        if org['id'] not in joined:
            continue
        label = {'org_slug':org['slug'],'org_name':org['name']}
        with D.tenant(org['id']) as db:
            reach = access.accessible(db,session['account_id'])
            done = [c for c in contracts.sent_with_ids(db,list(reach)) if c['status']=='completed']
            milestones = contracts.milestones_of(db,[c['id'] for c in done])
            billing = [c for c in done if 'billing' in reach[c['id']]['can']]
            if billing:
                vat = project.billing_settings(db)['vat_registered']=='1'
                invoices = contracts.invoices_of_contracts(db,[c['id'] for c in billing])
                for c in billing:
                    own = [i for i in invoices if i['contract_id']==c['id']]
                    row,waiting = _budget(c,milestones.get(c['id'],[]),own,vat,day)
                    budget_rows.append({**row,**label})
                    paid += [i for i in own if i['status']=='paid' and i['paid_at']]
                    upcoming += [{'invoice_id':i['id'],'contract_id':c['id'],**label,'reference':project.invoice_ref(i['number']),
                                  'milestone_title':i['milestone_title'],'total':_text(schema.money(i['total'])),'due_date':i['due_date'],
                                  'days_left':(dt.date.fromisoformat(i['due_date'])-dt.date.fromisoformat(day)).days,'status':i['status']}
                                 for i in waiting]
            for c in done:
                plan = milestones.get(c['id'],[])
                if 'documents' in reach[c['id']]['can'] and health.deliveries(plan):
                    health_rows.append({'contract_id':c['id'],**label,'reference':schema.reference(c),'title':c['title'],
                                        'progress':project.progress(plan,bool(c['delivered_at'])),**health.assess(plan,day)})
            cases = repository.cases_of(db,session['account_id'])
            levels = sla(cases,_ratings(db,[t['id'] for t in cases]),moment)
            if levels:
                sla_rows.append({**label,**levels})
    total = lambda key:sum((r[key] for r in budget_rows),ZERO)
    monthly = []
    if paid:
        by_month = {}
        for i in paid:
            by_month[i['paid_at'][:7]] = by_month.get(i['paid_at'][:7],ZERO)+schema.money(i['total'])
        monthly = [{'month':m,'paid':_text(by_month.get(m,ZERO))} for m in _months(day)]
    upcoming.sort(key=lambda i:(i['due_date'],i['reference']))
    health_rows.sort(key=lambda h:HEALTH_ORDER[h['state']])
    return {'budget':{'contract_total':_text(total('total')),'billed':_text(total('billed')),'paid':_text(total('paid')),
                      'outstanding':_text(total('outstanding')),'overdue':_text(total('overdue')),
                      'remaining':_text(total('total')-total('paid')),
                      'projects':[{**r,**{k:_text(r[k]) for k in ('total','billed','paid','outstanding','overdue')}} for r in budget_rows],
                      'upcoming':upcoming,'monthly':monthly},
            'health':{'summary':{s:sum(h['state']==s for h in health_rows) for s in health.STATES},'projects':health_rows},
            'sla':{'orgs':sla_rows}}
