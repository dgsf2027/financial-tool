#!/usr/bin/env python3
"""Dependency-free T4 shared workspace service with CAS patches."""
import hashlib, hmac, json, math, os, re, sqlite3, time
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
    if path[0] in ('channels', 'expenseItems'):
        return len(path) == 1
    if len(path) < 2:
        return False
    if path[0] == 'periodLocks':
        return len(path) == 2 and bool(PERIOD_RE.fullmatch(path[1]))
    if path[0] == 'importHistory':
        return 2 <= len(path) <= 3 and bool(re.fullmatch(r'import_[a-zA-Z0-9_\-]{1,100}', path[1]))
    if path[0] in ('periods', 'cfgByPeriod'):
        return bool(PERIOD_RE.fullmatch(path[1]))
    return path[0] == 'cfg'

def validate_document(doc):
    if not isinstance(doc.get('channels', []), list):
        raise ValueError('channels must be an array')
    for channel in doc.get('channels', []):
        # Early documents used an ID-only roster; keep that harmless legacy
        # representation, but do not persist entries that crash the renderer.
        if isinstance(channel, str) and channel:
            continue
        if not isinstance(channel, dict):
            raise ValueError('channel entries must be objects')
        if not isinstance(channel.get('id'), str) or not channel['id']:
            raise ValueError('channel id must be a non-empty string')
        for field in ('n', 'bu'):
            if channel.get(field) is not None and not isinstance(channel[field], str):
                raise ValueError('channel ' + field + ' must be a string')
        validate_string_list(channel.get('aliases'), 'channel aliases')
        details = channel.get('details')
        if details is not None:
            if not isinstance(details, list):
                raise ValueError('channel details must be an array')
            for detail in details:
                if not isinstance(detail, dict):
                    raise ValueError('channel detail entries must be objects')
                if detail.get('source') is not None and not isinstance(detail['source'], str):
                    raise ValueError('channel detail source must be a string')
                validate_string_list(detail.get('aliases'), 'channel detail aliases')
                fields = detail.get('fields')
                if fields is not None:
                    if not isinstance(fields, list) or any(not isinstance(field, dict) for field in fields):
                        raise ValueError('channel detail fields must be an array of objects')
                    if any(not isinstance(field.get('name'), str) for field in fields):
                        raise ValueError('channel detail field name must be a string')
    for field in ('periods', 'cfg', 'periodLocks', 'cfgByPeriod', 'importHistory'):
        if not isinstance(doc.get(field, {}), dict):
            raise ValueError(field + ' must be an object')
    for field in ('periods', 'periodLocks', 'cfgByPeriod'):
        if any(not PERIOD_RE.fullmatch(period) for period in doc.get(field, {})):
            raise ValueError(field + ' must use YYYY-MM keys')
    if any(not isinstance(locked, bool) for locked in doc.get('periodLocks', {}).values()):
        raise ValueError('periodLocks values must be booleans')
    if any(not isinstance(cfg, dict) for cfg in doc.get('cfgByPeriod', {}).values()):
        raise ValueError('cfgByPeriod values must be objects')
    for configs in [doc.get('cfg', {}), *doc.get('cfgByPeriod', {}).values()]:
        if any(config is not None and not isinstance(config, dict) for config in configs.values()):
            raise ValueError('channel configuration must be an object')
    for channels in doc.get('periods', {}).values():
        if not isinstance(channels, dict):
            raise ValueError('period data must be an object')
        for dates in channels.values():
            if not isinstance(dates, dict):
                raise ValueError('channel daily data must be an object')
            for raw in dates.values():
                if not isinstance(raw, dict):
                    raise ValueError('daily entries must be objects')
                for field in ('_fileParts', '_srcs', '_manualFields'):
                    if raw.get(field) is not None and not isinstance(raw[field], dict):
                        raise ValueError(field + ' must be an object')
                if any(not isinstance(fields, dict) for fields in (raw.get('_fileParts') or {}).values()):
                    raise ValueError('file source entries must be objects')
    items = doc.get('expenseItems', [])
    if not isinstance(items, list) or len(items) > 100:
        raise ValueError('expenseItems must be an array of at most 100 items')
    keys, names = set(), set()
    for item in items:
        if not isinstance(item, dict): raise ValueError('invalid expense item')
        key, name = item.get('k'), item.get('n')
        if not isinstance(key, str) or not re.fullmatch(r'expense_[a-z0-9_]{1,64}', key) or key in keys:
            raise ValueError('invalid or duplicate expense key')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40 or re.search(r'[\x00-\x1f\x7f<>]', name) or name.strip() in names:
            raise ValueError('invalid or duplicate expense name')
        keys.add(key); names.add(name.strip())
    for key, record in doc.get('importHistory', {}).items():
        if not re.fullmatch(r'import_[a-zA-Z0-9_\-]{1,100}', key) or not isinstance(record, dict) or record.get('id') != key:
            raise ValueError('invalid import history id')
        if not PERIOD_RE.fullmatch(str(record.get('period', ''))): raise ValueError('invalid import period')
        for field, limit in [('fileName', 512), ('at', 64), ('actor', 128), ('scope', 120)]:
            if not isinstance(record.get(field), str) or not 1 <= len(record[field]) <= limit:
                raise ValueError('invalid import history ' + field)
        if record.get('mode') not in ('file', 'range'): raise ValueError('invalid import history mode')
        for field in ('used', 'skipped'):
            if isinstance(record.get(field), bool) or not isinstance(record.get(field), int) or record[field] < 0:
                raise ValueError('invalid import history count')
        for field in ('dates', 'channels', 'issues'):
            if not isinstance(record.get(field), list) or any(not isinstance(v, str) for v in record[field]):
                raise ValueError('invalid import history ' + field)
        if not record['dates'] or len(record['dates']) > 31 or not record['channels'] or len(record['channels']) > 10000:
            raise ValueError('invalid import history range')
        for date in [record.get('from'), record.get('to'), *record['dates']]:
            if not isinstance(date, str) or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', date) or not date.startswith(record['period'] + '-'):
                raise ValueError('invalid import history date')
            try: datetime.strptime(date, '%Y-%m-%d')
            except ValueError: raise ValueError('invalid import history date')
        if record['from'] > record['to']: raise ValueError('invalid import history range')

