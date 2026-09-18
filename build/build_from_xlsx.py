# -*- coding: utf-8 -*-
"""
build_from_xlsx.py —— 从终版 xlsx 生成 data.js（覆盖式合并）
保留旧 data.js 中 xlsx 未包含的域（tracking/platformTracking/platformMonthly/
capability/centerYearRank/qeMonthlySummary/alerts/agents/provinces），用 xlsx 覆盖更新：
  overview / overviewByProvince / agentMonthly / agentCaseCatalog
  + 新聚合键：appsCallsNational appsCallsByProv appsTokensNational appsTokensByProv
             appsCostNational appsCostByProv appsPersonYearNational appsPersonYearByProv
             appCatalogByProv months flags meta.reportMonths
列定位全部按「表头名」匹配（终版 xlsx 在总览表插入了「投产智能体数」列，固定下标会错位）。
"""
import os, re, json, datetime
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
OLD_DATA = os.path.join(STATIC, "data.js")
SRC = os.path.join(ROOT, "build", "sources")
XLSX = os.path.join(SRC, "【合】灵运BI重要数据（终版）.xlsx")
OUT = OLD_DATA

MONTH_ORDER = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"]
def month_no(m):
    mm = re.match(r"(\d+)", str(m))
    return int(mm.group(1)) if mm else 999
def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else round(f, 4)
    except Exception:
        return None
def s(v):
    return "" if v is None else str(v).strip()
def flag(v):
    try:
        return 1 if int(float(v)) == 1 else 0
    except Exception:
        return 0

# ---------- 读取旧 data.js（基底，保留其它域）----------
def load_old():
    text = open(OLD_DATA, encoding="utf-8").read()
    i = text.index("window.LINGYUN_DATA = ") + len("window.LINGYUN_DATA = ")
    rest = text[i:]  # 可能尾部还有其它 JS 语句，只解析首个 JSON 对象
    dec = json.JSONDecoder()
    obj, _ = dec.raw_decode(rest)
    return obj

print("[1/8] 读取旧 data.js 基底 ...")
old = load_old()
print("     旧顶层键:", ",".join(old.keys()))

wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
print("[2/8] 打开 xlsx:", XLSX)

# ---------- 表头名 -> 列下标 工具 ----------
def header_map(ws, max_scan=6):
    rows = list(ws.iter_rows(values_only=True))
    for i, r in enumerate(rows[:max_scan]):
        cells = [s(c) for c in (r or [])]
        if "月份" in cells and ("省份" in cells or "智能体调用量" in cells or "应用名称" in cells):
            return {name: idx for idx, name in enumerate(cells)}, i
    # 退化：首行
    first = [s(c) for c in (rows[0] or [])]
    return {name: idx for idx, name in enumerate(first)}, 0

