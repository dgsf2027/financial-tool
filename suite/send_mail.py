# -*- coding: utf-8 -*-
"""套表邮件发送（server.js 调用）
    python send_mail.py <mail.config.json> <job.json>
job.json: {"subject": "...", "sends": [{"to","name","attachment","filename","body","scopeName"}, ...]}
逐人发送，每人一封、附各自范围的 xlsx；最后一行输出 JSON 结果数组。
"""
import json
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr

XLSX = ("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")


def connect(cfg):
    host, port = cfg["host"], int(cfg.get("port") or 465)
    secure = (cfg.get("secure") or "ssl").lower()
    if secure == "ssl":
        s = smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=40)
    else:
        s = smtplib.SMTP(host, port, timeout=40)
        s.ehlo()
        if secure == "starttls":
            s.starttls(context=ssl.create_default_context())
            s.ehlo()
    s.login(cfg["user"], cfg["pass"])
    return s


def main(cfg_path, job_path):
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    job = json.load(open(job_path, encoding="utf-8"))
    results = []
    try:
        server = connect(cfg)
    except Exception as e:
        for s in job.get("sends", []):
            results.append({"to": s.get("to"), "name": s.get("name"), "scopeName": s.get("scopeName"),
                            "ok": False, "error": "连接/登录发件邮箱失败：" + str(e)[:300]})
        print(json.dumps(results, ensure_ascii=False))
        return
    from_addr = cfg.get("from") or cfg["user"]
    for s in job.get("sends", []):
        try:
            msg = EmailMessage()
            msg["Subject"] = job.get("subject") or "T4 日损益套表"
            msg["From"] = formataddr((cfg.get("fromName") or "", from_addr))
            msg["To"] = formataddr((s.get("name") or "", s["to"]))
            msg.set_content(s.get("body") or "")
            with open(s["attachment"], "rb") as f:
                msg.add_attachment(f.read(), maintype=XLSX[0], subtype=XLSX[1], filename=s.get("filename") or "套表.xlsx")
            server.send_message(msg)
            results.append({"to": s["to"], "name": s.get("name"), "scopeName": s.get("scopeName"), "ok": True})
        except Exception as e:
            results.append({"to": s.get("to"), "name": s.get("name"), "scopeName": s.get("scopeName"),
                            "ok": False, "error": str(e)[:300]})
    try:
        server.quit()
    except Exception:
        pass
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python send_mail.py <mail.config.json> <job.json>"); sys.exit(1)
    main(sys.argv[1], sys.argv[2])
