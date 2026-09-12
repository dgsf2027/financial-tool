# Scrapling 店铺后台抓取示例（与 Node 版 login.js/fetch.js 并存，二选一使用）
#
#   python scrapling_demo.py login          首次扫码登录（窗口保持 3 分钟，扫完等它自己关）
#   python scrapling_demo.py fetch [URL]    用保存的登录态抓页面，落一份 HTML 快照到 downloads/
#
# 登录态保存在 _profiles/scrapling_tmall（仅本机，不入 git）。
# 本机 Chromium 有 SxS 兼容问题，统一用系统 Edge（executable_path 指定）。
import os
import sys
import datetime

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "scrapling_tmall")
OUT = os.path.join(BASE, "downloads")
LOGIN_URL = "https://one.alimama.com/"   # 万相台无界（阿里妈妈）

from scrapling.fetchers import StealthyFetcher


def login():
    print("打开万相台登录页，请扫码。窗口约 3 分钟后自动关闭，登录态会保存。")
    StealthyFetcher.fetch(
        LOGIN_URL,
        headless=False,
        executable_path=EDGE,
        user_data_dir=PROFILE,
        page_action=lambda page: page.wait_for_timeout(180_000),
    )
    print("登录态已保存到", PROFILE)


def fetch(url: str):
    os.makedirs(OUT, exist_ok=True)
    r = StealthyFetcher.fetch(
        url,
        headless=False,           # 店铺后台建议有头模式，风控更友好
        executable_path=EDGE,
        user_data_dir=PROFILE,
        network_idle=True,
    )
    print("状态:", r.status, "| 标题:", r.css("title::text"))
    snap = os.path.join(OUT, f"快照_{datetime.date.today()}.html")
    with open(snap, "w", encoding="utf-8") as f:
        f.write(r.html_content)
    print("页面快照已存:", snap, "（把它交给 Claude 分析结构、写取数选择器）")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "login"
    if cmd == "login":
        login()
    else:
        fetch(sys.argv[2] if len(sys.argv) > 2 else LOGIN_URL)
