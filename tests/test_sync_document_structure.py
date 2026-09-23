"""Reject shared snapshots that cannot be loaded by the browser, atomically."""
import copy
import unittest
import test_sync_patch as fixture


class SyncDocumentStructureTest(unittest.TestCase):
    setUp = fixture.SyncPatchTest.setUp
    stop_server = fixture.SyncPatchTest.stop_server
    request = fixture.SyncPatchTest.request
    change = fixture.SyncPatchTest.change
    save_changes = fixture.SyncPatchTest.save_changes
    assert_unchanged = fixture.SyncPatchTest.assert_unchanged

    def assert_rejected_atomically(self, change):
        status, result = self.save_changes(
            self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.09), change)
        self.assertEqual(status, 400, result)
        self.assert_unchanged()
        with self.api.connect() as connection:
            count = connection.execute('SELECT COUNT(*) FROM t4_workspace_revisions').fetchone()[0]
        self.assertEqual(count, 1, 'rejected structure must not create a saved revision')

    def test_invalid_channel_records_and_nested_lists_are_rejected(self):
        records = [None, 1, [], {}, {'id': None}, {'id': 'new', 'n': {}},
                   {'id': 'new', 'bu': []}, {'id': 'new', 'aliases': 'old'},
                   {'id': 'new', 'aliases': [None]}, {'id': 'new', 'details': {}},
                   {'id': 'new', 'details': [None]},
                   {'id': 'new', 'details': [{'source': {}}]},
                   {'id': 'new', 'details': [{'aliases': {}}]},
                   {'id': 'new', 'details': [{'fields': {}}]},
                   {'id': 'new', 'details': [{'fields': [None]}]},
                   {'id': 'new', 'details': [{'fields': [{'name': None}]}]}]
        for record in records:
            with self.subTest(record=record):
                self.assert_rejected_atomically(self.change(
                    ['channels'], self.original['channels'], [record]))

    def test_period_channel_day_and_file_source_shapes_are_rejected(self):
        cases = [
            ([fixture.MONTH], 1), ([fixture.MONTH], []),
            ([fixture.MONTH, 'tmall'], 'bad'), ([fixture.MONTH, 'tmall'], []),
            ([fixture.MONTH, 'tmall', fixture.DAY], None),
            ([fixture.MONTH, 'tmall', fixture.DAY], 1),
            ([fixture.MONTH, 'tmall', fixture.DAY, '_fileParts'], []),
            ([fixture.MONTH, 'tmall', fixture.DAY, '_fileParts', 'sales'], None),
            ([fixture.MONTH, 'tmall', fixture.DAY, '_fileParts', 'sales'], 1),
            ([fixture.MONTH, 'tmall', fixture.DAY, '_srcs'], []),
            ([fixture.MONTH, 'tmall', fixture.DAY, '_manualFields'], 'bad'),
        ]
        for suffix, value in cases:
            path = ['periods', *suffix]
            old_exists, old = self.api.get_at(self.original, path)
            with self.subTest(path=path, value=value):
                self.assert_rejected_atomically(self.change(path, old, value, oldExists=old_exists))

    def test_scalar_configuration_cannot_silently_replace_channel_parameters(self):
        for path in (['cfg', 'jd'], ['cfgByPeriod', fixture.MONTH, 'tmall']):
            old_exists, old = self.api.get_at(self.original, path)
            for value in (1, 'bad', []):
                with self.subTest(path=path, value=value):
                    self.assert_rejected_atomically(self.change(path, old, value, oldExists=old_exists))

    def test_full_document_save_uses_the_same_structure_guards(self):
        for field, value in [('channels', [None]), ('periods', {fixture.MONTH: 1}),
                             ('cfg', {'tmall': []})]:
            with self.subTest(field=field):
                document = copy.deepcopy(self.original)
                document[field] = value
                status, result = self.request('PUT', {'baseVersion': 1, 'document': document})
                self.assertEqual(status, 400, result)
                self.assert_unchanged()

    def test_legacy_rosters_null_optional_fields_and_metadata_round_trip_unchanged(self):
        document = copy.deepcopy(self.original)
        document['channels'] = [
            'tmall',
            {'id': 'custom', 'n': '自定义渠道', 'bu': 'ecom', 'aliases': None, 'details': None},
            {'id': 'with-details', 'n': '销售渠道', 'aliases': ['旧名称'],
             'details': [{'source': '门店', 'aliases': ['旧门店'],
                          'fields': [{'name': '编号', 'value': 12, 'legacy': True}],
                          'metadata': {'retained': True}}]},
        ]
        document['cfg']['custom'] = None
        document['cfg']['tmall'].update({'removedRate': None, 'legacyRate': '0.01',
                                        'metadata': {'retained': True}})
        raw = document['periods'][fixture.MONTH]['tmall'][fixture.DAY]
        raw.update({'_manualFields': {'retailIncome': True}, '_srcs': None,
                    'futureAmount': None, 'legacyAmount': '3.50'})
        status, saved = self.request('PUT', {'baseVersion': 1, 'document': document})
        self.assertEqual(status, 200, saved)
        self.assert_unchanged(document, saved['version'])


if __name__ == '__main__':
    unittest.main()
