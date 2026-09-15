import json, os, subprocess, tempfile, time, unittest, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(__file__))

class SyncApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = tempfile.mktemp(prefix='t4-test-', suffix='.sqlite3')
        cls.port = 18299
        env = {**os.environ, 'T4_DB': cls.db, 'T4_AUTH_MODE': 'allow', 'PORT': str(cls.port)}
        cls.proc = subprocess.Popen(['python3', 'sync_api.py'], cwd=ROOT, env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(.2)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(timeout=3)

    def request(self, method, obj=None, user='test'):
        data = None if obj is None else json.dumps(obj).encode()
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}/api/t4/workspace', data=data,
                                     headers={'X-T4-User': user, 'Content-Type': 'application/json'}, method=method)
        try:
            with urllib.request.urlopen(req) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)

    def test_auth_and_disjoint_patch(self):
        status, _ = self.request('GET'); self.assertEqual(status, 200)
        doc = {'periods': {'2026-09': {'tmall': {'2026-09-15': {'retailIncome': 999}}}}, 'cfg': {}, 'channels': []}
        status, first = self.request('PUT', {'baseVersion': 0, 'document': doc}, 'A'); self.assertEqual(status, 200)
        patch = {'baseVersion': first['version'], 'changes': [{'path': ['periods','2026-09','tmall','2026-09-15','retailCost'], 'oldExists': False, 'newExists': True, 'value': 123}]}
        status, second = self.request('PUT', patch, 'B'); self.assertEqual(status, 200)
        self.assertEqual(second['document']['periods']['2026-09']['tmall']['2026-09-15']['retailCost'], 123)

    def test_stale_full_write_is_rejected(self):
        status, x = self.request('GET'); self.assertEqual(status, 200)
        status, _ = self.request('PUT', {'baseVersion': x['version'], 'document': x['document']}, 'A'); self.assertEqual(status, 200)
        status, conflict = self.request('PUT', {'baseVersion': x['version'], 'document': x['document']}, 'B')
        self.assertEqual(status, 409); self.assertEqual(conflict['error'], 'version_conflict')

if __name__ == '__main__': unittest.main()
