#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性数据修复（2026-09-18）：
1) 用 overviewByProvince 重建 provinces 域，使其月份长度与 meta.timeLevels.months (8个月) 对齐，
   解决“省份分析选月后没数据/数值错位”的问题。
2) 从《终版》Excel 的「智能体清单（各省）」抽取 服务环节大分类 / 应用场景小分类 / 应用类型，
   回填 agentMonthly 与 agentCaseCatalog（此前这两项 servicePhase/appScene 全为空），
   使「正向价值分析」可按服务类型分类、案例清单可按服务类型筛选。
"""
import json, os, openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
SRC_XLSX = os.path.join(ROOT, "build", "sources", "【合】灵运BI重要数据（终版）.xlsx")
DATA_JS = os.path.join(STATIC, "data.js")
REAL = "/tmp/real_data.json"

# ---------- 1. 读取当前数据（优先用已解密的有效 JSON，否则解析 data.js）----------
if os.path.exists(REAL):
    with open(REAL, encoding="utf-8") as f:
        data = json.load(f)
    print("[load] 使用 /tmp/real_data.json")
else:
    txt = open(DATA_JS, encoding="utf-8").read()
    i = txt.index("window.LINGYUN_DATA = ") + len("window.LINGYUN_DATA = ")
    data = json.JSONDecoder().raw_decode(txt[i:])[0]
    print("[load] 解析 static/data.js")

month_list = (data.get("meta", {}).get("timeLevels", {}) or {}).get("months") or data.get("months") or []
print("[info] 月份轴:", month_list, "共", len(month_list))

# ---------- 2. 从 Excel 构建 (省份,名称)->服务类型 查找表 ----------
def clean(v):
    return v if v not in (None, "", "--") else ""

def ns(v):
    return ("" if v is None else str(v)).strip()

def build_lookup(path, sheet, ctype, cph, csc):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    hdr = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    idx = {h: i for i, h in enumerate(hdr)}
    ci_prov, ci_name = idx["省份"], idx["应用名称"] or idx.get("已上线应用标准名称")
    ci_type, ci_ph, ci_sc = idx.get(ctype), idx.get(cph), idx.get(csc)
    lk = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r or (r[ci_name] in (None, "")):
            continue
        prov, name = ns(r[ci_prov]), ns(r[ci_name])
        lk[(prov, name)] = {
            "servicePhase": clean(r[ci_ph]),
            "appScene": clean(r[ci_sc]),
            "type": clean(r[ci_type]),
        }
    return lk

# 主源：智能体分类_20260902（服务环节/场景 覆盖率 100%）；兜底：终版（如个别缺失）
LK_MAIN = "【合】灵运BI重要数据_智能体分类_20260902.xlsx"
LK_FALL = "【合】灵运BI重要数据（终版）.xlsx"
print("[2] 读取主源 Excel 智能体清单（各省） ...")
lookup_b = build_lookup(os.path.join(ROOT, "build", "sources", LK_MAIN), "智能体清单（各省）", "应用类型", "服务环节大分类", "应用场景小分类")
print("[2]   主源查找表:", len(lookup_b))
lookup_a = build_lookup(SRC_XLSX, "智能体清单（各省）", "应用类型", "服务环节大分类", "应用场景小分类")
print("[2]   兜底查找表:", len(lookup_a))

lookup = dict(lookup_a)
for k, v in lookup_b.items():
    if v["servicePhase"] or v["appScene"] or v["type"]:
        lookup[k] = v  # 主源优先（覆盖更全）
print("[2] 合并查找表:", len(lookup))

# 名称->服务类型 兜底（用于案例清单按名称匹配）
name_lookup = {}
for (prov, name), v in lookup.items():
    name_lookup.setdefault(name, v)

# ---------- 3. 重建 provinces 域（来自 overviewByProvince，按月份轴对齐）----------
ovp = data.get("overviewByProvince", {})
midx = {m: i for i, m in enumerate(month_list)}
new_provinces = []
ph_hit = sc_hit = 0
for prov, recs in ovp.items():
    if prov == "全网":
        continue
    recs = sorted(recs, key=lambda x: month_list.index(x["month"]) if x["month"] in midx else 999)
    calls = [None] * len(month_list); toks = [None] * len(month_list)
    acts = [None] * len(month_list); cost = [None] * len(month_list)
    for r in recs:
        i = midx.get(r.get("month"))
        if i is None:
            continue
        calls[i] = r.get("calls")
        # 1-4月源表 Token/计费为0（未记录），以 None 表示“无数据”，前端显示 —
        toks[i] = r.get("tokens") if r.get("tokens") not in (None, 0, "") else None
        cost[i] = r.get("cost") if r.get("cost") not in (None, 0, "") else None
        acts[i] = r.get("activeAgents")
    tot_calls = sum(x for x in calls if x) or 0
    tot_tok = sum(x for x in toks if x) or 0
    tot_cost = sum(x for x in cost if x) or 0
    new_provinces.append({
        "province": prov,
        "monthlyCalls": calls,
        "monthlyTokens": toks,
        "monthlyActive": acts,
        "monthlyCost": cost,
        "calls": tot_calls,
        "tokens": tot_tok,
        "activeAgents": acts[-1] if acts and acts[-1] is not None else 0,
        "cost": tot_cost,
    })
data["provinces"] = new_provinces
print("[3] 重建 provinces:", len(new_provinces), "条，每月长度:", len(month_list))

# ---------- 4. 回填 agentMonthly.servicePhase / appScene ----------
am = data.get("agentMonthly", [])
am_hit = 0
for r in am:
    k = lookup.get((ns(r.get("province")), ns(r.get("name"))))
    if not k:
        k = name_lookup.get(ns(r.get("name")))
    if k:
        am_hit += 1
        if not r.get("servicePhase"):
            r["servicePhase"] = k["servicePhase"]
        if not r.get("appScene"):
            r["appScene"] = k["appScene"]
        if not r.get("type"):
            r["type"] = k["type"]
print("[4] agentMonthly 回填 servicePhase/appScene:", am_hit, "/", len(am))

# ---------- 5. 回填 agentCaseCatalog.servicePhase / appScene / type ----------
cc = data.get("agentCaseCatalog", [])
cc_hit = 0
for r in cc:
    k = lookup.get((ns(r.get("province")), ns(r.get("name"))))
    if not k:
        k = name_lookup.get(ns(r.get("name")))
    if k:
        cc_hit += 1
        if not r.get("servicePhase"):
            r["servicePhase"] = k["servicePhase"]
        if not r.get("appScene"):
            r["appScene"] = k["appScene"]
        if not r.get("type"):
            r["type"] = k["type"]
print("[5] agentCaseCatalog 回填:", cc_hit, "/", len(cc))

# ---------- 6. 写回 static/data.js ----------
out = "window.LINGYUN_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
with open(DATA_JS, "w", encoding="utf-8") as f:
    f.write(out)
print("[6] 已写回 static/data.js  (%.1f MB)" % (len(out) / 1048576))

# 自检
ph = sum(1 for r in data["agentMonthly"] if r.get("servicePhase"))
ccph = sum(1 for r in data["agentCaseCatalog"] if r.get("servicePhase"))
print("[check] agentMonthly 有 servicePhase:", ph, "/", len(data["agentMonthly"]))
print("[check] agentCaseCatalog 有 servicePhase:", ccph, "/", len(data["agentCaseCatalog"]))
print("[check] provinces monthlyCalls 长度示例:", [len(p["monthlyCalls"]) for p in data["provinces"][:3]])
print("OK")
