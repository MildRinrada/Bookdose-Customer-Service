"""The customer's service dashboard across the organizations they are connected with (GET /api/customer/dashboard):
the service levels of their own cases per organization - how fast the team answered and resolved them against the
SLA times, and the satisfaction ratings they gave."""
import datetime as dt

from backend.database import db as D
from backend.database.db import rows
from backend.modules.customers import repository
from backend.utils.dates import utc_now


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
    """{sla: {orgs: [{org_slug, org_name, cases, open, first_response_avg_minutes, first_response_on_time_pct,
    resolution_avg_hours, resolution_on_time_pct, csat_avg}]}} for the organizations where the account has cases."""
    from backend.modules.customers import service
    found,_ = service._connected(cd,session)
    joined = set(repository.org_ids(cd,session['account_id']))
    moment,sla_rows = utc_now(),[]
    for org in found:
        if org['id'] not in joined:
            continue
        with D.tenant(org['id']) as db:
            cases = repository.cases_of(db,session['account_id'])
            levels = sla(cases,_ratings(db,[t['id'] for t in cases]),moment)
        if levels:
            sla_rows.append({'org_slug':org['slug'],'org_name':org['name'],**levels})
    return {'sla':{'orgs':sla_rows}}
