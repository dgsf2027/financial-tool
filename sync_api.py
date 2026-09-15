#!/usr/bin/env python3
"""Dependency-free T4 shared workspace service with CAS patches."""
import json, os, re, sqlite3, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

DB = os.environ.get('T4_DB', '/data/t4.sqlite3')
PORT = int(os.environ.get('PORT', '8099'))
AUTH_MODE = os.environ.get('T4_AUTH_MODE', 'deny').lower()
MAX_BODY = 16 * 1024 * 1024
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
    # Production is fail-closed. Isolated local test compose sets T4_AUTH_MODE=allow.
    if AUTH_MODE != 'allow': return None
    user = (h.headers.get('X-T4-User') or 'local-test').strip()
    return user[:128] if user else None

def read_json(h):
    try: n = int(h.headers.get('Content-Length') or '0')
    except ValueError: raise ValueError('invalid content length')
    if n <= 0 or n > MAX_BODY: raise ValueError('body too large')
    obj = json.loads(h.rfile.read(n).decode('utf-8'))
    if not isinstance(obj, dict): raise ValueError('json object required')
    return obj

def valid_path(path):
    return (isinstance(path, list) and 3 <= len(path) <= 6 and path[0] in ('periods','cfg','channels')
            and all(isinstance(x, str) and len(x) <= 120 and '..' not in x for x in path))

def get_at(doc, path):
    cur = doc
    for key in path:
        if not isinstance(cur, dict) or key not in cur: return False, None
        cur = cur[key]
    return True, cur

def set_at(doc, path, exists, value):
    cur = doc
    for key in path[:-1]:
        if not isinstance(cur.get(key), dict): cur[key] = {}
        cur = cur[key]
    if exists: cur[path[-1]] = value
    else: cur.pop(path[-1], None)

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
            if changes is not None and (not isinstance(changes,list) or len(changes)>10000): raise ValueError('changes must be an array')
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
                else:
                    next_doc = json.loads(json.dumps(current, ensure_ascii=False)); conflicts=[]
                    for change in changes:
                        if not isinstance(change,dict) or not valid_path(change.get('path')): raise ValueError('invalid change path')
                        path=change['path']; old_exists,old=get_at(current,path); expected_exists=bool(change.get('oldExists',False)); expected=change.get('old'); new_exists=bool(change.get('newExists',True)); value=change.get('value')
                        if old_exists == expected_exists and (not old_exists or old == expected): set_at(next_doc,path,new_exists,value)
                        elif old_exists and new_exists and old == value: continue
                        else: conflicts.append({'path':path,'current':old if old_exists else None,'currentExists':old_exists})
                    if conflicts: c.execute('ROLLBACK'); return reply(self,409,{'ok':False,'error':'field_conflict','version':current_version,'conflicts':conflicts[:100]})
                encoded=json.dumps(next_doc,ensure_ascii=False,separators=(',',':'),allow_nan=False); next_version=current_version+1
                c.execute('''INSERT INTO t4_workspaces(workspace,document_json,version,updated_at,updated_by) VALUES(?,?,?,?,?)
                  ON CONFLICT(workspace) DO UPDATE SET document_json=excluded.document_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',(WORKSPACE,encoded,next_version,now,user))
                c.execute('INSERT INTO t4_workspace_revisions(workspace,version,document_json,updated_at,updated_by) VALUES(?,?,?,?,?)',(WORKSPACE,next_version,encoded,now,user)); c.execute('COMMIT')
            return reply(self,200,{'ok':True,'workspace':WORKSPACE,'version':next_version,'updatedAt':now,'updatedBy':user,'document':next_doc})
        except (ValueError,TypeError,OverflowError,json.JSONDecodeError) as exc: return reply(self,400,{'ok':False,'error':str(exc)[:160]})
        except Exception as exc: return reply(self,500,{'ok':False,'error':'storage_error','detail':str(exc)[:160]})

if __name__ == '__main__': ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
