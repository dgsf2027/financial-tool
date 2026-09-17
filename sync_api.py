#!/usr/bin/env python3
"""Dependency-free T4 shared workspace service with CAS patches."""
import hashlib, hmac, json, os, re, sqlite3, time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DB = os.environ.get('T4_DB', '/data/t4.sqlite3')
PORT = int(os.environ.get('PORT', '8099'))
AUTH_MODE = os.environ.get('T4_AUTH_MODE', 'deny').lower()
PROXY_SECRET = os.environ.get('T4_PROXY_SECRET', '')
MAX_BODY = 16 * 1024 * 1024
MAX_CHANGES = 100000
WORKSPACE = 'finance-t4'
PERIOD_RE = re.compile(r'^20\d{2}-(0[1-9]|1[0-2])$')
os.makedirs(os.path.dirname(DB) or '.', exist_ok=True)

def connect():
    c = sqlite3.connect(DB, timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA busy_timeout=10000')
    return c

with connect() as c:
    c.execute('''CREATE TABLE IF NOT EXISTS t4_workspaces (
      workspace TEXT PRIMARY KEY, document_json TEXT NOT NULL,
      version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS t4_workspace_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL,
      version INTEGER NOT NULL, document_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL)''')

def reply(h, code, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    h.send_response(code); h.send_header('Content-Type', 'application/json; charset=utf-8')
    h.send_header('Cache-Control', 'no-store'); h.send_header('Content-Length', str(len(body)))
    h.end_headers(); h.wfile.write(body)

def auth_user(h):
    # Production is fail-closed. Local tests may use allow; production uses a
    # shared HMAC between the Node session proxy and this private service.
    user = (h.headers.get('X-T4-User') or '').strip()
    if AUTH_MODE == 'allow':
        user = user or 'local-test'
        return user[:128] if user else None
    if AUTH_MODE != 'proxy' or not PROXY_SECRET or not user:
        return None
    supplied = (h.headers.get('X-T4-Proxy-Signature') or '').strip()
    expected = hmac.new(PROXY_SECRET.encode(), user.encode(), hashlib.sha256).hexdigest()
    if not supplied or not hmac.compare_digest(supplied, expected):
        return None
    return user[:128]

def read_json(h):
    try: n = int(h.headers.get('Content-Length') or '0')
    except ValueError: raise ValueError('invalid content length')
    if n <= 0 or n > MAX_BODY: raise ValueError('body too large')
    obj = json.loads(h.rfile.read(n).decode('utf-8'))
    if not isinstance(obj, dict): raise ValueError('json object required')
    return obj

def valid_path(path):
    if not (isinstance(path, list) and 1 <= len(path) <= 7
            and all(isinstance(x, str) and 0 < len(x) <= 120 and '..' not in x
                    and x not in ('__proto__', 'constructor', 'prototype') for x in path)):
        return False
    # Channel overrides are an ordered array. Treat the array as a single CAS
    # value; object-style writes beneath it would replace it with a dictionary.
    if path[0] == 'channels':
        return len(path) == 1
    if len(path) < 2:
        return False
    if path[0] == 'periodLocks':
        return len(path) == 2 and bool(PERIOD_RE.fullmatch(path[1]))
    if path[0] in ('periods', 'cfgByPeriod'):
        return bool(PERIOD_RE.fullmatch(path[1]))
    return path[0] == 'cfg'

def validate_document(doc):
    if not isinstance(doc.get('channels', []), list):
        raise ValueError('channels must be an array')
    for field in ('periods', 'cfg', 'periodLocks', 'cfgByPeriod'):
        if not isinstance(doc.get(field, {}), dict):
            raise ValueError(field + ' must be an object')
    for field in ('periods', 'periodLocks', 'cfgByPeriod'):
        if any(not PERIOD_RE.fullmatch(period) for period in doc.get(field, {})):
            raise ValueError(field + ' must use YYYY-MM keys')
    if any(not isinstance(locked, bool) for locked in doc.get('periodLocks', {}).values()):
        raise ValueError('periodLocks values must be booleans')
    if any(not isinstance(cfg, dict) for cfg in doc.get('cfgByPeriod', {}).values()):
        raise ValueError('cfgByPeriod values must be objects')

def protected_period_changes(current, next_doc):
    # Check the persisted lock state, never an unlock in the candidate write.
    # China has no daylight saving time; UTC+8 is the business month boundary.
    current_month = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m')
    old_periods, new_periods = current.get('periods', {}), next_doc.get('periods', {})
    old_cfgs, new_cfgs = current.get('cfgByPeriod', {}), next_doc.get('cfgByPeriod', {})
    locks = current.get('periodLocks', {})
    protected = []
    for period in sorted(set(old_periods) | set(new_periods) | set(old_cfgs) | set(new_cfgs)):
        if not locks.get(period, period < current_month):
            continue
        old_data = (period in old_periods, old_periods.get(period))
        new_data = (period in new_periods, new_periods.get(period))
        old_cfg = old_cfgs.get(period, current.get('cfg', {}))
        new_cfg = new_cfgs.get(period, next_doc.get('cfg', {}))
        if old_data != new_data or old_cfg != new_cfg:
            protected.append(period)
    return protected

def get_at(doc, path):
    cur = doc
    for key in path:
        if not isinstance(cur, dict) or key not in cur: return False, None
        cur = cur[key]
    return True, cur

def ancestor_deleted(previous, current, path):
    # A formerly existing row/month must not be resurrected by a stale edit
    # that adds a previously absent leaf. Originally absent branches can merge.
    for key in path[:-1]:
        if not isinstance(previous, dict) or key not in previous: return False
        if not isinstance(current, dict) or key not in current: return True
        previous, current = previous[key], current[key]
    return False

def set_at(doc, path, exists, value):
    cur = doc
    for key in path[:-1]:
        if key not in cur:
            if not exists: return True
            cur[key] = {}
        elif not isinstance(cur[key], dict):
            # A missing leaf does not authorize replacing a scalar/array that
            # another editor stored at an ancestor of that leaf.
            return not exists
        cur = cur[key]
    if exists: cur[path[-1]] = value
    else: cur.pop(path[-1], None)
    return True

class Handler(BaseHTTPRequestHandler):
    server_version = 'finance-t4-sync/1'
    def log_message(self, *_): return
    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/healthz':
            try:
                with connect() as c: c.execute('SELECT 1').fetchone()
                return reply(self, 200, {'ok': True, 'app': 'yc-finance-sync', 'authMode': AUTH_MODE})
            except Exception as exc: return reply(self, 503, {'ok': False, 'error': str(exc)[:160]})
        if path != '/api/t4/workspace': return reply(self, 404, {'error':'not found'})
        user = auth_user(self)
        if not user: return reply(self, 401, {'ok':False,'error':'authentication_required'})
        with connect() as c: row = c.execute('SELECT * FROM t4_workspaces WHERE workspace=?',(WORKSPACE,)).fetchone()
        if not row: return reply(self, 200, {'ok':True,'workspace':WORKSPACE,'found':False,'version':0,'document':{'periods':{},'cfg':{},'channels':[]}})
        return reply(self, 200, {'ok':True,'workspace':WORKSPACE,'found':True,'version':row['version'],
                                 'document':json.loads(row['document_json']),'updatedAt':row['updated_at'],'updatedBy':row['updated_by']})
    def do_PUT(self):
        if urlparse(self.path).path != '/api/t4/workspace': return reply(self,404,{'error':'not found'})
        user = auth_user(self)
        if not user: return reply(self,401,{'ok':False,'error':'authentication_required'})
        try:
            body = read_json(self); base = body.get('baseVersion')
            if isinstance(base,bool) or not isinstance(base,int) or base < 0: raise ValueError('baseVersion must be a non-negative integer')
            changes = body.get('changes'); document = body.get('document')
            if changes is not None and (not isinstance(changes,list) or len(changes)>MAX_CHANGES):
                raise ValueError('changes must be an array of at most %d items' % MAX_CHANGES)
            if changes is None and not isinstance(document,dict): raise ValueError('document required')
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc: return reply(self,400,{'ok':False,'error':str(exc)[:160]})
        now = int(time.time()*1000)
        try:
            with connect() as c:
                c.execute('BEGIN IMMEDIATE')
                row = c.execute('SELECT * FROM t4_workspaces WHERE workspace=?',(WORKSPACE,)).fetchone()
                current_version = int(row['version']) if row else 0
                current = json.loads(row['document_json']) if row else {'periods':{},'cfg':{},'channels':[]}
                if base > current_version: c.execute('ROLLBACK'); return reply(self,409,{'ok':False,'error':'version_conflict','version':current_version})
                if changes is None:
                    if base != current_version: c.execute('ROLLBACK'); return reply(self,409,{'ok':False,'error':'version_conflict','version':current_version})
                    next_doc = document
                    # Older clients do not know about lock overrides. A full
                    # save from one must not discard the persisted decisions.
                    if 'periodLocks' not in next_doc and 'periodLocks' in current:
                        next_doc['periodLocks'] = current['periodLocks']
                else:
                    base_document = current
                    if base < current_version:
                        if base == 0:
                            base_document = {'periods':{},'cfg':{},'channels':[]}
                        else:
                            revision = c.execute(
                                'SELECT document_json FROM t4_workspace_revisions WHERE workspace=? AND version=?',
                                (WORKSPACE, base)).fetchone()
                            if not revision:
                                c.execute('ROLLBACK')
                                return reply(self,409,{'ok':False,'error':'version_conflict','version':current_version})
                            base_document = json.loads(revision['document_json'])
                    next_doc = json.loads(json.dumps(current, ensure_ascii=False)); conflicts=[]
                    for change in changes:
                        if not isinstance(change,dict) or not valid_path(change.get('path')): raise ValueError('invalid change path')
                        expected_exists=change.get('oldExists',False); new_exists=change.get('newExists',True)
                        if not isinstance(expected_exists,bool) or not isinstance(new_exists,bool):
                            raise ValueError('oldExists and newExists must be booleans')
                        path=change['path']; old_exists,old=get_at(current,path); expected=change.get('old'); value=change.get('value')
                        # A retry that asks for the already-persisted value (or
                        # deletion) is harmless, even with a stale base version.
                        if old_exists == new_exists and (not old_exists or old == value): continue
                        if (old_exists == expected_exists and (not old_exists or old == expected)
                                and not ancestor_deleted(base_document,current,path)
                                and set_at(next_doc,path,new_exists,value)):
                            continue
                        conflicts.append({'path':path,'current':old if old_exists else None,'currentExists':old_exists})
                    if conflicts: c.execute('ROLLBACK'); return reply(self,409,{'ok':False,'error':'field_conflict','version':current_version,'conflicts':conflicts[:100]})
                validate_document(next_doc)
                protected = protected_period_changes(current, next_doc)
                if protected:
                    c.execute('ROLLBACK')
                    return reply(self,409,{'ok':False,'error':'period_locked','version':current_version,'periods':protected})
                encoded=json.dumps(next_doc,ensure_ascii=False,separators=(',',':'),allow_nan=False); next_version=current_version+1
                c.execute('''INSERT INTO t4_workspaces(workspace,document_json,version,updated_at,updated_by) VALUES(?,?,?,?,?)
                  ON CONFLICT(workspace) DO UPDATE SET document_json=excluded.document_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',(WORKSPACE,encoded,next_version,now,user))
                c.execute('INSERT INTO t4_workspace_revisions(workspace,version,document_json,updated_at,updated_by) VALUES(?,?,?,?,?)',(WORKSPACE,next_version,encoded,now,user)); c.execute('COMMIT')
            return reply(self,200,{'ok':True,'workspace':WORKSPACE,'version':next_version,'updatedAt':now,'updatedBy':user,'document':next_doc})
        except (ValueError,TypeError,OverflowError,json.JSONDecodeError) as exc: return reply(self,400,{'ok':False,'error':str(exc)[:160]})
        except Exception as exc: return reply(self,500,{'ok':False,'error':'storage_error','detail':str(exc)[:160]})

if __name__ == '__main__': ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
