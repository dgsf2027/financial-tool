# 京东商智登录窗口（普通浏览器，无自动化痕迹，避开登录风控）
#   python jd_login.py
# 打开京东商智，请用账号密码登录「澳乐自营旗舰店」。登录后关闭窗口，登录态保存。
import os
import subprocess

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(BASE, "_profiles", "jd_jdzy")
LOGIN_URL = "https://jdsz.jd.com/"

os.makedirs(PROFILE, exist_ok=True)
print("打开京东商智登录页，请用账号密码登录，登录成功后关闭浏览器窗口。")
subprocess.run([EDGE, f"--user-data-dir={PROFILE}", "--no-first-run",
                "--no-default-browser-check", LOGIN_URL])
