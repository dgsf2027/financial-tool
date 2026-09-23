# -*- coding: utf-8 -*-
"""T4 日损益套表生成器（服务端由 server.js 调用，也可手动跑）
    python build_suite.py input.json output.xlsx

输入：系统导出的 JSON（期间、项目范围、科目定义、渠道、汇总树、每日取数、月合计）
输出：多 Sheet Excel 工作簿——
    Sheet1「总表」    全部→项目→事业部→渠道，数字为公式（事业部=SUM渠道，渠道=引用明细页）
    事业部页（每个事业部一页）事业部合计 + 该事业部各渠道，引用各渠道明细页合计；页序为 事业部页→其渠道页
    Sheet3…「各渠道」  逐日利润表：科目竖排、日期横排、合计在左；小计与比率为公式，每日取数为系统值
总表/对比里的渠道名与数字均带超链接，点击跳到该渠道明细页对应科目行。
"""
import json
import re
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.properties import CalcProperties

FONT = "微软雅黑"
# 极简报表风：字体统一黑色、无填充色；层级靠字重与缩进；表格全部实线边框
C_TEXT = C_SUB = C_LINK = "000000"
FMT_AMT = '#,##0.00;-#,##0.00;"-"'
FMT_PCT = '0.0%;-0.0%;"-"'
KEY_ROWS = {"grossProfit", "contribution", "netProfit"}          # 关键小计：加粗 + 上划线
OPERATING = ["platformFee", "platformOther", "promotion", "ztc", "cps", "research", "aftersales", "logistics", "warehouse", "tax"]
DIRECT = ["directLabor", "directRent", "directOther"]
INDIRECT = ["sharedLabor", "sharedRent", "sharedOther"]
SUMMARY_KEYS = ["salesIncome", "salesCost", "grossProfit", "grossMargin", "operating", "direct",
                "contribution", "contributionRate", "indirect", "netProfit", "netMargin"]
PCT_KEYS = {"grossMargin", "contributionRate", "netMargin"}

LINE = Side(style="thin", color="000000")
GRID = Border(left=LINE, right=LINE, top=LINE, bottom=LINE)   # 表格所有单元格实线
BORDER = GRID


# ---------- 公式：与系统 t4Row 完全一致 ----------
def formula_for(key, col, row_of):
    r = lambda k: f"{col}{row_of[k]}"
    if key == "salesIncome":      return f"={r('retailIncome')}+{r('returnAmount')}+{r('refundAmount')}"
    if key == "salesCost":        return f"={r('retailCost')}+{r('returnCost')}"
    if key == "grossProfit":      return f"={r('salesIncome')}-{r('salesCost')}"
    if key == "grossMargin":      return f"=IF({r('salesIncome')}=0,0,{r('grossProfit')}/{r('salesIncome')})"
    if key == "operating":        return "=" + "+".join(r(k) for k in OPERATING)
    if key == "direct":           return "=" + "+".join(r(k) for k in DIRECT)
    if key == "contribution":     return f"={r('grossProfit')}-{r('operating')}-{r('direct')}"
    if key == "contributionRate": return f"=IF({r('salesIncome')}=0,0,{r('contribution')}/{r('salesIncome')})"
    if key == "indirect":         return "=" + "+".join(r(k) for k in INDIRECT)
    if key == "netProfit":        return f"={r('contribution')}-{r('indirect')}" + (f"+{r('rebateIncome')}" if 'rebateIncome' in row_of else '')
    if key == "netMargin":        return f"=IF({r('salesIncome')}=0,0,{r('netProfit')}/{r('salesIncome')})"
    return None


def derive(vals):
    """Python 复算，用于校验（与 formula_for 同口径）"""
    g = lambda k: vals.get(k, 0) or 0
    d = dict(vals)
    d["salesIncome"] = g("retailIncome") + g("returnAmount") + g("refundAmount")
    d["salesCost"] = g("retailCost") + g("returnCost")
    d["grossProfit"] = d["salesIncome"] - d["salesCost"]
    d["operating"] = sum(g(k) for k in OPERATING)
    d["direct"] = sum(g(k) for k in DIRECT)
    d["contribution"] = d["grossProfit"] - d["operating"] - d["direct"]
    d["indirect"] = sum(g(k) for k in INDIRECT)
    d["netProfit"] = d["contribution"] - d["indirect"] + g("rebateIncome")
    return d


# ---------- 样式 ----------
def hdr(cell, bold=True, link=False):
    # 可点击的表头用下划线提示（颜色仍为黑）
    cell.font = Font(name=FONT, bold=bold, size=10, color=C_TEXT, underline="single" if link else None)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = GRID


