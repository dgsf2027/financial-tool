import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('suite_commission', ROOT / 'suite' / 'build_suite.py')
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)


class CommissionSuiteTest(unittest.TestCase):
    def test_recalculation_deducts_commission_independently_from_cps(self):
        values = suite.derive({'retailIncome': 1000, 'returnAmount': -200, 'retailCost': 400,
                               'commission': 80, 'cps': 25})
        self.assertEqual(values['operating'], 105)
        self.assertEqual(values['netProfit'], 295)
        self.assertEqual(suite.derive({'commission': -5})['netProfit'], 5)

    def test_old_payload_without_commission_retains_its_original_operating_columns(self):
        payload = {'inputKeys': ['retailIncome', 'platformFee', 'cps'],
                   'metrics': [{'k': key} for key in ['retailIncome', 'platformFee', 'cps']]}
        self.assertEqual(suite.operating_keys(payload), ['platformFee', 'cps'])


if __name__ == '__main__':
    unittest.main()
