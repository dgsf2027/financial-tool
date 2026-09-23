"""Import audit metadata and business data share a single atomic CAS write."""
import copy
import unittest
import test_sync_patch as fixture
MONTH, DAY = fixture.MONTH, fixture.DAY


class ImportHistoryTest(unittest.TestCase):
    setUp = fixture.SyncPatchTest.setUp
    stop_server = fixture.SyncPatchTest.stop_server
    request = fixture.SyncPatchTest.request
    change = fixture.SyncPatchTest.change
    save_changes = fixture.SyncPatchTest.save_changes
    assert_unchanged = fixture.SyncPatchTest.assert_unchanged

    def record(self, key='import_one'):
        return {'id': key, 'period': MONTH, 'fileName': 'sales.xlsx', 'at': '2099-01-01T00:00:00Z',
                'actor': 'untrusted-browser', 'scope': '收入与成本', 'mode': 'file',
                'from': DAY, 'to': DAY, 'dates': [DAY], 'channels': ['tmall'], 'used': 1, 'skipped': 0, 'issues': []}

    def test_successful_data_and_record_persist_atomically_and_stamp_real_actor(self):
        status, saved = self.save_changes(
            self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, 200),
            self.change(['importHistory', 'import_one'], value=self.record(), oldExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'][MONTH]['tmall'][DAY]['retailIncome'], 200)
        self.assertEqual(saved['document']['importHistory']['import_one']['actor'], 'patch-test')
        self.assertNotEqual(saved['document']['importHistory']['import_one']['at'], self.record()['at'])
        status, conflict = self.save_changes(
            self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, 300),
            self.change(['importHistory', 'import_two'], value=self.record('import_two'), oldExists=False))
        self.assertEqual(status, 409, conflict)
        self.assert_unchanged(saved['document'], saved['version'])

    def test_two_stale_clients_append_distinct_records_without_conflict(self):
        status, first = self.save_changes(self.change(['importHistory', 'import_one'], value=self.record(), oldExists=False))
        self.assertEqual(status, 200, first)
        status, second = self.save_changes(self.change(['importHistory', 'import_two'], value=self.record('import_two'), oldExists=False))
        self.assertEqual(status, 200, second)
        self.assertEqual(len(second['document']['importHistory']), 2)
        status, rejected = self.save_changes(self.change(['importHistory', 'import_one'], first['document']['importHistory']['import_one'], newExists=False), version=second['version'])
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged(second['document'], second['version'])

    def test_invalid_history_rejects_business_write_and_old_full_client_preserves_new_metadata(self):
        record = self.record(); record['from'] = '2099-01-32'
        status, failed = self.save_changes(
            self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, 200),
            self.change(['importHistory', 'import_one'], value=record, oldExists=False))
        self.assertEqual(status, 400, failed); self.assert_unchanged()
        items = [{'k': 'expense_test', 'n': '返款费用'}]
        status, saved = self.save_changes(
            self.change(['expenseItems'], value=items, oldExists=False),
            self.change(['importHistory', 'import_one'], value=self.record(), oldExists=False))
        self.assertEqual(status, 200, saved)
        legacy = copy.deepcopy(self.original)
        status, resaved = self.request('PUT', {'baseVersion': saved['version'], 'document': legacy})
        self.assertEqual(status, 200, resaved)
        self.assertEqual(resaved['document']['expenseItems'], items)
        self.assertEqual(resaved['document']['importHistory'], saved['document']['importHistory'])

    def test_old_data_only_cas_preserves_new_metadata_and_rejects_stale_full_save(self):
        items = [{'k': 'expense_test', 'n': '返款费用'}]
        status, saved = self.save_changes(
            self.change(['expenseItems'], value=items, oldExists=False),
            self.change(['importHistory', 'import_one'], value=self.record(), oldExists=False))
        self.assertEqual(status, 200, saved)
        # The old client only knows version 1 and sends a business-field patch.
        status, merged = self.save_changes(
            self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, 200))
        self.assertEqual(status, 200, merged)
        self.assertEqual(merged['document']['expenseItems'], items)
        self.assertEqual(merged['document']['importHistory'], saved['document']['importHistory'])
        legacy = copy.deepcopy(self.original)
        status, rejected = self.request('PUT', {'baseVersion': 1, 'document': legacy})
        self.assertEqual(status, 409, rejected)
        self.assert_unchanged(merged['document'], merged['version'])

    def test_history_edits_and_deletions_reject_companion_business_change_atomically(self):
        status, saved = self.save_changes(self.change(['importHistory', 'import_one'], value=self.record(), oldExists=False))
        self.assertEqual(status, 200, saved)
        record = saved['document']['importHistory']['import_one']
        mutations = [
            self.change(['importHistory', 'import_one', 'fileName'], record['fileName'], 'edited.xlsx'),
            self.change(['importHistory', 'import_one', 'actor'], record['actor'], 'other-person'),
            self.change(['importHistory', 'import_one', 'issues'], record['issues'], ['edited reason']),
            self.change(['importHistory', 'import_one'], record, newExists=False),
        ]
        for mutation in mutations:
            with self.subTest(path=mutation['path']):
                status, rejected = self.save_changes(
                    self.change(['periods', MONTH, 'tmall', DAY, 'retailIncome'], 100, 200),
                    mutation, version=saved['version'])
                self.assertEqual(status, 400, rejected)
                self.assert_unchanged(saved['document'], saved['version'])
        # An explicit empty dictionary is deletion, not a legacy omission.
        emptied = copy.deepcopy(saved['document'])
        emptied['importHistory'] = {}
        emptied['periods'][MONTH]['tmall'][DAY]['retailIncome'] = 200
        status, rejected = self.request('PUT', {'baseVersion': saved['version'], 'document': emptied})
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged(saved['document'], saved['version'])

    def test_expense_catalog_schema_atomic_paths_and_open_daily_field_keys(self):
        bad_items = [
            {}, [{'k': 'other', 'n': '费用'}], [{'k': 'expense_A', 'n': '费用'}],
            [{'k': 'expense_a', 'n': '费<>用'}], [{'k': 'expense_a', 'n': ' '}],
            [{'k': 'expense_a', 'n': '费用'}, {'k': 'expense_b', 'n': ' 费用 '}],
            [{'k': 'expense_a', 'n': '费用'}, {'k': 'expense_a', 'n': '其他'}],
            [{'k': 'expense_a', 'n': 'x'*41}], [{'k': 'expense_a', 'n': '费\n用'}],
            [{'k': 'expense_'+str(i), 'n': '费用'+str(i)} for i in range(101)],
        ]
        for items in bad_items:
            status, failed = self.save_changes(self.change(['expenseItems'], value=items, oldExists=False))
            self.assertEqual(status, 400, failed); self.assert_unchanged()
        status, failed = self.save_changes(self.change(['expenseItems', '0'], value={'k': 'expense_a', 'n': '费用'}, oldExists=False))
        self.assertEqual(status, 400, failed)
        status, saved = self.save_changes(
            self.change(['expenseItems'], value=[{'k':'expense_shipping','n':'额外配送'}], oldExists=False),
            self.change(['periods',MONTH,'tmall',DAY,'_fileParts','daily','expense_shipping'], value=3.5, oldExists=False),
            self.change(['periods',MONTH,'tmall',DAY,'futureRebateAmount'], value=0, oldExists=False))
        self.assertEqual(status, 200, saved)

if __name__ == '__main__': unittest.main()
