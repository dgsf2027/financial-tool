import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest

from openpyxl import load_workbook

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('suite_returns', ROOT / 'suite' / 'build_suite.py')
suite = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(suite)


class ReturnsSuiteTest(unittest.TestCase):
    def payload(self):
        inputs = (['retailIncome', 'returnAmount', 'refundAmount', 'retailCost', 'returnCost',
                   'rebateIncome', 'salesReceipt'] + suite.OPERATING + ['expense_live']
                  + suite.DIRECT + suite.INDIRECT)
        calculated = ['salesIncome', 'salesCost', 'grossProfit', 'grossMargin', 'operating',
                      'direct', 'contribution', 'contributionRate', 'indirect', 'netProfit', 'netMargin']
        metrics = [{'k': key, 'n': key, 'lvl': 1 if key in inputs else 0,
                    'pct': key in suite.PCT_KEYS} for key in inputs + calculated]
        days = [
            {'has': True, 'retailIncome': 1000, 'refundAmount': -100, 'retailCost': 400,
             'platformFee': 45, 'expense_live': 25, 'directLabor': 10, 'sharedLabor': 5,
             'rebateIncome': 30, 'salesReceipt': 800},
            {'has': True, 'rebateIncome': 20, 'salesReceipt': 200, 'expense_live': 10},
            {'has': True, 'rebateIncome': 0, 'salesReceipt': 0, 'expense_live': 0},
        ]
        return {'period': '2026-09', 'days': 3,
                'dates': ['2026-09-12', '2026-09-13', '2026-09-14'],
                'rangeLabel': '2026-09-12 ～ 2026-09-14', 'scopeName': '橘农项目', 'generated': '测试',
                'metrics': metrics, 'inputKeys': inputs,
                'operatingKeys': suite.OPERATING + ['expense_live'],
                'channels': [{'id': 'shop', 'name': '返款测试店', 'buName': '橘农事业部',
                              'project': '橘农项目', 'filled': 1}],
                'tree': [{'name': '橘农项目', 'children': [
                    {'name': '橘农事业部', 'children': [
                        {'name': '返款测试店', 'id': 'shop', 'children': []}]}]}],
                'dailyByCh': {'shop': days},
                # Independently calculated: 900 - 400 - 80 - 10 - 5 + 50 = 455.
                'monthByCh': {'shop': {'salesIncome': 900, 'grossProfit': 500,
                                      'operating': 80, 'netProfit': 455}}}

    def test_xlsx_return_formulas_at_channel_business_and_project_levels(self):
        payload = self.payload()
        with tempfile.TemporaryDirectory() as directory:
            source, output = pathlib.Path(directory) / 'input.json', pathlib.Path(directory) / 'returns.xlsx'
            source.write_text(json.dumps(payload), encoding='utf-8')
            report = io.StringIO()
            with contextlib.redirect_stdout(report):
                suite.main(str(source), str(output))
            self.assertEqual(json.loads(report.getvalue())['verify_mismatch'], [])
            self.assertTrue(json.loads(report.getvalue())['ok'])
            wb = load_workbook(output, data_only=False)
            self.addCleanup(wb.close)
            rows = {metric['k']: 6 + index for index, metric in enumerate(payload['metrics'])}

            for sheet_name, columns in [('总表', ['B', 'C']), ('橘农事业部', ['B']),
                                         ('返款测试店', ['B', 'C', 'D', 'E'])]:
                for col in columns:
                    with self.subTest(sheet=sheet_name, col=col):
                        cell = lambda key: f'{col}{rows[key]}'
                        ws = wb[sheet_name]
                        # Rebate is added exactly once; sales receipts cannot enter profit.
                        self.assertEqual(ws[cell('netProfit')].value,
                                         f'={cell("contribution")}-{cell("indirect")}+{cell("rebateIncome")}')
                        self.assertEqual(ws[cell('salesIncome')].value,
                                         f'={cell("retailIncome")}+{cell("returnAmount")}+{cell("refundAmount")}')
                        self.assertIn(cell('expense_live'), ws[cell('operating')].value)
                        for key in ['salesIncome', 'grossProfit', 'operating', 'contribution', 'netProfit']:
                            self.assertNotIn(cell('salesReceipt'), ws[cell(key)].value)

            channel = wb['返款测试店']
            for key, expected in [('refundAmount', [-100, None, None]),
                                  ('rebateIncome', [30, 20, 0]),
                                  ('salesReceipt', [800, 200, 0]),
                                  ('expense_live', [25, 10, 0])]:
                self.assertEqual([channel.cell(rows[key], col).value for col in (3, 4, 5)], expected)
                self.assertEqual(channel.cell(rows[key], 2).value,
                                 f'=SUM(C{rows[key]}:E{rows[key]})')
            self.assertEqual(wb['橘农事业部'].cell(rows['salesReceipt'], 3).value,
                             f"='返款测试店'!B{rows['salesReceipt']}")
            self.assertEqual(wb['总表'].cell(rows['rebateIncome'], 3).value,
                             f"='返款测试店'!B{rows['rebateIncome']}")
            self.assertTrue(wb.calculation.fullCalcOnLoad)

    def test_python_verification_keeps_cash_out_of_profit_with_custom_expenses(self):
        payload = self.payload()
        operating = payload['operatingKeys']
        for day, expected in zip(payload['dailyByCh']['shop'], [445, 10, 0]):
            with self.subTest(day=day):
                result = suite.derive(day, operating)
                self.assertEqual(result['netProfit'], expected)
                self.assertEqual(suite.derive({**day, 'salesReceipt': 999999}, operating)['netProfit'], expected)
        zero_rebate = suite.derive({'rebateIncome': 0, 'salesReceipt': 800, 'expense_live': 12}, operating)
        self.assertEqual(zero_rebate['salesIncome'], 0)
        self.assertEqual(zero_rebate['netProfit'], -12)


if __name__ == '__main__':
    unittest.main()
