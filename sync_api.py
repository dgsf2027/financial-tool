#!/usr/bin/env python3
import json, os, sqlite3, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

DB = os.environ.get('T4_DB', '/data/t4.sqlite3')
os.makedirs(os.path.dirname(DB), exist_ok=True)
conn = sqlite3.connect(DB)
conn.execute('''CREATE TABLE IF NOT EXISTS t4_periods (
 period TEXT NOT NULL, entity_id TEXT NOT NULL, data_json TEXT NOT NULL,
 cfg_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(period, entity_id))''')
conn.commit(); conn.close()

def db(): return sqlite3.connect(DB)
def json_body(handler):
 n=int(handler.headers.get('Content-Length','0')); return json.loads(handler.rfile.read(n) or b'{}')
def reply(h, code, obj):
 b=json.dumps(obj, ensure_ascii=False).encode(); h.send_response(code); h.send_header('Content-Type','application/json; charset=utf-8'); h.send_header('Content-Length',str(len(b))); h.end_headers(); h.wfile.write(b)
class H(BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_GET(self):
  p=urlparse(self.path)
  if p.path=='/healthz': return reply(self,200,{'ok':True,'app':'yc-finance-sync'})
  if p.path!='/api/t4/data': return reply(self,404,{'error':'not found'})
  q=parse_qs(p.query); period=q.get('period',[''])[0]; entity=q.get('entity',['global'])[0]
  if not period: return reply(self,400,{'error':'period required'})
  c=db(); row=c.execute('SELECT data_json,cfg_json,version,updated_at,updated_by FROM t4_periods WHERE period=? AND entity_id=?',(period,entity)).fetchone(); c.close()
  if not row: return reply(self,200,{'ok':True,'found':False,'period':period,'entity':entity})
  return reply(self,200,{'ok':True,'found':True,'period':period,'entity':entity,'data':json.loads(row[0]),'cfg':json.loads(row[1]),'version':row[2],'updatedAt':row[3],'updatedBy':row[4]})
 def do_PUT(self):
  if urlparse(self.path).path!='/api/t4/data': return reply(self,404,{'error':'not found'})
  try: body=json_body(self); period=str(body.get('period','')); entity=str(body.get('entity') or 'global'); data=body.get('data') or {}; cfg=body.get('cfg') or {}; expected=body.get('version'); user=str(body.get('updatedBy') or '')
  except Exception: return reply(self,400,{'error':'invalid json'})
  if not period: return reply(self,400,{'error':'period required'})
  now=int(time.time()*1000); c=db(); row=c.execute('SELECT version FROM t4_periods WHERE period=? AND entity_id=?',(period,entity)).fetchone(); current=row[0] if row else 0
  if expected is not None and int(expected)!=current: c.close(); return reply(self,409,{'ok':False,'error':'version_conflict','version':current})
  newv=current+1; c.execute('INSERT INTO t4_periods(period,entity_id,data_json,cfg_json,version,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(period,entity_id) DO UPDATE SET data_json=excluded.data_json,cfg_json=excluded.cfg_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by',(period,entity,json.dumps(data,ensure_ascii=False),json.dumps(cfg,ensure_ascii=False),newv,now,user)); c.commit(); c.close()
  return reply(self,200,{'ok':True,'period':period,'entity':entity,'version':newv,'updatedAt':now})
HTTPServer(('0.0.0.0', int(os.environ.get('PORT','8099'))), H).serve_forever()