def title(ws, text, cols):
    ws["A1"] = text
    ws["A1"].font = Font(name=FONT, bold=True, size=14, color=C_TEXT)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(2, min(cols, 12)))
    ws.row_dimensions[1].height = 26
    ws.sheet_view.showGridLines = False


def note(ws, cell, text):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=9, color=C_SUB)


def link(ws, cell, text, target):
    ws[cell] = text
    ws[cell].hyperlink = target
    ws[cell].font = Font(name=FONT, size=9, color=C_LINK, underline="single")


def row_border(m):
    return GRID   # 所有表格单元格统一实线


def metric_name_cell(cell, m):
    cell.value = m["n"]
    cell.border = row_border(m)
    if m.get("pct"):                                      # 比率：斜体灰，弱化
        cell.font = Font(name=FONT, size=10, italic=True, color=C_SUB)
        cell.alignment = Alignment(indent=1)
    elif m["lvl"] == 0:                                   # 一级科目：加粗
        cell.font = Font(name=FONT, bold=True, size=10, color=C_TEXT)
    else:                                                 # 二级科目：缩进灰字
        cell.font = Font(name=FONT, size=10, color=C_SUB)
        cell.alignment = Alignment(indent=1)


def num_cell(cell, m, is_link=False):
    cell.number_format = FMT_PCT if m.get("pct") else FMT_AMT
    cell.border = row_border(m)
    cell.alignment = Alignment(horizontal="right")
    pct = bool(m.get("pct"))
    bold = m["lvl"] == 0 and not pct
    color = C_LINK if is_link else (C_SUB if (m["lvl"] or pct) else C_TEXT)
    cell.font = Font(name=FONT, bold=bold, italic=pct, size=10, color=color)


def sheet_name(name, used):
    s = re.sub(r"[\[\]\:\*\?\/\\]", "·", name).strip()[:28] or "渠道"
    base, i = s, 2
    while s in used:
        s = f"{base[:25]}~{i}"; i += 1
    used.add(s)
    return s


def q(s):
    return "'" + s.replace("'", "''") + "'"


# ---------- Sheet3…：渠道逐日利润表 ----------
def write_channel(wb, ch, days_data, meta, row_of, first_row):
    ws = wb.create_sheet(ch["sheet"])
    days, metrics, inputs = meta["days"], meta["metrics"], set(meta["inputKeys"])
    last_col = get_column_letter(2 + days)
    title(ws, f"{ch['name']} · {meta['period']} 每日利润表", 2 + days)
    note(ws, "A2", f"{ch['project']} / {ch['buName']}　实取 {ch['filled']}/{days} 天　　小计与比率为公式；每日数据来自系统取数（含费率/分摊派生）")
    link(ws, "A3", "← 返回总表", "#'总表'!A1")
    link(ws, "B3", f"{ch.get('buName', '事业部')} →", f"#{q(ch.get('bu_sheet', '总表'))}!A1")
    # 表头
    h = first_row - 1
    ws.cell(h, 1, "损益项目"); ws.cell(h, 2, "合计")
    for d in range(1, days + 1):
        ws.cell(h, 2 + d, f"{d}日")
    for c in range(1, 3 + days):
        hdr(ws.cell(h, c))
    ws.row_dimensions[h].height = 20
    # 科目行
    for m in metrics:
        r = row_of[m["k"]]
        metric_name_cell(ws.cell(r, 1), m)
        is_input = m["k"] in inputs
        # 合计列 B：取数项 = SUM(各日)；派生项 = 同口径公式作用于 B 列
        cb = ws.cell(r, 2, f"=SUM(C{r}:{last_col}{r})" if is_input else formula_for(m["k"], "B", row_of))
        num_cell(cb, m)
        for d in range(1, days + 1):
            col = get_column_letter(2 + d)
            if is_input:
                day = days_data[d - 1]
                v = day.get(m["k"]) if day.get("has") else None
                cell = ws.cell(r, 2 + d, None if v is None else v)
            else:
                cell = ws.cell(r, 2 + d, formula_for(m["k"], col, row_of))
            num_cell(cell, m)
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 14
    for d in range(1, days + 1):
        ws.column_dimensions[get_column_letter(2 + d)].width = 11
    ws.freeze_panes = f"C{first_row}"
    return ws