def validate_string_list(value, label):
    if value is not None and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
        raise ValueError(label + ' must be an array of strings')

def input_number(value):
    # Match the browser's numeric file-field coercion (+value || 0).
    try:
        number = float(value)
        return number if math.isfinite(number) else 0
    except (TypeError, ValueError, OverflowError):
        return 0

def file_input_value(raw, key):
    parts = raw.get('_fileParts')
    if not isinstance(parts, dict): return None
    priority = ('summaryIncome', 'summaryCost', 'summaryDaily', 'daily')
    for source in priority:
        fields = parts.get(source)
        if isinstance(fields, dict) and fields.get(key) is not None:
            return input_number(fields[key])
    value, found = 0, False
    for source, fields in parts.items():
        if source not in priority and isinstance(fields, dict) and fields.get(key) is not None:
            value += input_number(fields[key]); found = True
    return value if found else None

def input_value(raw, key):
    return input_number(raw[key]) if raw.get(key) is not None else file_input_value(raw, key)

def income_override_risk(raw):
    # A negative daily result alone is valid. We need both a distinct imported
    # gross amount and a top-level override equal to its explicitly deducted net.
    # Legacy file rows without _fileParts have no independent gross evidence.
    if not isinstance(raw, dict) or not isinstance(raw.get('_fileParts'), dict) or raw.get('retailIncome') is None:
        return None
    file_income = file_input_value(raw, 'retailIncome')
    if file_income is None: return None
    try: manual_income = float(raw['retailIncome'].strip() or '0') if isinstance(raw['retailIncome'], str) else float(raw['retailIncome'])
    except (TypeError, ValueError, OverflowError): return None
    deductions = ((input_value(raw, 'returnAmount') or 0) + (input_value(raw, 'refundAmount') or 0)
                  - abs(input_value(raw, 'rebateAmount') or 0))
    net_income = file_income + deductions
    if not all(math.isfinite(n) and math.isfinite(n * 100) for n in (file_income, manual_income, deductions, net_income)):
        return None
    # Python round uses ties-to-even; the browser uses Math.round.
    cents = lambda n: math.floor(n * 100 + 0.5)
    if deductions < -0.005 and cents(manual_income) != cents(file_income) and cents(manual_income) == cents(net_income):
        return (file_income, manual_income, deductions, net_income)
    return None

