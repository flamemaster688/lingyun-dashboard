#!/usr/bin/env python3
# 合并 用户行为记录(1)(1).xlsx 与 质效分析.xlsx 到 data.js
# 重建 4 个域：tracking(扁平) / platformTracking(平台分析) / centerYearRank / qeMonthlySummary
# 覆盖式合并：仅替换这 4 个顶层键，其余域（overview/agentMonthly/...）保持不变。
import json, re, os
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
SRC = os.path.join(ROOT, "build", "sources")
OLD_DATA = os.path.join(STATIC, "data.js")
BEHAVIOR_XLSX = os.path.join(SRC, "用户行为记录.xlsx")
QE_XLSX = os.path.join(SRC, "质效分析.xlsx")

def s(v): return "" if v is None else str(v).strip()
def num(v):
    if v is None or v == "": return 0
    try: return float(str(v).replace(",", ""))
    except: return 0

# ---------- 1) 加载旧 data.js ----------
txt = open(OLD_DATA, encoding="utf-8").read()
MARK = "window.LINGYUN_DATA = "
marker_idx = txt.index(MARK)
prefix = txt[:marker_idx]          # 仅头部注释（不含标记本身）
i = txt.rfind(MARK) + len(MARK)    # 取最后一个标记，兼容已损坏（双重标记）文件
obj, _ = json.JSONDecoder().raw_decode(txt[i:])
print("[1] 已加载 data.js，顶层键:", len(obj.keys()))

# ---------- 2) 解析 用户行为记录 → platformTracking + tracking ----------
print("\n[2] 解析 用户行为记录 ...")
wb = openpyxl.load_workbook(BEHAVIOR_XLSX, read_only=True, data_only=True)
MONTHS_BEH = []  # ["2026-5", ...]
# cell[month][page][prov] = {clicks, visitors, exposures}
cell = {}
month_tot = {}   # month -> {clicks,visitors,exposures}
PROV_HEAD = {'province','NAME','省份','统计月份','字段说明','全国',''}
PAGE_HEAD = {'PAGE','页面','访客人数','曝光次数','点击量','省份','统计月份','字段说明',''}
for ws in wb.worksheets:
    m = re.match(r"^(\d+)月$", ws.title)
    if not m:
        print("  跳过非月份表:", ws.title); continue
    mnum = int(m.group(1))
    month = "2026-%d" % mnum
    MONTHS_BEH.append(month)
    rows = list(ws.iter_rows(values_only=True))
    cP, cN, cPAGE, cC = 0, 1, 2, 3          # 点击量
    vP, vPAGE, vC = 5, 6, 7                  # 访客人数
    eP, eN, ePAGE, eC = 9, 10, 11, 12        # 曝光次数
    cnt = 0
    for r in rows:
        if len(r) < 13: continue
        # 点击量（跳过表头/空白行）
        if r[cC] is not None and r[cPAGE] is not None and s(r[cPAGE]) and s(r[cPAGE]) not in PAGE_HEAD and s(r[cP]) not in PROV_HEAD:
            prov, page, clicks = s(r[cP]), s(r[cPAGE]), num(r[cC])
            cell.setdefault(month, {}).setdefault(page, {}).setdefault(prov, {"clicks":0,"visitors":0,"exposures":0})
            cell[month][page][prov]["clicks"] += clicks
        # 访客人数
        if r[vC] is not None and r[vPAGE] is not None and s(r[vPAGE]) and s(r[vPAGE]) not in PAGE_HEAD and s(r[vP]) not in PROV_HEAD:
            prov, page, vis = s(r[vP]), s(r[vPAGE]), num(r[vC])
            cell.setdefault(month, {}).setdefault(page, {}).setdefault(prov, {"clicks":0,"visitors":0,"exposures":0})
            cell[month][page][prov]["visitors"] += vis
        # 曝光次数
        if r[eC] is not None and r[ePAGE] is not None and s(r[ePAGE]) and s(r[ePAGE]) not in PAGE_HEAD and s(r[eP]) not in PROV_HEAD:
            prov, page, exp = s(r[eP]), s(r[ePAGE]), num(r[eC])
            cell.setdefault(month, {}).setdefault(page, {}).setdefault(prov, {"clicks":0,"visitors":0,"exposures":0})
            cell[month][page][prov]["exposures"] += exp
        cnt += 1
    month_tot[month] = {"clicks":0,"visitors":0,"exposures":0}
    print("  表 %s 解析数据行约 %d" % (month, cnt))
