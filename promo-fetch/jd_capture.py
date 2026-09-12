# 京东商智·交易概况 一次性采集：用登录态打开交易概况页，选「近30天 + 按天」，
# 抓包每日成交金额接口 + 页面快照，供分析正式抓取方案。
#   python jd_capture.py
import json
import os
import time

from patchright.sync_api import sync_playwright

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "jd_jdzy")
OUT = os.path.join(BASE, "downloads")
REPORT_URL = "https://jdsz.jd.com/szweb/view/tradeAnalysis/tradeSummary.html"
KEYWORDS = ("trade", "summary", "analysis", "core", "index", "gmv", "deal", "chart", "trend", "data", "detail")

captured = []


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
                url = resp.url
                if "jd.com" not in url:
                    return
                ct = resp.headers.get("content-type") or ""
                if "json" not in ct:
                    return
                if not any(k in url.lower() for k in KEYWORDS):
                    return
                body = resp.text()
                if body and len(body) > 40:
                    captured.append({"url": url, "body": body[:300000]})
            except Exception:
                pass

        page.on("response", on_response)
        page.goto(REPORT_URL)
        print("已打开交易概况页。若出现登录页说明登录态失效，请先跑 jd_login.py。")
        print("请在页面上选择「近30天」+「天」并点查询，让每日数据加载出来；脚本等待最多 6 分钟……")

        deadline = time.time() + 360
        while time.time() < deadline:
            try:
                if page.locator("text=成交金额").count():
                    # 已进入概况页；再等用户切到近30天+天并查询
                    pass
            except Exception:
                pass
            time.sleep(3)
            # 若已抓到较大的时间序列接口，可提前结束
            if any(len(c["body"]) > 2000 for c in captured) and time.time() > deadline - 340 + 40:
                pass
        time.sleep(2)
        html = page.content()
        ctx.close()

    html_file = os.path.join(OUT, "京东商智_交易概况_快照.html")
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html)
    json_file = os.path.join(OUT, "京东商智_接口抓包.json")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(captured, f, ensure_ascii=False, indent=1)
    print("已保存:", html_file)
    print("已保存:", json_file, f"（接口 {len(captured)} 条）")


if __name__ == "__main__":
    main()
