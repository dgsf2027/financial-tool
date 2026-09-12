# 万相台·资金明细 一次性采集：登录（如需）+ 页面快照 + 接口抓包
#
#   python tmall_capture.py
#
# 打开「账户明细-现金收支明细」页：未登录会先出现扫码页，扫码即可，脚本会一直等到
# 明细表出现（最多 5 分钟）；然后把页面 HTML 和期间的 JSON 接口响应存到 downloads/，
# 交给 Claude 分析出正式抓取方案。登录态保存在 _profiles/，下次免扫码。
import json
import os
import time

from playwright.sync_api import sync_playwright

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "scrapling_tmall")
OUT = os.path.join(BASE, "downloads")
REPORT_URL = "https://one.alimama.com/index.html#!/account/detail?detailTab=cash"

KEYWORDS = ("account", "cash", "record", "detail", "trade", "finance", "flow", "bill")

captured = []

def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE, executable_path=EDGE, headless=False, viewport=None)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_response(resp):
            try:
                url = resp.url
                if "alimama" not in url and "taobao" not in url:
                    return
                if not any(k in url.lower() for k in KEYWORDS):
                    return
                if "json" not in (resp.headers.get("content-type") or ""):
                    return
                body = resp.text()
                if body:
                    captured.append({"url": url, "body": body[:200000]})
            except Exception:
                pass

        page.on("response", on_response)
        page.goto(REPORT_URL)
        print("如出现登录页请扫码；脚本等待明细表加载，最多 5 分钟……")

        deadline = time.time() + 300
        ok = False
        while time.time() < deadline:
            try:
                if page.locator("text=现金收支明细").count() and page.locator("text=扣款").count():
                    ok = True
                    break
            except Exception:
                pass
            time.sleep(2)
        time.sleep(6)  # 等最后一批接口返回

        html_file = os.path.join(OUT, "万相台_资金明细_快照.html")
        with open(html_file, "w", encoding="utf-8") as f:
            f.write(page.content())
        json_file = os.path.join(OUT, "万相台_接口抓包.json")
        with open(json_file, "w", encoding="utf-8") as f:
            json.dump(captured, f, ensure_ascii=False, indent=1)

        print("明细表加载:", "成功" if ok else "超时（已保存当前状态，可能仍在登录页）")
        print("已保存:", html_file)
        print("已保存:", json_file, f"（接口 {len(captured)} 条）")
        ctx.close()

if __name__ == "__main__":
    main()
