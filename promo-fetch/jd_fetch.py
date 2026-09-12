# 京东自营每日成交金额 · 一步抓取
#   python jd_fetch.py       输出 downloads/京东自营收入_<今天>.csv（T4 京东自营收入交易概况可直接导入）
#
# 用登录态打开交易概况页，尽量点「近30天」+「天」+查询，拦截 getTrend 每日序列，
# 取最长的一段（categories=日期，series[0].data=成交金额）输出 CSV。
# 登录态失效退出码 3；未抓到序列退出码 2。
import csv
import datetime
import json
import os
import sys
import time

from patchright.sync_api import sync_playwright

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "jd_jdzy")
OUT = os.path.join(BASE, "downloads")
REPORT_URL = "https://jdsz.jd.com/szweb/view/tradeAnalysis/tradeSummary.html"

trends = []


def log(*a):
    print(f"[{datetime.datetime.now():%H:%M:%S}]", *a, flush=True)


def pick_longest():
    best = None
    for body in trends:
        try:
            d = json.loads(body)["body"]["data"][0]["trend"]
            cats, vals = d["categories"], d["series"][0]["data"]
            if best is None or len(cats) > len(best[0]):
                best = (cats, vals)
        except Exception:
            continue
    return best


def try_click(page, text):
    try:
        loc = page.locator(f"text={text}").first
        if loc.count():
            loc.click(timeout=3000)
            page.wait_for_timeout(800)
            return True
    except Exception:
        pass
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, executable_path=EDGE, headless=False, viewport=None,
            args=["--no-first-run", "--no-default-browser-check",
                  "--disable-blink-features=AutomationControlled",
                  "--disable-features=msEdgeStartupBoost,StartupBoost"])
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_response(resp):
            try:
                if "getTrend" in resp.url and "json" in (resp.headers.get("content-type") or ""):
                    trends.append(resp.text())
            except Exception:
                pass
        page.on("response", on_response)

        page.goto(REPORT_URL)
        log("交易概况页加载中……")
        # 判断登录态
        for _ in range(20):
            if page.locator("text=成交金额").count():
                break
            if page.locator("text=扫码登录").count() or page.locator("text=账户登录").count():
                log("检测到登录页——登录态失效，请先跑 jd_login.py 重新登录。")
                ctx.close(); sys.exit(3)
            page.wait_for_timeout(1500)
        # 尽量切到近30天 + 天，再查询
        try_click(page, "近30天")
        try_click(page, "天")
        try_click(page, "查询")
        page.wait_for_timeout(4000)
        html = page.content()
        ctx.close()

    best = pick_longest()
    if not best:
        log("未抓到 getTrend 每日序列（页面结构或权限变化）。"); sys.exit(2)
    cats, vals = best
    rows = [[dt, f"{float(v):.2f}"] for dt, v in zip(cats, vals) if v is not None]
    today = datetime.date.today().isoformat()
    out_csv = os.path.join(OUT, f"京东自营收入_{today}.csv")
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["日期", "成交金额"])
        w.writerows(rows)
    total = sum(float(r[1]) for r in rows)
    log(f"完成：{len(rows)} 天，合计 ¥{total:.2f} → {out_csv}")
    log("导入：财务中心 T4 → 京东-澳乐京东自营 → 导入 → 京东自营收入交易概况 → 选此文件")


if __name__ == "__main__":
    main()