# ---------- 事业部页：事业部合计 + 该事业部各渠道（当月累计） ----------
def write_bu(ws, bu_name, chans, meta, row_of, first_row):
    metrics, inputs = meta["metrics"], set(meta["inputKeys"])
    n = len(chans)
    title(ws, f"{bu_name} · 渠道对比 · {meta['period']}", 2 + n)
    note(ws, "A2", f"{bu_name}合计 = 本页各渠道之和（公式）；渠道名与数字可点击跳转到该渠道逐日明细对应行")
    link(ws, "A3", "← 返回总表", "#'总表'!A1")
    h = first_row - 1
    ws.cell(h, 1, "损益项目"); ws.cell(h, 2, f"{bu_name}合计")
    for i, ch in enumerate(chans):
        c = ws.cell(h, 3 + i, ch["name"])
        c.hyperlink = f"#{q(ch['sheet'])}!A1"
    for c in range(1, 3 + n):
        hdr(ws.cell(h, c), link=c >= 3)   # 渠道表头可点击，用链接色
    ws.row_dimensions[h].height = 30
    last_col = get_column_letter(2 + n) if n else "B"
    for m in metrics:
        r = row_of[m["k"]]
        metric_name_cell(ws.cell(r, 1), m)
        is_input = m["k"] in inputs
        cb = ws.cell(r, 2, (f"=SUM(C{r}:{last_col}{r})" if n else 0) if is_input else formula_for(m["k"], "B", row_of))
        num_cell(cb, m)
        for i, ch in enumerate(chans):
            cell = ws.cell(r, 3 + i, f"={q(ch['sheet'])}!B{r}")
            cell.hyperlink = f"#{q(ch['sheet'])}!B{r}"
            num_cell(cell, m, is_link=True)
    ws.column_dimensions["A"].width = 20
    ws.column_dimensions["B"].width = 14
    for i in range(n):
        ws.column_dimensions[get_column_letter(3 + i)].width = 15
    ws.freeze_panes = f"C{first_row}"


# ---------- Sheet1：总表（竖式利润表：科目竖排，列 = 全部→项目→事业部 逐级汇总） ----------
def write_summary(ws, tree, chans, chans_by_id, meta, row_of, first_row):
    metrics, inputs = meta["metrics"], set(meta["inputKeys"])
    # 列 = 树上的非叶节点，DFS 顺序：全部、澳乐项目、其下各事业部、瑞眠项目、瑞眠事业部…
    nodes = []

    def collect(node):
        if not node.get("children"):
            return
        nodes.append(node)
        for c in node["children"]:
            collect(c)
    for root in tree:
        collect(root)
    for i, node in enumerate(nodes):
        node["_idx"] = i
        node["_col"] = get_column_letter(2 + i)
        node["_leaves"] = [c for c in leaf_list(node) if c.get("id") in chans_by_id]
        node["_is_bu"] = all(not c.get("children") for c in node["children"])
    bu_sheet = lambda node: node.get("_sheet")   # 事业部页名（main 中按层级建页时写入）

    title(ws, f"财务中心 · T4 日损益套表（{meta['scopeName']}）", 1 + len(nodes))
    filled_n = sum(1 for c in chans if c["filled"] > 0)
    note(ws, "A2", f"期间 {meta['period']}　生成 {meta['generated']}　渠道 {len(chans)} 个（实取 {filled_n} 个）")
    note(ws, "A3", "竖式利润表：科目竖排，列为 全部→项目→事业部 逐级汇总（均为公式，可点格核对）。事业部表头与数字可点击跳到该事业部页同一科目行，再点渠道跳到逐日明细。一级科目加粗，二级科目缩进。")
    # 表头一行（第 5 行）：名称按层级配色，事业部带 └ 标识并可点击；第 4 行留作间隔
    ws.cell(5, 1, "损益项目"); hdr(ws.cell(5, 1))
    for node in nodes:
        # 层级用字重表达：全部/项目加粗，事业部常规并带 └；事业部可点击（链接色）
        linkable = node["_is_bu"] and bool(bu_sheet(node))
        name = ws.cell(5, 2 + node["_idx"], ("└ " if node["_is_bu"] else "") + node["name"])
        hdr(name, bold=not node["_is_bu"], link=linkable)
        if linkable:
            name.hyperlink = f"#{q(bu_sheet(node))}!A1"
    ws.row_dimensions[4].height = 6
    ws.row_dimensions[5].height = 30

    for m in metrics:
        r = row_of[m["k"]]
        metric_name_cell(ws.cell(r, 1), m)
        for node in nodes:
            if m["k"] in inputs:
                # 取数项：事业部 = 各渠道明细页合计之和；项目/全部 = 子列之和
                if node["_is_bu"]:
                    terms = [f"{q(chans_by_id[c['id']]['sheet'])}!B{r}" for c in node["_leaves"]]
                else:
                    terms = [f"{c['_col']}{r}" for c in node["children"] if c.get("_col")]
                f = "=" + "+".join(terms) if terms else 0
            else:
                f = formula_for(m["k"], node["_col"], row_of)   # 小计/比率：同口径公式作用于本列
            cell = ws.cell(r, 2 + node["_idx"], f)
            link = node["_is_bu"] and bool(bu_sheet(node))
            num_cell(cell, m, is_link=link)
            if link:
                cell.hyperlink = f"#{q(bu_sheet(node))}!B{r}"   # 跳到事业部页合计列同一科目行
    # 底部：实取渠道数 + 口径说明
    r_info = max(row_of.values()) + 1
    c0 = ws.cell(r_info, 1, "实取渠道"); c0.font = Font(name=FONT, size=9, color=C_SUB); c0.border = BORDER
    for node in nodes:
        got = sum(1 for c in node["_leaves"] if chans_by_id[c["id"]]["filled"] > 0)
        cell = ws.cell(r_info, 2 + node["_idx"], f"{got}/{len(node['_leaves'])}")
        cell.font = Font(name=FONT, size=9, color=C_SUB); cell.alignment = Alignment(horizontal="center"); cell.border = BORDER
    note(ws, f"A{r_info + 2}", "口径：销售收入=零售收入+退货金额+退款金额；毛利=销售收入-销售成本；边际毛利=毛利-运营费-直接管理费；净利润=边际毛利-间接管理费。管理费按自然日分摊，费率类科目按参数页比例派生。")
    ws.column_dimensions["A"].width = 22
    for i in range(len(nodes)):
        ws.column_dimensions[get_column_letter(2 + i)].width = 16
    ws.freeze_panes = f"B{first_row}"