wb.close()
MONTHS_BEH.sort()

def L1(p): return p.split("-")[0]
def L3(p):
    return "-".join(p.split("-")[:3]) if p.count("-") >= 2 else p

pageByWeek, provinceByWeek, moduleByWeek = {}, {}, {}
provModuleByWeek, provModuleL3ByWeek = {}, {}
for month in MONTHS_BEH:
    pBW, prBW, mBW, pmBW, pmL3 = {}, {}, {}, {}, {}
    for page, provs in cell[month].items():
        mod = L1(page); modL3 = L3(page)
        for prov, rec in provs.items():
            c, v, e = rec["clicks"], rec["visitors"], rec["exposures"]
            # page agg
            a = pBW.setdefault(page, {"clicks":0,"visitors":0,"exposures":0}); a["clicks"]+=c; a["visitors"]+=v; a["exposures"]+=e
            # province agg
            b = prBW.setdefault(prov, {"clicks":0,"visitors":0,"exposures":0}); b["clicks"]+=c; b["visitors"]+=v; b["exposures"]+=e
            # module agg
            d = mBW.setdefault(mod, {"clicks":0,"visitors":0,"exposures":0}); d["clicks"]+=c; d["visitors"]+=v; d["exposures"]+=e
            # provModule (clicks): module -> province -> clicks
            pmBW.setdefault(mod, {}).setdefault(prov, 0); pmBW[mod][prov] += c
            # provModule L3
            pmL3.setdefault(modL3, {}).setdefault(prov, 0); pmL3[modL3][prov] += c
            # month total
            mt = month_tot[month]; mt["clicks"]+=c; mt["visitors"]+=v; mt["exposures"]+=e
    pageByWeek[month] = pBW
    provinceByWeek[month] = prBW
    moduleByWeek[month] = mBW
    provModuleByWeek[month] = pmBW
    provModuleL3ByWeek[month] = pmL3

def ctr(o):
    return round(o["clicks"]/o["exposures"]*100, 2) if o["exposures"] else 0

# 汇总跨月（全国页面级 + 省份级 + 模块级）
pg_all, pr_all, mo_all = {}, {}, {}
for month in MONTHS_BEH:
    for p, r in pageByWeek[month].items():
        a = pg_all.setdefault(p, {"clicks":0,"visitors":0,"exposures":0}); a["clicks"]+=r["clicks"]; a["visitors"]+=r["visitors"]; a["exposures"]+=r["exposures"]
    for p, r in provinceByWeek[month].items():
        a = pr_all.setdefault(p, {"clicks":0,"visitors":0,"exposures":0}); a["clicks"]+=r["clicks"]; a["visitors"]+=r["visitors"]; a["exposures"]+=r["exposures"]
    for m_, r in moduleByWeek[month].items():
        a = mo_all.setdefault(m_, {"clicks":0,"visitors":0,"exposures":0}); a["clicks"]+=r["clicks"]; a["visitors"]+=r["visitors"]; a["exposures"]+=r["exposures"]

pageTotals = [{"page":p, "clicks":r["clicks"], "visitors":r["visitors"], "exposures":r["exposures"], "ctr":ctr(r)} for p,r in pg_all.items()]
moduleTotals = [{"module":m_, "clicks":r["clicks"], "visitors":r["visitors"], "exposures":r["exposures"], "ctr":ctr(r)} for m_,r in mo_all.items()]
provinceTotals = [{"province":p, "clicks":r["clicks"], "visitors":r["visitors"], "exposures":r["exposures"], "ctr":ctr(r)} for p,r in pr_all.items()]

