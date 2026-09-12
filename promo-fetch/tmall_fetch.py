# 天猫直通车推广消耗 · 一步抓取
#   python tmall_fetch.py            抓最近明细，输出 downloads/天猫直通车_<今天>.csv
#
# 用已保存的登录态（_profiles/scrapling_tmall）打开万相台资金明细页，
# 等表格加载后解析每日「现金消耗扣款」，直接输出 T4「天猫直通车」可导入的 CSV。
# CSV 同时含记账时间与交易日期两列；T4 导入按记账时间（实际扣款日）归集消耗。
# 无人值守：登录态有效就全自动；失效会在日志里报「需重新登录」并退出码 3。
import csv
import datetime
import os
import re
import sys
import time

from patchright.sync_api import sync_playwright

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "scrapling_tmall")
OUT = os.path.join(BASE, "downloads")
REPORT_URL = "https://one.alimama.com/index.html#!/account/detail?detailTab=cash"

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG = re.compile(r"<[^>]+>")


def log(*a):
    print(f"[{datetime.datetime.now():%H:%M:%S}]", *a, flush=True)


def parse(html):
    out = []
    for row_html in ROW.findall(html):
        cells = [TAG.sub("", c).replace("&nbsp;", " ").strip() for c in CELL.findall(row_html)]
        if len(cells) < 7:
            continue
        book_time, trade_date, direction, ttype, amount, _bal, note = cells[:7]
        if not re.match(r"\d{4}-\d{2}-\d{2}$", trade_date):
            continue
        if "支出" not in direction:
            continue
        amt = re.sub(r"[^\d.]", "", amount)
        if not amt:
            continue
        out.append([trade_date, book_time, direction, ttype, amt, note])
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        def launch():
            return p.chromium.launch_persistent_context(
                PROFILE, executable_path=EDGE, headless=False, viewport=None,
                args=["--no-first-run", "--no-default-browser-check",
                      "--disable-blink-features=AutomationControlled",
                      "--disable-features=msEdgeStartupBoost,StartupBoost"])
        ctx = launch()
        try:
            page = ctx.new_page()
        except Exception:
            try: ctx.close()
            except Exception: pass
            time.sleep(2); ctx = launch(); page = ctx.new_page()

        page.goto(REPORT_URL)
        log("已打开资金明细页，等待表格加载……")
        deadline = time.time() + 180
        ok = False
        while time.time() < deadline:
            try:
                if page.locator("text=扣款").count():
                    ok = True; break
                if page.locator("text=扫码登录").count() or page.locator("text=密码登录").count():
                    log("检测到登录页——登录态已失效，请重新登录后再跑。")
                    ctx.close(); sys.exit(3)
            except Exception:
                pass
            time.sleep(2)
        time.sleep(3)
        html = page.content()
        ctx.close()

    if not ok:
        log("超时：未看到明细表。"); sys.exit(2)

    rows = parse(html)
    if not rows:
        log("未解析到支出明细。"); sys.exit(2)
    today = datetime.date.today().isoformat()
    out_csv = os.path.join(OUT, f"天猫直通车_{today}.csv")
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["交易日期", "记账时间", "收支类型", "交易类型", "操作金额(元)", "备注"])
        w.writerows(rows)
    total = sum(float(r[4]) for r in rows)
    log(f"完成：{len(rows)} 天，合计 ¥{total:.2f} → {out_csv}")
    log("导入：财务中心 T4 → 天猫-澳乐旗舰店 → 导入 → 直通车 → 选此文件")


if __name__ == "__main__":
    main()
