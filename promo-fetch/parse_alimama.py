# 从万相台「现金收支明细」页 HTML 解析每日推广消耗，输出 T4 直通车可导入的 CSV。
#
#   python parse_alimama.py <快照.html> [输出.csv]
#
# 表格列序（mx-stickytable）：记账时间 交易日期 收支类型 交易类型 操作金额 操作后余额 备注
# 只取「支出」行；每行一天。CSV 列名对齐 T4「天猫直通车」导入口（date=交易日期）。
import csv
import re
import sys
import os

# 一整行 <tr>...</tr>
ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
# 行内每个 <td>...</td> 的可见文本
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG = re.compile(r"<[^>]+>")


def cell_text(html):
    return TAG.sub("", html).replace("&nbsp;", " ").strip()


def parse(html):
    out = []
    for row_html in ROW.findall(html):
        cells = [cell_text(c) for c in CELL.findall(row_html)]
        if len(cells) < 7:
            continue
        book_time, trade_date, direction, ttype, amount, balance, note = cells[:7]
        # 只要交易日期像 YYYY-MM-DD、且是支出
        if not re.match(r"\d{4}-\d{2}-\d{2}$", trade_date):
            continue
        amt = re.sub(r"[^\d.]", "", amount)      # 去掉 ¥ 符号
        if not amt:
            continue
        out.append({
            "交易日期": trade_date,
            "记账时间": book_time,
            "收支类型": direction,
            "交易类型": ttype,
            "操作金额(元)": amt,
            "备注": note,
        })
    return out


def main():
    if len(sys.argv) < 2:
        print("用法: python parse_alimama.py <快照.html> [输出.csv]")
        sys.exit(1)
    html = open(sys.argv[1], encoding="utf-8").read()
    rows = parse(html)
    spend = [r for r in rows if "支出" in r["收支类型"]]
    out_csv = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(sys.argv[1]), "天猫直通车_解析.csv")
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["交易日期", "记账时间", "收支类型", "交易类型", "操作金额(元)", "备注"])
        w.writeheader()
        w.writerows(spend)
    total = sum(float(r["操作金额(元)"]) for r in spend)
    print(f"解析明细 {len(rows)} 行，支出 {len(spend)} 天，合计 ¥{total:.2f}")
    for r in spend[:5]:
        print(f"  {r['交易日期']}  ¥{r['操作金额(元)']}  {r['备注']}")
    print("已输出:", out_csv)


if __name__ == "__main__":
    main()