def leaf_list(node):
    if not node.get("children"):
        return [node]
    out = []
    for c in node["children"]:
        out.extend(leaf_list(c))
    return out


# ---------- 主流程 ----------
def main(inp, outp):
    data = json.load(open(inp, encoding="utf-8"))
    metrics = data["metrics"]
    first_row = 6                                   # 明细页/对比页科目起始行（第 5 行是表头）
    row_of = {m["k"]: first_row + i for i, m in enumerate(metrics)}
    chans = data["channels"]
    used = {"总表"}
    for ch in chans:
        ch["sheet"] = sheet_name(ch["name"], used)
    chans_by_id = {c["id"]: c for c in chans}

    wb = Workbook()
    ws_sum = wb.active; ws_sum.title = "总表"
    placed = set()

    # 按树的层级建页：每个事业部一页，紧跟其各渠道页（页序即层级）
    def is_bu(node):
        return bool(node.get("children")) and all(not c.get("children") for c in node["children"])

    def build(node):
        if is_bu(node):
            node["_sheet"] = sheet_name(node["name"], used)
            members = [chans_by_id[c["id"]] for c in node["children"] if c.get("id") in chans_by_id]
            ws_bu = wb.create_sheet(node["_sheet"])
            for ch in members:
                ch["bu_sheet"] = node["_sheet"]
                write_channel(wb, ch, data["dailyByCh"].get(ch["id"], []), data, row_of, first_row)
                placed.add(ch["id"])
            write_bu(ws_bu, node["name"], members, data, row_of, first_row)
        else:
            for c in node.get("children") or []:
                build(c)
    for root in data["tree"]:
        build(root)
    for ch in chans:                     # 兜底：未归入任何事业部的渠道
        if ch["id"] not in placed:
            ch["bu_sheet"] = "总表"
            write_channel(wb, ch, data["dailyByCh"].get(ch["id"], []), data, row_of, first_row)
    write_summary(ws_sum, data["tree"], chans, chans_by_id, data, row_of, first_row)
    wb.calculation = CalcProperties(fullCalcOnLoad=True)   # 打开即重算
    wb.active = 0
    wb.save(outp)

    # ---- 校验：按同口径复算月合计，与系统数比对 ----
    bad = []
    for ch in chans:
        days = data["dailyByCh"].get(ch["id"], [])
        tot = {}
        for day in days:
            if not day.get("has"):
                continue
            for k in data["inputKeys"]:
                tot[k] = tot.get(k, 0) + (day.get(k) or 0)
        d = derive(tot)
        sysm = data.get("monthByCh", {}).get(ch["id"], {})
        for k in ["salesIncome", "grossProfit", "operating", "netProfit"]:
            if abs(d.get(k, 0) - (sysm.get(k) or 0)) > 0.05:
                bad.append(f"{ch['name']}.{k}: excel={d.get(k, 0):.2f} sys={sysm.get(k) or 0:.2f}")
    print(json.dumps({"sheets": len(wb.sheetnames), "channels": len(chans), "verify_mismatch": bad[:10],
                      "ok": not bad}, ensure_ascii=False))
    if bad:
        print("校验不一致：" + "; ".join(bad[:10]), file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python build_suite.py input.json output.xlsx"); sys.exit(1)
    main(sys.argv[1], sys.argv[2])