# ---------- overviewByProvince（关键数据总览 全网/各省）----------
OVP_FIELDS = [
    ("calls", "智能体调用量"), ("tokens", "总Token数"), ("tokensBusy", "忙时总Token数"),
    ("tokensIdle", "闲时总Token数"), ("cumRegUsers", "累计注册人数"), ("pagePV", "平台总访问PV"),
    ("productionRate", "投产率"), ("producingAgents", "投产智能体数"), ("activeAgents", "活跃智能体数"),
    ("hotAgents", "高热度智能体数"), ("promoAgents", "推广智能体数"), ("excellentAgents", "优秀智能体数"),
    ("excellentAgentsBiweek", "双周优秀智能体数"), ("totalAgentsOnline", "智能体总数量（上线）"),
    ("newRegUsers", "新增注册人数"), ("activeCoverMonthly", "活跃用户覆盖度（月）"),
    ("mau", "活跃用户数（月）"), ("silentLost", "沉默/流失用户数"), ("personYear", "节约人年"),
    ("cost", "模型计费（元）"), ("costBusy", "忙时模型计费（元）"), ("costIdle", "闲时模型计费（元）"),
]
def build_overview_by_province():
    merged = {}
    seen = set()
    for sheet_name, allow_national in (
        ("关键数据总览（月）（全网）", True),
        ("关键数据总览（月）（各省）", False),
    ):
        ws = wb[sheet_name]
        hmap, hdr = header_map(ws)
        # 确保列都存在
        missing = [f for _, f in OVP_FIELDS if f not in hmap]
        if missing:
            print("  [warn] %s 缺列: %s" % (sheet_name, ",".join(missing)))
        rows = list(ws.iter_rows(values_only=True))
        for r in rows[hdr+1:]:
            if r is None or r[0] is None:
                continue
            mraw = s(r[0])
            if not re.match(r"^\d+月$", mraw):
                continue
            prv = r[1]
            if prv in (None, "", "总计"):
                prv = "全网"
            else:
                prv = s(prv)
            if prv == "全网" and not allow_national:
                continue
            key = (prv, mraw)
            if key in seen:
                continue
            seen.add(key)
            rec = {"month": mraw, "province": prv}
            for field, col in OVP_FIELDS:
                ci = hmap.get(col)
                rec[field] = num(r[ci]) if ci is not None else None
            # 别名（供 provinceRank / 累计切换兜底）
            rec["activeUsers"] = rec["mau"]
            rec["activeCover"] = rec["activeCoverMonthly"]
            rec["activeUsersCum"] = None
            rec["activeCoverCum"] = None
            rec["activeUsersWAU"] = None
            merged.setdefault(prv, []).append(rec)
    for k in merged:
        merged[k].sort(key=lambda x: month_no(x["month"]))
    # 全网 sheet 的 推广/优秀/双周 智能体数为空（源表未填），由各省逐月求和补全
    # （各省该列为「1月至当月累计」，逐省求和即全国累计，与全网语义一致）
    NAT_SUM = ["promoAgents", "excellentAgents", "excellentAgentsBiweek"]
    prov_months = {}
    for p, recs in merged.items():
        if p == "全网":
            continue
        for rec in recs:
            prov_months.setdefault(rec["month"], {})
            for f in NAT_SUM:
                prov_months[rec["month"]][f] = (prov_months[rec["month"]].get(f) or 0) + (rec.get(f) or 0)
    for rec in merged.get("全网", []):
        sm = prov_months.get(rec["month"])
        if sm:
            for f in NAT_SUM:
                rec[f] = sm[f]
    return merged

print("[3/8] 生成 overviewByProvince ...")
ovp = build_overview_by_province()
months = sorted(ovp.get("全网", []), key=lambda x: month_no(x["month"]))
month_list = [m["month"] for m in months]
overview = {"monthly": months, "kpis": old.get("overview", {}).get("kpis")}
print("     区域数:", len(ovp), " 月份:", month_list)

# ---------- agentMonthly（智能体清单（各省））----------
AGENT_FIELDS = [
    ("creator", "创建人"), ("createdAt", "创建时间"), ("appId", "应用ID"),
    ("description", "应用说明"), ("type", "应用类型"), ("tags", "应用标签"),
    ("servicePhase", "服务环节大分类"), ("appScene", "应用场景小分类"), ("status", "应用状态"),
    ("calls", "应用调用量"), ("tokens", "总Token数"), ("busyTokens", "忙时总Token数"),
    ("idleTokens", "闲时总Token数"), ("modelCost", "模型计费（元）"), ("busyCost", "忙时模型计费（元）"),
    ("idleCost", "闲时模型计费（元）"), ("saveSec", "单笔节约时长"), ("personYear", "节约人年"),
    ("copyCount", "复制量"),
]
AGENT_FLAGS = [
    ("hasCalls", "是否有调用标记（月调用量>0）"), ("isActive", "是否活跃智能体（月调用量>1000）"),
    ("isHighEff", "是否活跃且高提效智能体（月调用量>1000&提效>30%）"), ("isHot", "是否高热度智能体（月调用量>100000）"),
    ("isPromo", "是否推广智能体"), ("isExcellent", "是否优秀智能体"), ("isBiweek", "是否双周优秀智能体"),
    ("isMarketplace", "是否上架到应用广场"),
]
print("[4/8] 生成 agentMonthly ...")
ws = wb["智能体清单（各省）"]
hmap, hdr = header_map(ws)
missing = [f for _, f in AGENT_FIELDS + AGENT_FLAGS if f not in hmap] + (["月份","省份","应用名称"] if any(k not in hmap for k in ["月份","省份","应用名称"]) else [])
if missing:
    print("  [warn] 智能体清单 缺列: %s" % ",".join(missing))