platformTracking = {
    "source": "灵运BI·用户行为记录（月·省份×页面·点击/访客/曝光）",
    "fileUrl": "",
    "weeks": MONTHS_BEH,
    "weekMonth": {m: m for m in MONTHS_BEH},
    "months": MONTHS_BEH,
    "weekly": {
        "labels": MONTHS_BEH,
        "clicks": [month_tot[m]["clicks"] for m in MONTHS_BEH],
        "visitors": [month_tot[m]["visitors"] for m in MONTHS_BEH],
        "exposures": [month_tot[m]["exposures"] for m in MONTHS_BEH],
    },
    "pageByWeek": pageByWeek,
    "provinceByWeek": provinceByWeek,
    "moduleByWeek": moduleByWeek,
    "provModuleByWeek": provModuleByWeek,
    "provModuleL3ByWeek": provModuleL3ByWeek,
    "pageTotals": pageTotals,
    "moduleTotals": moduleTotals,
    "provinceTotals": provinceTotals,
}
print("  platformTracking: weeks=%d pages=%d provinces=%d modules=%d" % (
    len(MONTHS_BEH), len(pg_all), len(pr_all), len(mo_all)))

# flat tracking = 页面级全国汇总（保留原结构：page/clicks/visitors/exposures/ctr）
tracking = [{"page":p, "clicks":r["clicks"], "visitors":r["visitors"], "exposures":r["exposures"], "ctr":ctr(r)} for p,r in sorted(pg_all.items())]
print("  tracking(扁平): %d 条页面记录" % len(tracking))

# ---------- 3) 解析 质效分析 → centerYearRank + qeMonthlySummary ----------
print("\n[3] 解析 质效分析 ...")
wb2 = openpyxl.load_workbook(QE_XLSX, read_only=True, data_only=True)

