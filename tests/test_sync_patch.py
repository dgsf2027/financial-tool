"""HTTP/SQLite regressions for the field-level T4 save contract."""
import copy
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
MONTH = '2099-01'
DAY = '2099-01-01'


class SyncPatchTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t4-patches-')
        self.addCleanup(self.temp.cleanup)
        spec = importlib.util.spec_from_file_location('patch_sync_api', ROOT / 'sync_api.py')
        self.api = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'T4_DB': str(Path(self.temp.name) / 'workspace.sqlite3'),
                                     'T4_AUTH_MODE': 'allow'}):
            spec.loader.exec_module(self.api)
        self.server = self.api.ThreadingHTTPServer(('127.0.0.1', 0), self.api.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.url = f'http://127.0.0.1:{self.server.server_port}/api/t4/workspace'
        self.original = {
            'periods': {MONTH: {'tmall': {DAY: {
                'retailIncome': 100, '_fileParts': {'sales': {'retailCost': 40}},
            }}}},
            'cfg': {'tmall': {'feeRate': 0.03}, 'jd': {'feeRate': 0.05}},
            'cfgByPeriod': {MONTH: {'tmall': {'feeRate': 0.03}}},
            'channels': [{'id': 'custom', 'n': '自定义渠道'}],
            'periodLocks': {},
            'metadata': {'importedBy': 'legacy'},
        }
        status, result = self.request('PUT', {'baseVersion': 0, 'document': self.original})
        self.assertEqual(status, 200, result)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, method='GET', body=None):
        req = urllib.request.Request(
            self.url, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type': 'application/json', 'X-T4-User': 'patch-test'},
        )
        try:
            response = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def change(self, path, old=None, value=None, **overrides):
        return {'path': path, 'oldExists': True, 'old': old,
                'newExists': True, 'value': value, **overrides}

    def save_changes(self, *changes, version=1):
        return self.request('PUT', {'baseVersion': version, 'changes': list(changes)})

    def assert_unchanged(self, expected=None, version=1):
        status, stored = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(stored['document'], self.original if expected is None else expected)
        self.assertEqual(stored['version'], version)

    def test_disjoint_stale_saves_merge_without_losing_document_metadata(self):
        status, first = self.save_changes(self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.04))
        self.assertEqual(status, 200, first)
        status, second = self.save_changes(self.change(['cfg', 'jd', 'feeRate'], 0.05, 0.06))
        self.assertEqual(status, 200, second)
        self.assertEqual(second['document']['cfg'], {'tmall': {'feeRate': 0.04}, 'jd': {'feeRate': 0.06}})
        self.assertEqual(second['document']['metadata'], {'importedBy': 'legacy'})

    def test_overlapping_stale_save_rejects_all_changes_atomically(self):
        status, first = self.save_changes(self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.04))
        self.assertEqual(status, 200, first)
        status, conflict = self.save_changes(
            self.change(['cfg', 'jd', 'feeRate'], 0.05, 0.06),
            self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.07))
        self.assertEqual(status, 409, conflict)
        self.assertEqual(conflict['error'], 'field_conflict')
        self.assertEqual(conflict['conflicts'][0]['path'], ['cfg', 'tmall', 'feeRate'])
        self.assert_unchanged(first['document'], first['version'])

    def test_channels_array_uses_whole_value_compare_and_swap(self):
        channels = self.original['channels'] + [{'id': 'new', 'n': '新渠道'}]
        status, saved = self.save_changes(self.change(['channels'], self.original['channels'], channels))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['channels'], channels)
        status, conflict = self.save_changes(self.change(['channels'], self.original['channels'], []))
        self.assertEqual(status, 409, conflict)
        self.assertEqual(conflict['error'], 'field_conflict')
        self.assert_unchanged(saved['document'], saved['version'])

    def test_nested_channels_path_cannot_convert_array_to_object(self):
        for path in (['channels', '0'], ['channels', '0', 'n']):
            with self.subTest(path=path):
                status, rejected = self.save_changes(self.change(path, value='changed', oldExists=False))
                self.assertEqual(status, 400, rejected)
                self.assert_unchanged()

    def test_channels_replacement_must_remain_an_array(self):
        status, rejected = self.save_changes(self.change(['channels'], self.original['channels'], {}))
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged()

    def test_import_source_fields_accept_seven_part_paths(self):
        path = ['periods', MONTH, 'tmall', DAY, '_fileParts', 'sales', 'retailCost']
        status, saved = self.save_changes(self.change(path, 40, 45))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'][MONTH]['tmall'][DAY]['_fileParts']['sales']['retailCost'], 45)

    def test_cfg_channel_deletion_does_not_remove_other_channels(self):
        status, saved = self.save_changes(self.change(['cfg', 'tmall'], {'feeRate': 0.03}, newExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['cfg'], {'jd': {'feeRate': 0.05}})

    def test_whole_month_deletion_uses_compare_and_swap(self):
        status, saved = self.save_changes(self.change(['periods', MONTH], self.original['periods'][MONTH], newExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'], {})

    def test_cfg_by_period_fields_and_month_deletion_are_supported(self):
        status, saved = self.save_changes(self.change(['cfgByPeriod', MONTH, 'tmall', 'feeRate'], 0.03, 0.04))
        self.assertEqual(status, 200, saved)
        status, deleted = self.save_changes(self.change(['cfgByPeriod', MONTH], {'tmall': {'feeRate': 0.04}}, newExists=False), version=saved['version'])
        self.assertEqual(status, 200, deleted)
        self.assertEqual(deleted['document']['cfgByPeriod'], {})

    def test_repeated_stale_delete_is_idempotent(self):
        change = self.change(['cfg', 'tmall', 'feeRate'], 0.03, newExists=False)
        status, first = self.save_changes(change)
        self.assertEqual(status, 200, first)
        status, second = self.save_changes(change)
        self.assertEqual(status, 200, second)
        self.assertEqual(second['document'], first['document'])

    def test_missing_leaf_delete_does_not_create_empty_ancestors(self):
        status, saved = self.save_changes(self.change(['cfg', 'missing', 'field'], oldExists=False, newExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document'], self.original)

    def test_stale_subtree_deletion_preserves_a_new_field_from_another_editor(self):
        status, first = self.save_changes(self.change(['cfg', 'tmall', 'newRate'], value=0.2, oldExists=False))
        self.assertEqual(status, 200, first)
        status, rejected = self.save_changes(self.change(['cfg', 'tmall'], {'feeRate': 0.03}, newExists=False))
        self.assertEqual(status, 409, rejected)
        self.assertEqual(rejected['error'], 'field_conflict')
        self.assert_unchanged(first['document'], first['version'])

    def test_stale_new_field_cannot_recreate_a_deleted_row(self):
        row = self.original['periods'][MONTH]['tmall'][DAY]
        status, first = self.save_changes(self.change(['periods', MONTH, 'tmall', DAY], row, newExists=False))
        self.assertEqual(status, 200, first)
        status, rejected = self.save_changes(self.change(['periods', MONTH, 'tmall', DAY, 'promotion'], value=15, oldExists=False))
        self.assertEqual(status, 409, rejected)
        self.assertEqual(rejected['error'], 'field_conflict')
        self.assert_unchanged(first['document'], first['version'])

    def test_stale_new_channel_cannot_recreate_a_deleted_month(self):
        status, first = self.save_changes(self.change(['periods', MONTH], self.original['periods'][MONTH], newExists=False))
        self.assertEqual(status, 200, first)
        status, rejected = self.save_changes(self.change(['periods', MONTH, 'new_channel', DAY, 'retailIncome'], value=50, oldExists=False))
        self.assertEqual(status, 409, rejected)
        self.assertEqual(rejected['error'], 'field_conflict')
        self.assert_unchanged(first['document'], first['version'])

    def test_additions_under_originally_missing_month_and_channel_can_merge(self):
        status, first = self.save_changes(self.change(['periods', '2099-02', 'new_channel', '2099-02-01', 'retailIncome'], value=100, oldExists=False))
        self.assertEqual(status, 200, first)
        status, second = self.save_changes(
            self.change(['periods', '2099-02', 'new_channel', '2099-02-01', 'retailCost'], value=40, oldExists=False),
            self.change(['periods', '2099-02', 'other_channel', '2099-02-01', 'retailIncome'], value=20, oldExists=False))
        self.assertEqual(status, 200, second)
        self.assertEqual(second['document']['periods']['2099-02'], {
            'new_channel': {'2099-02-01': {'retailIncome': 100, 'retailCost': 40}},
            'other_channel': {'2099-02-01': {'retailIncome': 20}},
        })

    def test_stale_version_zero_uses_an_empty_original_workspace(self):
        status, saved = self.save_changes(self.change(['periods', MONTH, 'new_channel', DAY, 'retailIncome'], value=50, oldExists=False), version=0)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'][MONTH]['new_channel'][DAY]['retailIncome'], 50)
        self.assertEqual(saved['document']['periods'][MONTH]['tmall'], self.original['periods'][MONTH]['tmall'])

    def test_missing_historical_base_requires_client_rebase(self):
        status, first = self.save_changes(self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.04))
        self.assertEqual(status, 200, first)
        with self.api.connect() as connection:
            connection.execute('DELETE FROM t4_workspace_revisions WHERE version=1')
        status, rejected = self.save_changes(self.change(['cfg', 'jd', 'feeRate'], 0.05, 0.06))
        self.assertEqual(status, 409, rejected)
        self.assertEqual(rejected['error'], 'version_conflict')
        self.assertEqual(rejected['version'], first['version'])
        self.assert_unchanged(first['document'], first['version'])

    def test_stale_leaf_delete_below_deleted_row_remains_idempotent(self):
        row = self.original['periods'][MONTH]['tmall'][DAY]
        status, first = self.save_changes(self.change(['periods', MONTH, 'tmall', DAY], row, newExists=False))
        self.assertEqual(status, 200, first)
        status, saved = self.save_changes(self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, newExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document'], first['document'])

    def test_nested_patch_cannot_overwrite_a_scalar_ancestor(self):
        doc = copy.deepcopy(self.original)
        doc['cfg']['tmall']['importOptions'] = 'new remote value'
        status, seeded = self.request('PUT', {'baseVersion': 1, 'document': doc})
        self.assertEqual(status, 200, seeded)
        status, rejected = self.save_changes(self.change(['cfg', 'tmall', 'importOptions', 'field'], value=3, oldExists=False))
        self.assertEqual(status, 409, rejected)
        self.assertEqual(rejected['error'], 'field_conflict')
        self.assert_unchanged(doc, seeded['version'])

    def test_invalid_and_dangerous_paths_leave_document_unchanged(self):
        paths = [None, 'cfg.tmall.feeRate', [], ['cfg'], ['periods'], ['cfgByPeriod'],
                 ['metadata', 'importedBy'], ['periods', 'bad-month', 'tmall'],
                 ['cfg', '', 'feeRate'], ['cfg', 1, 'feeRate'], ['cfg', 'x' * 121, 'field'],
                 ['cfg', '..', 'field'], ['cfg', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
                 ['periodLocks', MONTH, 'unexpected']]
        paths += [['cfg', key, 'feeRate'] for key in ('__proto__', 'constructor', 'prototype')]
        for path in paths:
            with self.subTest(path=path):
                status, rejected = self.save_changes(self.change(path, value=1, oldExists=False))
                self.assertEqual(status, 400, rejected)
                self.assert_unchanged()

    def test_existence_flags_must_be_booleans(self):
        for flag in ('oldExists', 'newExists'):
            with self.subTest(flag=flag):
                status, rejected = self.save_changes(self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.04, **{flag: 'false'}))
                self.assertEqual(status, 400, rejected)
                self.assert_unchanged()

    def test_locked_month_is_still_protected_for_deep_patches_and_month_deletion(self):
        status, locked = self.save_changes(self.change(['periodLocks', MONTH], value=True, oldExists=False))
        self.assertEqual(status, 200, locked)
        for change in (
            self.change(['periods', MONTH, 'tmall', DAY, '_fileParts', 'sales', 'retailCost'], 40, 45),
            self.change(['periods', MONTH], self.original['periods'][MONTH], newExists=False),
        ):
            with self.subTest(path=change['path']):
                status, rejected = self.save_changes(change, version=locked['version'])
                self.assertEqual(status, 409, rejected)
                self.assertEqual(rejected['error'], 'period_locked')
                self.assert_unchanged(locked['document'], locked['version'])

    def test_large_import_can_save_more_than_ten_thousand_fields_atomically(self):
        changes = [self.change(['periods', MONTH, f'channel{i}', DAY, 'retailIncome'], value=i, oldExists=False)
                   for i in range(10001)]
        status, saved = self.save_changes(*changes)
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'][MONTH]['channel10000'][DAY]['retailIncome'], 10000)
        self.assertEqual(len(saved['document']['periods'][MONTH]), 10002)


if __name__ == '__main__':
    unittest.main()