def validate_income_overrides(current, next_doc):
    old_periods = current.get('periods', {})
    names = {channel.get('id'): channel.get('n') for channel in next_doc.get('channels', [])
             if isinstance(channel, dict) and isinstance(channel.get('id'), str) and isinstance(channel.get('n'), str)}
    for period, channels in next_doc.get('periods', {}).items():
        if not isinstance(channels, dict): continue
        old_channels = old_periods.get(period, {})
        for channel, dates in channels.items():
            if not isinstance(dates, dict): continue
            old_dates = old_channels.get(channel, {}) if isinstance(old_channels, dict) else {}
            for date, raw in dates.items():
                risk = income_override_risk(raw)
                old_raw = old_dates.get(date) if isinstance(old_dates, dict) else None
                # Existing anomalies must not prevent unrelated edits. A changed
                # signature still needs correction, including after a CAS merge.
                if risk is None or risk == income_override_risk(old_raw): continue
                raise ValueError('%s 渠道 %s：疑似重复扣退，手工零售收入已等于导入销售额扣退后的净额，退货、退款及返款仍会另行扣减。请填写扣退前销售额，或清除零售收入覆盖以恢复导入值。'
                                 % (date, names.get(channel) or channel))

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
                    for field in ('periodLocks', 'importHistory', 'expenseItems'):
                        if field not in next_doc and field in current:
                            next_doc[field] = current[field]
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
                # Import records are append-only and the authenticated proxy
                # identity owns the audit stamp, not a browser-supplied name.
                old_history = current.get('importHistory', {})
                history = next_doc.get('importHistory', {})
                if any(history.get(key) != record for key, record in old_history.items()):
                    raise ValueError('import history is append-only')
                for key in history.keys() - old_history.keys():
                    history[key]['actor'] = user
                    history[key]['at'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                protected = protected_period_changes(current, next_doc)
                if protected:
                    c.execute('ROLLBACK')
                    return reply(self,409,{'ok':False,'error':'period_locked','version':current_version,'periods':protected})
                validate_income_overrides(current, next_doc)
                encoded=json.dumps(next_doc,ensure_ascii=False,separators=(',',':'),allow_nan=False); next_version=current_version+1
                c.execute('''INSERT INTO t4_workspaces(workspace,document_json,version,updated_at,updated_by) VALUES(?,?,?,?,?)
                  ON CONFLICT(workspace) DO UPDATE SET document_json=excluded.document_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',(WORKSPACE,encoded,next_version,now,user))
                c.execute('INSERT INTO t4_workspace_revisions(workspace,version,document_json,updated_at,updated_by) VALUES(?,?,?,?,?)',(WORKSPACE,next_version,encoded,now,user)); c.execute('COMMIT')
            return reply(self,200,{'ok':True,'workspace':WORKSPACE,'version':next_version,'updatedAt':now,'updatedBy':user,'document':next_doc})
        except (ValueError,TypeError,OverflowError,json.JSONDecodeError) as exc: return reply(self,400,{'ok':False,'error':str(exc)[:160]})
        except Exception as exc: return reply(self,500,{'ok':False,'error':'storage_error','detail':str(exc)[:160]})

if __name__ == '__main__': ThreadingHTTPServer(('0.0.0.0',PORT),Handler).serve_forever()