rows = list(ws.iter_rows(values_only=True))
agentMonthly = []
for r in rows[hdr+1:]:
    if r is None or r[0] is None:
        continue
    mraw = s(r[hmap["月份"]]) if "月份" in hmap else None
    if not re.match(r"^\d+月$", mraw):
        continue
    name = s(r[hmap["应用名称"]]) if "应用名称" in hmap else ""
    if not name:
        continue
    prov = s(r[hmap["省份"]]) if "省份" in hmap else "未标注"
    rec = {
        "month": mraw, "province": prov or "未标注",
        "name": name,
    }
    for field, col in AGENT_FIELDS:
        ci = hmap.get(col)
        rec[field] = num(r[ci]) if ci is not None else None
    for field, col in AGENT_FLAGS:
        ci = hmap.get(col)
        rec[field] = flag(r[ci]) if ci is not None else 0
    # 应用说明/类型/标签/状态 用字符串
    rec["description"] = s(r[hmap["应用说明"]]) if "应用说明" in hmap else ""
    rec["type"] = s(r[hmap["应用类型"]]) if "应用类型" in hmap else "其他"
    rec["tags"] = s(r[hmap["应用标签"]]) if "应用标签" in hmap else ""
    rec["status"] = s(r[hmap["应用状态"]]) if "应用状态" in hmap else "未标注"
    rec["creator"] = s(r[hmap["创建人"]]) if "创建人" in hmap else ""
    rec["createdAt"] = s(r[hmap["创建时间"]]) if "创建时间" in hmap else ""
    rec["appId"] = s(r[hmap["应用ID"]]) if "应用ID" in hmap else None
    rec["effRatio"] = num(r[hmap["提效比率"]]) if "提效比率" in hmap else None
    # 是否使用大模型 整列是 "None"，改由类型推导
    t = rec["type"]
    rec["isLLM"] = 1 if (t.find("智能体") >= 0 or t.find("对话") >= 0 or t.find("大模型") >= 0) else 0
    # 兼容别名
    rec["isCalled"] = rec["hasCalls"]
    rec["isActiveHighEff"] = rec["isHighEff"]
    agentMonthly.append(rec)
agentMonthly.sort(key=lambda x: (month_no(x["month"]), x["province"], x["name"]))
print("     agentMonthly 行数:", len(agentMonthly))

# ---------- agentCaseCatalog（推广/优秀/双周优秀案例 合并）----------
def build_case_catalog():
    out = []
    def add(sheet_name, type_tag, has_scene):
        try:
            w = wb[sheet_name]
        except Exception:
            return
        hmap, h = header_map(w)
        ci_name = hmap.get("应用名称") or hmap.get("已上线应用标准名称")
        if ci_name is None:
            print("  [warn] %s 未找到应用名称列" % sheet_name); return
        ci_prov = hmap.get("省份")
        ci_creator = hmap.get("创建人")
        ci_ct = hmap.get("创建时间")
        ci_scene = hmap.get("推广场景")
        rrows = list(w.iter_rows(values_only=True))
        for r in rrows[h+1:]:
            if r is None:
                continue
            # 跳过「字段说明」说明行（列0=字段说明，或名称列=无）
            if s(r[0]) == "字段说明":
                continue
            nm = s(r[ci_name])
            if not nm or nm == "无":
                continue
            pv = s(r[ci_prov]) if ci_prov is not None else ""
            out.append({
                "kinds": [type_tag],
                "promoScene": s(r[ci_scene]) if (has_scene and ci_scene is not None) else "",
                "province": pv, "name": nm,
                "creator": s(r[ci_creator]) if ci_creator is not None else "",
                "createdAt": s(r[ci_ct]) if ci_ct is not None else "",
                "isPromo": 1 if type_tag == "推广案例" else 0,
                "isExcellent": 1 if type_tag == "优秀案例" else 0,
                "isBiweek": 1 if type_tag == "双周优秀案例" else 0,
                "monthlyPersonYear": {},
            })
    add("推广案例", "推广案例", True)
    add("优秀案例", "优秀案例", False)
    add("双周优秀案例", "双周优秀案例", False)
    return out

agentCaseCatalog = build_case_catalog()
print("     agentCaseCatalog 条数:", len(agentCaseCatalog))

