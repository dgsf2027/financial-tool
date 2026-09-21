import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / 'suite' / 'send_mail.py'
spec = importlib.util.spec_from_file_location('finance_send_mail', MODULE_PATH)
send_mail = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(send_mail)

class FakeSMTP:
    def __init__(self, response): self.response, self.sent, self.closed = response, [], False
    def send_message(self, message): self.sent.append(message); return self.response
    def quit(self): self.closed = True

class MailReviewTests(unittest.TestCase):
    def run_job(self, response):
        smtp = FakeSMTP(response)
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / 'config.json'; job = Path(td) / 'job.json'
            cfg.write_text(json.dumps({'host':'smtp.invalid','port':465,'user':'from@example.test','pass':'secret'}), encoding='utf-8')
            job.write_text(json.dumps({'subject':'Review','sends':[{'to':'recipient@example.test','name':'收件人','body':'hello'}]}), encoding='utf-8')
            old_connect, old_stdout = send_mail.connect, send_mail.sys.stdout
            out = io.StringIO(); send_mail.connect = lambda _cfg: smtp; send_mail.sys.stdout = out
            try: send_mail.main(str(cfg), str(job))
            finally: send_mail.connect, send_mail.sys.stdout = old_connect, old_stdout
            return smtp, json.loads(out.getvalue())

    def test_nonempty_refusal_is_failure(self):
        smtp, result = self.run_job({'recipient@example.test': (550, b'mailbox refused')})
        self.assertTrue(smtp.closed); self.assertEqual(len(smtp.sent), 1)
        self.assertFalse(result[0]['ok']); self.assertIn('550', result[0]['error'])

    def test_smtp_exception_is_failure(self):
        refusal = send_mail.smtplib.SMTPRecipientsRefused({'recipient@example.test': (550, b'blocked')})
        class ExceptionSMTP(FakeSMTP):
            def send_message(self, message): self.sent.append(message); raise refusal
        smtp = ExceptionSMTP(None)
        with tempfile.TemporaryDirectory() as td:
            cfg = Path(td) / 'c.json'; job = Path(td) / 'j.json'
            cfg.write_text(json.dumps({'host':'smtp.invalid','user':'from@example.test','pass':'secret'}), encoding='utf-8')
            job.write_text(json.dumps({'sends':[{'to':'recipient@example.test'}]}), encoding='utf-8')
            old_connect, old_stdout = send_mail.connect, send_mail.sys.stdout
            out = io.StringIO(); send_mail.connect = lambda _cfg: smtp; send_mail.sys.stdout = out
            try: send_mail.main(str(cfg), str(job))
            finally: send_mail.connect, send_mail.sys.stdout = old_connect, old_stdout
            result = json.loads(out.getvalue())
        self.assertTrue(smtp.closed); self.assertFalse(result[0]['ok']); self.assertIn('blocked', result[0]['error'])

    def test_empty_refusal_is_success(self):
        smtp, result = self.run_job({})
        self.assertTrue(smtp.closed); self.assertTrue(result[0]['ok'])

if __name__ == '__main__': unittest.main()
