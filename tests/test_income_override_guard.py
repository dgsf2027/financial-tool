"""HTTP/SQLite regressions for a net amount entered as gross income."""
import copy
import json
import unittest

import test_sync_patch as fixture

MONTH, DAY = fixture.MONTH, fixture.DAY
ROW = ['periods', MONTH, 'tmall', DAY]


class IncomeOverrideGuardTest(unittest.TestCase):
    setUp = fixture.SyncPatchTest.setUp
    stop_server = fixture.SyncPatchTest.stop_server
    request = fixture.SyncPatchTest.request
    change = fixture.SyncPatchTest.change
    save_changes = fixture.SyncPatchTest.save_changes
    assert_unchanged = fixture.SyncPatchTest.assert_unchanged

    def row(self, **values):
        return {'_fileParts': {'summaryIncome': {
            'retailIncome': 32129.21, 'returnAmount': -21468.19}}, **values}

    def document(self, raw):
        doc = copy.deepcopy(self.original)
        doc['periods'][MONTH]['tmall'][DAY] = raw
        doc['channels'].append({'id': 'tmall', 'n': '天猫测试店'})
        return doc

    def seed_legacy(self, raw):
        # Simulate an already-persisted incident from before this guard existed.
        # This is only the temporary test database; production data is untouched.
        self.original = self.document(raw)
        encoded = json.dumps(self.original)
        with self.api.connect() as conn:
            conn.execute('UPDATE t4_workspaces SET document_json=?', (encoded,))
            conn.execute('UPDATE t4_workspace_revisions SET document_json=?', (encoded,))

    def test_full_save_rejects_incident_and_preserves_document_and_version(self):
        status, rejected = self.request('PUT', {'baseVersion': 1,
                                              'document': self.document(self.row(retailIncome=10661.02))})
        self.assertEqual(status, 400, rejected)
        for text in (DAY, '天猫测试店', '重复扣退', '清除零售收入覆盖'):
            self.assertIn(text, rejected['error'])
        self.assert_unchanged()

    def test_patch_rejects_risk_and_unrelated_changes_atomically(self):
        status, rejected = self.save_changes(
            self.change(ROW, self.original['periods'][MONTH]['tmall'][DAY], self.row(retailIncome=10661.02)),
            self.change(['cfg', 'tmall', 'feeRate'], 0.03, 0.04))
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged()

    def test_existing_risk_allows_other_fields_dates_channels_and_full_save(self):
        self.seed_legacy(self.row(retailIncome=10661.02))
        status, saved = self.save_changes(
            self.change(ROW + ['promotion'], value=120, oldExists=False),
            self.change(['periods', MONTH, 'tmall', '2099-01-02'], value={'retailIncome': 20}, oldExists=False),
            self.change(['periods', MONTH, 'jd', DAY], value={'retailIncome': 30}, oldExists=False))
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['document']['periods'][MONTH]['tmall'][DAY]['retailIncome'], 10661.02)
        doc = copy.deepcopy(saved['document'])
        doc['cfg']['tmall']['feeRate'] = 0.06
        status, full_saved = self.request('PUT', {'baseVersion': saved['version'], 'document': doc})
        self.assertEqual(status, 200, full_saved)
        self.assertEqual(full_saved['document'], doc)

    def test_existing_risk_can_be_cleared_or_corrected(self):
        for mode in ('clear', 'correct', 'valid_adjustment'):
            with self.subTest(mode=mode):
                self.seed_legacy(self.row(retailIncome=10661.02))
                _, before = self.request()
                mutation = self.change(ROW + ['retailIncome'], 10661.02,
                                       32129.21 if mode == 'correct' else 30000,
                                       newExists=mode != 'clear')
                status, saved = self.save_changes(mutation, version=before['version'])
                self.assertEqual(status, 200, saved)
                raw = saved['document']['periods'][MONTH]['tmall'][DAY]
                self.assertIsNone(self.api.income_override_risk(raw))
                self.assertEqual(raw['_fileParts']['summaryIncome']['returnAmount'], -21468.19)

    def test_changed_old_risk_signature_is_rejected(self):
        self.seed_legacy(self.row(retailIncome=10661.02))
        status, rejected = self.save_changes(
            self.change(ROW + ['_fileParts', 'summaryIncome', 'retailIncome'], 32129.21, 32130.21),
            self.change(ROW + ['retailIncome'], 10661.02, 10662.02))
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged()

    def test_legitimate_negative_adjustment_and_legacy_file_rows_are_allowed(self):
        raws = [
            {'retailIncome': -40, 'returnAmount': -30},
            self.row(retailIncome=-40),
            self.row(retailIncome=30000),
            {'_src': 'file', 'retailIncome': 10661.02, 'returnAmount': -21468.19},
            {'_fileParts': {'summaryIncome': {'retailIncome': 100, 'returnAmount': -150}}},
        ]
        for raw in raws:
            with self.subTest(raw=raw):
                _, before = self.request()
                status, saved = self.request('PUT', {'baseVersion': before['version'], 'document': self.document(raw)})
                self.assertEqual(status, 200, saved)

    def test_exact_net_negative_and_cent_equivalent_values_are_flagged(self):
        for manual in (10661.02, 10661.020000000002, 10661.024):
            self.assertIsNotNone(self.api.income_override_risk(self.row(retailIncome=manual)))
        self.assertIsNone(self.api.income_override_risk(self.row(retailIncome=10661.03)))
        negative_net = {'retailIncome': -50, '_fileParts': {'summaryIncome': {
            'retailIncome': 100, 'returnAmount': -150}}}
        self.assertIsNotNone(self.api.income_override_risk(negative_net))
        zero_net = {'retailIncome': ' ', '_fileParts': {'summaryIncome': {
            'retailIncome': 100, 'returnAmount': -100}}}
        self.assertIsNotNone(self.api.income_override_risk(zero_net))

    def test_priority_sources_and_fallback_sum_match_frontend(self):
        priority = ['summaryIncome', 'summaryCost', 'summaryDaily', 'daily']
        for winner in range(len(priority)):
            parts = {source: {'retailIncome': (100 if index == winner else 999), 'returnAmount': -20}
                     for index, source in enumerate(priority) if index >= winner}
            parts['sales'] = {'retailIncome': 500, 'returnAmount': -700}
            with self.subTest(source=priority[winner]):
                self.assertIsNotNone(self.api.income_override_risk({'retailIncome': 80, '_fileParts': parts}))
        summed = {'retailIncome': 80, '_fileParts': {
            'summaryIncome': {'retailCost': 30},
            'sales': {'retailIncome': 60, 'returnAmount': -10},
            'other': {'retailIncome': 40, 'returnAmount': -10}}}
        self.assertEqual(self.api.file_input_value(summed, 'retailIncome'), 100)
        self.assertIsNotNone(self.api.income_override_risk(summed))

    def test_explicit_deductions_and_rebate_sign_without_rate_inference(self):
        raw = {'retailIncome': 70, 'returnAmount': -10, 'refundAmount': -5, 'rebateAmount': 15,
               '_fileParts': {'summaryIncome': {'retailIncome': 100, 'returnAmount': -90}}}
        self.assertIsNotNone(self.api.income_override_risk(raw))
        raw['rebateAmount'] = -15
        self.assertIsNotNone(self.api.income_override_risk(raw))
        raw['returnAmount'] = 0
        self.assertIsNone(self.api.income_override_risk(raw))
        raw = {'retailIncome': 80, '_fileParts': {'summaryIncome': {'retailIncome': 100}}}
        doc = self.document(raw)
        doc['cfg']['tmall']['returnRate'] = -0.2
        status, saved = self.request('PUT', {'baseVersion': 1, 'document': doc})
        self.assertEqual(status, 200, saved)

    def test_reimport_can_create_risk_and_is_rejected(self):
        self.seed_legacy({'retailIncome': 80, '_fileParts': {'summaryIncome': {
            'retailIncome': 110, 'returnAmount': -20}}})
        status, rejected = self.save_changes(
            self.change(ROW + ['_fileParts', 'summaryIncome', 'retailIncome'], 110, 100))
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged()

    def test_guard_checks_merged_cas_document_and_preserves_prior_save(self):
        self.seed_legacy({'retailIncome': 80, '_fileParts': {'summaryIncome': {
            'retailIncome': 110, 'returnAmount': -10}}})
        status, saved = self.save_changes(
            self.change(ROW + ['_fileParts', 'summaryIncome', 'retailIncome'], 110, 100))
        self.assertEqual(status, 200, saved)
        # Each client's isolated candidate is safe. Their disjoint CAS merge is
        # not: 100 gross - 20 returned now equals the 80 manual override.
        status, rejected = self.save_changes(
            self.change(ROW + ['_fileParts', 'summaryIncome', 'returnAmount'], -10, -20))
        self.assertEqual(status, 400, rejected)
        self.assert_unchanged(saved['document'], saved['version'])
        # The same stale client can still merge an unrelated field normally.
        status, merged = self.save_changes(self.change(ROW + ['promotion'], value=5, oldExists=False))
        self.assertEqual(status, 200, merged)
        status, conflict = self.save_changes(
            self.change(ROW + ['_fileParts', 'summaryIncome', 'retailIncome'], 110, 120))
        self.assertEqual(status, 409, conflict)
        self.assertEqual(conflict['error'], 'field_conflict')


if __name__ == '__main__':
    unittest.main()