# ---------- 新聚合键 ----------
print("[5/8] 生成 apps* 聚合键 ...")
def aggregate(key_other):
    national = {}
    byProv = {}
    for rec in agentMonthly:
        m = rec["month"]; p = rec["province"]
        v = rec.get(key_other)
        if v is None:
            continue
        national[m] = (national.get(m) or 0) + v
        byProv.setdefault(p, {})[m] = (byProv.get(p, {}).get(m) or 0) + v
    return national, byProv

appsCallsNational, appsCallsByProv = aggregate("calls")
appsTokensNational, appsTokensByProv = aggregate("tokens")
appsCostNational, appsCostByProv = aggregate("modelCost")
appsPersonYearNational, appsPersonYearByProv = aggregate("personYear")

appCatalogByProv = {}
name_prov = {}
for rec in agentMonthly:
    p = rec["province"]; nm = rec["name"]; m = rec["month"]
    key = p + "|" + nm
    if key not in name_prov:
        item = {"name": nm, "province": p, "calls": {}}
        name_prov[key] = item
        appCatalogByProv.setdefault(p, []).append(item)
    name_prov[key]["calls"][m] = (name_prov[key]["calls"].get(m) or 0) + (rec["calls"] or 0)

flags = {"overviewProvNote": ""}
print("     appsCallsNational 月份:", list(appsCallsNational.keys()))

# ---------- 合并写入 data.js ----------
print("[6/8] 合并并写出 data.js ...")
newD = dict(old)  # 基底（保留 tracking/platformTracking/.../agents/provinces）
newD["overview"] = overview
newD["overviewByProvince"] = ovp
newD["agentMonthly"] = agentMonthly
newD["agentCaseCatalog"] = agentCaseCatalog
newD["appsCallsNational"] = appsCallsNational
newD["appsCallsByProv"] = appsCallsByProv
newD["appsTokensNational"] = appsTokensNational
newD["appsTokensByProv"] = appsTokensByProv
newD["appsCostNational"] = appsCostNational
newD["appsCostByProv"] = appsCostByProv
newD["appsPersonYearNational"] = appsPersonYearNational
newD["appsPersonYearByProv"] = appsPersonYearByProv
newD["appCatalogByProv"] = appCatalogByProv
newD["months"] = month_list
newD["flags"] = flags
newD["agentLifecycle"] = old.get("agentLifecycle", {})
# 更新 meta
meta = dict(old.get("meta", {}))
meta["generatedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
meta["period"] = "2026年" + (month_list[0] if month_list else "") + "-" + (month_list[-1] if month_list else "")
provs = sorted([k for k in ovp.keys() if k != "全网"])
meta["provinces"] = provs
tl = meta.get("timeLevels", {})
tl = dict(tl); tl["months"] = month_list; meta["timeLevels"] = tl
meta["reportMonths"] = month_list
newD["meta"] = meta

with open(OUT, "w", encoding="utf-8") as f:
    f.write("// 自动生成（build_from_xlsx.py，源：《【合】灵运BI重要数据（终版）》）。请勿手改。\n")
    f.write("window.LINGYUN_DATA = ")
    json.dump(newD, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print("[7/8] 完成。")
print("     data.js 顶层键:", ",".join(newD.keys()))
print("     文件大小: %.1f MB" % (os.path.getsize(OUT)/1048576))

# ---------- 自检 ----------
print("[8/8] 数据自检 ...")
assert "全网" in ovp and ovp["全网"], "overviewByProvince 全网缺失"
need = ["calls","tokens","activeAgents","producingAgents","mau","activeCoverMonthly","personYear","cost"]
miss = [k for k in need if ovp["全网"][0].get(k) is None]
print("     全网首月字段缺失:", miss or "无")
assert agentMonthly, "agentMonthly 为空"
need2 = ["calls","effRatio","province","name","month","hasCalls","isActive","isHighEff","isHot","isPromo","isExcellent","isBiweek","modelCost","copyCount","personYear","isLLM"]
m2 = agentMonthly[0]
miss2 = [k for k in need2 if k not in m2]
print("     agentMonthly 缺键:", miss2 or "无")
print("     样例 agentMonthly[0]:", json.dumps({k:m2[k] for k in ["month","province","name","calls","isActive","isHighEff","isHot","isLLM","modelCost","copyCount","personYear"]}, ensure_ascii=False))
print("     appsPersonYearNational:", appsPersonYearNational)
wb.close()
print("OK")