# --- centerYearRank ---
def parse_center(sheet_name, year_prefix):
    ws = wb2[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [s(c) for c in rows[0]]
    col = {name: hdr.index(name) for name in hdr if name}
    provi = hdr.index("省份名称"); codei = hdr.index("省份编码"); mi = hdr.index("统计月份")
    mapp = {
        "智能化应用等效节约人年": "platform", "智能语音等效节约人年": "voice",
        "RPA等效节约人年": "rpa", "智能点选等效节约人年": "select",
        "智能质检等效节约人年": "qa", "智能教练等效节约人年": "coach",
    }
    recs = {}
    months = []
    for r in rows[1:]:
        if r[mi] is None: continue
        month = s(r[mi]); prov = s(r[provi]); code = s(r[codei])
        if month not in months: months.append(month)
        rec = {}
        for hname, key in mapp.items():
            if hname in col: rec[key] = num(r[col[hname]])
        recs.setdefault(prov, {})[month] = rec
    return recs, months, code_map_build(rows, hdr, provi, codei, mi)

def code_map_build(rows, hdr, provi, codei, mi):
    cm = {}
    for r in rows[1:]:
        if r[mi] is None: continue
        cm[s(r[provi])] = s(r[codei])
    return cm

recs2025, months2025, codes2025 = parse_center("2025年31个分中心等效人年数据", "2025")
recs2026, months2026, codes2026 = parse_center("2026年31个分中心等效人年数据", "2026")
months2025.sort(); months2026.sort()
print("  2025 月份:", months2025, " 2026 月份:", months2026)

ABILITIES = [
    ("platform", "智能化应用", True, True),
    ("voice", "智能语音客服", True, True),
    ("rpa", "RPA", True, True),
    ("select", "智能点选", True, False),
    ("qa", "智能质检", True, True),
    ("coach", "智能教练", True, True),
]
# 实体（省份 + 全国），合并 2025/2026
all_provs = set(recs2025.keys()) | set(recs2026.keys())
entities = []
for prov in sorted(all_provs):
    code = codes2025.get(prov) or codes2026.get(prov) or ""
    typ = "national" if prov == "全国" else "center"
    a25 = {}; a26 = {}
    t25 = 0.0; t26 = 0.0
    for key, _, _, _ in ABILITIES:
        arr25 = [recs2025.get(prov, {}).get(mn, {}).get(key, 0) if mn in recs2025.get(prov, {}) else 0 for mn in months2025]
        arr26 = [recs2026.get(prov, {}).get(mn, {}).get(key, 0) if mn in recs2026.get(prov, {}) else 0 for mn in months2026]
        # 2026 缺失 select → 全 0
        if key == "select" and prov not in recs2026:
            arr26 = [0]*len(months2026)
        a25[key] = arr25; a26[key] = arr26
        t25 += sum(arr25); t26 += sum(arr26)
    entities.append({
        "province": prov, "code": code, "type": typ,
        "ability2025": a25, "ability2026": a26,
        "total2025": round(t25, 2), "total2026": round(t26, 2),
    })
centerYearRank = {
    "periodLabel": "2025年1-12月·2026年1-7月",
    "endMonth": 7,
    "months": list(range(1, 13)),
    "months2025": months2025,
    "months2026": months2026,
    "abilities": [{"key":k,"name":n,"in2025":i25,"in2026":i26} for k,n,i25,i26 in ABILITIES],
    "entities": entities,
}
print("  centerYearRank: 实体 %d 个, abilities=%s" % (len(entities), [a[0] for a in ABILITIES]))

# --- qeMonthlySummary ---
ws = wb2["数据月度汇总"]
rows = list(ws.iter_rows(values_only=True))
hdr = [s(c).strip("'\"").strip() for c in rows[0]]
col = {name: hdr.index(name) for name in hdr if name}
mapp = {"灵运平台":"platform","RPA":"rpa","智能教练":"coach","智能质检":"qa","智能立单":"order","智能语音":"voice"}
qe_months = []
qe_vals = {v: [] for _, v in mapp.items()}
qe_total4 = []; qe_cum = []
for r in rows[1:]:
    ml = s(r[0])
    if not ml or not re.match(r"^\d+月$", ml): continue
    qe_months.append(ml)
    for hname, key in mapp.items():
        qe_vals[key].append(num(r[col[hname]]))
    qe_total4.append(num(r[col["4项总计"]]))
    qe_cum.append(num(r[col["月累计"]]))
qe_abilities = []
yearTotal = {}
for hname, key in mapp.items():
    has2025 = key in ("platform","rpa","coach","qa","voice")  # 智能立单(order) 无2025分中心数据
    qe_abilities.append({"key":key, "name":hname, "has2025":has2025, "values":qe_vals[key]})
    yearTotal[key] = round(sum(qe_vals[key]), 2)
yearTotal["total4"] = round(sum(qe_total4), 2)
qeMonthlySummary = {
    "months": qe_months,
    "abilities": qe_abilities,
    "total4": qe_total4,
    "cumTotal": qe_cum,
    "yearTotal": yearTotal,
    "source": "灵运BI·质效分析（离线Excel）sheet3「数据月度汇总」",
}
print("  qeMonthlySummary: months=%d abilities=%s" % (len(qe_months), [a["key"] for a in qe_abilities]))
wb2.close()

# ---------- 4) 合并写回 ----------
obj["tracking"] = tracking
obj["platformTracking"] = platformTracking
obj["centerYearRank"] = centerYearRank
obj["qeMonthlySummary"] = qeMonthlySummary

with open(OLD_DATA, "w", encoding="utf-8") as f:
    f.write(prefix)
    f.write(MARK)
    json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
print("\n[4] 已写回 data.js 顶层键数:", len(obj.keys()))
print("  tracking=%d, platformTracking weeks=%d, centerYearRank entities=%d, qe months=%d"
      % (len(tracking), len(MONTHS_BEH), len(entities), len(qe_months)))
print("DONE")
