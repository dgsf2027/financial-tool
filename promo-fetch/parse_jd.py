# 从京东商智 getTrend 接口响应解析每日成交金额，输出 T4「京东自营收入交易概况」CSV。
#   python parse_jd.py <接口抓包.json> [输出.csv]
# 找 getTrend 里最长的每日序列（categories=日期, series[0].data=成交金额），
# 输出列名对齐 T4 jdIncome 导入口：日期 / 成交金额。
import csv
import json
import sys
import os


def extract(cap):
    best = None
    for item in cap:
        if "getTrend" not in item["url"]:
            continue
        try:
            body = json.loads(item["body"])
            d = body["body"]["data"][0]["trend"]
            cats = d["categories"]
            vals = d["series"][0]["data"]
            if best is None or len(cats) > len(best[0]):
                best = (cats, vals)
        except Exception:
            continue
    return best


def main():
    if len(sys.argv) < 2:
        print("用法: python parse_jd.py <接口抓包.json> [输出.csv]"); sys.exit(1)
    cap = json.load(open(sys.argv[1], encoding="utf-8"))
    best = extract(cap)
    if not best:
        print("未找到 getTrend 每日序列"); sys.exit(2)
    cats, vals = best
    rows = []
    for dt, v in zip(cats, vals):
        if v is None:
            continue                       # 无数据的日子跳过
        rows.append([dt, f"{float(v):.2f}"])
    out_csv = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(sys.argv[1]), "京东自营收入_解析.csv")
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["日期", "成交金额"])
        w.writerows(rows)
    total = sum(float(r[1]) for r in rows)
    print(f"解析 {len(rows)} 天，合计成交金额 ¥{total:.2f}")
    for r in rows[-5:]:
        print(f"  {r[0]}  ¥{r[1]}")
    print("已输出:", out_csv)


if __name__ == "__main__":
    main()
