"""Real HTTP/SQLite coverage for monthly history protection."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
PAST = '2001-01'
FUTURE = '2099-12'
CFG = {'tmall': {'feeRate': 0.03}}


class HistoryProtectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t4-history-')
        self.addCleanup(self.temp.cleanup)
        spec = importlib.util.spec_from_file_location('history_sync_api', ROOT / 'sync_api.py')
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'T4_DB': str(Path(self.temp.name) / 'workspace.sqlite3'),
                                     'T4_AUTH_MODE': 'allow'}):
            spec.loader.exec_module(self.api)
        self.server = self.api.ThreadingHTTPServer(('127.0.0.1', 0), self.api.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.url = f'http://127.0.0.1:{self.server.server_port}/api/t4/workspace'

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, method='GET', body=None):
        request = urllib.request.Request(
            self.url, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'X-T4-User': 'history-test'},
        )
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def seed(self, period=PAST, **extra):
        # Seed an existing deployment directly; creating locked historical data
        # over HTTP is itself a protected operation covered below.
        doc = {'periods': {period: {'tmall': {'day': {'retailIncome': 100}}}},
               'cfg': copy.deepcopy(CFG), 'channels': ['tmall'], **extra}
        encoded = json.dumps(doc)
        with self.api.connect() as connection:
            connection.execute(
                'INSERT INTO t4_workspaces VALUES (?, ?, 1, 1, ?)',
                (self.api.WORKSPACE, encoded, 'legacy'),
            )
            connection.execute(
                'INSERT INTO t4_workspace_revisions '
                '(workspace, version, document_json, updated_at, updated_by) VALUES (?, 1, ?, 1, ?)',
                (self.api.WORKSPACE, encoded, 'legacy'),
            )
        return doc

    def save(self, doc, version=1):
        return self.request('PUT', {'baseVersion': version, 'document': doc})

    def change(self, path, old, value, **overrides):
        return {'path': path, 'oldExists': True, 'old': old,
                'newExists': True, 'value': value, **overrides}

    def assert_locked(self, status, result, expected_doc, version=1):
        self.assertEqual(status, 409, result)
        self.assertEqual(result['error'], 'period_locked')
        self.assertIn(PAST, result['periods'])
        _, stored = self.request()
        self.assertEqual(stored['document'], expected_doc)
        self.assertEqual(stored['version'], version)
        with self.api.connect() as connection:
            count = connection.execute('SELECT COUNT(*) FROM t4_workspace_revisions').fetchone()[0]
        self.assertEqual(count, version)

    def test_full_write_cannot_change_or_delete_legacy_history(self):
        original = self.seed()
        for operation in ('change', 'delete'):
            with self.subTest(operation=operation):
                doc = copy.deepcopy(original)
                if operation == 'change':
                    doc['periods'][PAST]['tmall']['day']['retailIncome'] = 200
                else:
                    del doc['periods'][PAST]
                self.assert_locked(*self.save(doc), original)

    def test_cas_patch_cannot_change_or_delete_legacy_history(self):
        original = self.seed()
        for exists in (True, False):
            with self.subTest(newExists=exists):
                change = self.change(['periods', PAST, 'tmall', 'day', 'retailIncome'],
                                     100, 200, newExists=exists)
                result = self.request('PUT', {'baseVersion': 1, 'changes': [change]})
                self.assert_locked(*result, original)

    def test_simultaneous_full_unlock_and_data_change_is_rejected(self):
        original = self.seed()
        doc = copy.deepcopy(original)
        doc['periodLocks'] = {PAST: False}
        doc['periods'][PAST]['tmall']['day']['retailIncome'] = 200
        self.assert_locked(*self.save(doc), original)

    def test_simultaneous_patch_unlock_and_data_change_is_rejected(self):
        original = self.seed()
        changes = [self.change(['periodLocks', PAST], None, False, oldExists=False),
                   self.change(['periods', PAST, 'tmall', 'day', 'retailIncome'], 100, 200)]
        self.assert_locked(*self.request('PUT', {'baseVersion': 1, 'changes': changes}), original)

    def test_separate_patch_unlock_allows_edit_and_relock(self):
        original = self.seed()
        status, unlocked = self.request('PUT', {'baseVersion': 1, 'changes': [
            self.change(['periodLocks', PAST], None, False, oldExists=False)]})
        self.assertEqual(status, 200, unlocked)
        doc = unlocked['document']
        doc['periods'][PAST]['tmall']['day']['retailIncome'] = 200
        doc['periodLocks'][PAST] = True
        status, relocked = self.save(doc, unlocked['version'])
        self.assertEqual(status, 200, relocked)
        changed = copy.deepcopy(doc)
        changed['periods'][PAST]['tmall']['day']['retailIncome'] = 300
        self.assert_locked(*self.save(changed, relocked['version']), doc, relocked['version'])
        self.assertEqual(original['periods'][PAST]['tmall']['day']['retailIncome'], 100)

    def test_omitted_locks_preserve_existing_overrides(self):
        doc = self.seed(periodLocks={PAST: False, FUTURE: True})
        legacy = copy.deepcopy(doc)
        del legacy['periodLocks']
        legacy['periods'][PAST]['tmall']['day']['retailIncome'] = 200
        status, saved = self.save(legacy)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document'].get('periodLocks'), {PAST: False, FUTURE: True})

    def test_explicit_lock_removal_does_not_unlock_past_month(self):
        doc = self.seed(periodLocks={PAST: True})
        doc['periodLocks'] = {}
        status, removed = self.save(doc)
        self.assertEqual(status, 200, removed)
        original = copy.deepcopy(removed['document'])
        doc['periods'][PAST]['tmall']['day']['retailIncome'] = 200
        self.assert_locked(*self.save(doc, removed['version']), original, removed['version'])

    def test_explicit_future_lock_protects_history(self):
        original = self.seed(FUTURE, periodLocks={FUTURE: True})
        doc = copy.deepcopy(original)
        del doc['periodLocks'][FUTURE]
        doc['periods'][FUTURE]['tmall']['day']['retailIncome'] = 200
        status, result = self.save(doc)
        self.assertEqual(status, 409, result)
        self.assertIn(FUTURE, result['periods'])

    def test_future_period_is_editable_by_default(self):
        doc = self.seed(FUTURE)
        doc['periods'][FUTURE]['tmall']['day']['retailIncome'] = 200
        doc['cfg']['tmall']['feeRate'] = 0.06
        status, saved = self.save(doc)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document'], doc)

    def test_default_lock_uses_shanghai_month_boundary(self):
        class BoundaryClock:
            @staticmethod
            def now(tz=None):
                boundary = datetime(2026, 8, 31, 16, 30, tzinfo=timezone.utc)
                return boundary.astimezone(tz) if tz else boundary.replace(tzinfo=None)

        original = self.seed('2026-08')
        doc = copy.deepcopy(original)
        doc['periods']['2026-08']['tmall']['day']['retailIncome'] = 200
        with patch.object(self.api, 'datetime', BoundaryClock):
            status, rejected = self.save(doc)
            self.assertEqual(status, 409, rejected)
            self.assertIn('2026-08', rejected['periods'])
            doc = copy.deepcopy(original)
            doc['periods']['2026-09'] = {'tmall': {'day': {'retailIncome': 300}}}
            status, saved = self.save(doc)
            self.assertEqual(status, 200, saved)

    def test_global_cfg_cannot_recalculate_unsnapshotted_history(self):
        original = self.seed()
        doc = copy.deepcopy(original)
        doc['cfg']['tmall']['feeRate'] = 0.06
        self.assert_locked(*self.save(doc), original)
        changes = [self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.06)]
        self.assert_locked(*self.request('PUT', {'baseVersion': 1, 'changes': changes}), original)

    def test_equivalent_snapshot_allows_independent_global_cfg_change(self):
        doc = self.seed()
        doc['cfgByPeriod'] = {PAST: copy.deepcopy(CFG)}
        doc['cfg']['tmall']['feeRate'] = 0.06
        status, saved = self.save(doc)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['cfgByPeriod'][PAST], CFG)

    def test_equivalent_snapshot_can_be_backfilled_by_patch(self):
        self.seed()
        changes = [self.change(['cfgByPeriod', PAST], None, CFG, oldExists=False)]
        status, saved = self.request('PUT', {'baseVersion': 1, 'changes': changes})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['cfgByPeriod'][PAST], CFG)

    def test_locked_snapshot_cannot_change_or_fall_back_to_different_cfg(self):
        original = self.seed(cfgByPeriod={PAST: copy.deepcopy(CFG)})
        for operation in ('change', 'delete'):
            with self.subTest(operation=operation):
                doc = copy.deepcopy(original)
                if operation == 'change':
                    doc['cfgByPeriod'][PAST]['tmall']['feeRate'] = 0.09
                else:
                    doc['cfg']['tmall']['feeRate'] = 0.09
                    del doc['cfgByPeriod'][PAST]
                self.assert_locked(*self.save(doc), original)
        changes = [self.change(['cfgByPeriod', PAST, 'tmall', 'feeRate'], 0.03, 0.09)]
        self.assert_locked(*self.request('PUT', {'baseVersion': 1, 'changes': changes}), original)

    def test_new_past_period_requires_previously_persisted_unlock(self):
        doc = {'periods': {PAST: {'tmall': {'day': {'retailIncome': 100}}}},
               'cfg': {}, 'channels': [], 'periodLocks': {PAST: False}}
        status, rejected = self.save(doc, 0)
        self.assertEqual(status, 409, rejected)
        self.assertIn(PAST, rejected['periods'])
        unlocked = {**doc, 'periods': {}}
        status, first = self.save(unlocked, 0)
        self.assertEqual(status, 200, first)
        status, created = self.save(doc, first['version'])
        self.assertEqual(status, 200, created)
        self.assertEqual(created['document']['periods'], doc['periods'])

    def test_lock_values_must_be_booleans(self):
        original = self.seed()
        for value in (0, 1, None, 'false', {}):
            with self.subTest(value=value):
                doc = {**original, 'periodLocks': {PAST: value}}
                status, result = self.save(doc)
                self.assertEqual(status, 400, result)
        _, stored = self.request()
        self.assertEqual(stored['version'], 1)

    def test_stale_lock_cas_cannot_overwrite_newer_unlock(self):
        self.seed(periodLocks={PAST: True})
        change = self.change(['periodLocks', PAST], True, False)
        status, first = self.request('PUT', {'baseVersion': 1, 'changes': [change]})
        self.assertEqual(status, 200, first)
        stale = self.change(['periodLocks', PAST], True, None, newExists=False)
        status, result = self.request('PUT', {'baseVersion': 1, 'changes': [stale]})
        self.assertEqual(status, 409, result)
        self.assertEqual(result['error'], 'field_conflict')


if __name__ == '__main__':
    unittest.main()
