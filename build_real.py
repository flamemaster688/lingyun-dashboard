# -*- coding: utf-8 -*-
"""
灵运平台 BI 看板 · 真实数据构建器
数据源：金山文档在线文件「数据验证.ksheet」
  (file_id=sKSGFQ6W69M1LN3AdtCW1xc3VrBHYQQae, link=https://www.kdocs.cn/l/csizWM8t2VLc)
通过 mcp__kdocs 连接器 get_range_data 取数，落盘为 _raw_sheet*.csv 后由本脚本汇总成 static/data.js。

映射：
  overview   <- sheet5  1-7月调用量/节约人年/活跃智能体
  agents     <- sheet4  智能体级等效人年（推广+优秀+双周）
  provinces  <- sheet6  各省月度调用量+活跃 ; sheet7 各省Token+费用
  tracking   <- sheet9  埋点日志按页面聚合 点击/访客/曝光
  capability <- sheet8  多能力等效人年
  alerts     <- 真实文件未含 -> 空 + 备注"/"

取不到的字段统一以 null 表示，前端渲染为"/"。
"""
import os, csv, json, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")


def fnum(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("%", "")
    if s == "" or s.lower() in ("nan", "none", "null", "/", "—", "暂无"):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else round(f, 4)
    except ValueError:
        return None


def read_csv_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))


# ---------- 1) overview (sheet5) ----------
# 默认值（内嵌真实数值，作为取数失败时的兜底）；若存在 _raw_sheet5.csv 则以其为准（自动化每日刷新走这条）。
OVERVIEW_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月"]
OVERVIEW_CALLS = [68434403, 66801684, 82433308, 92177760, 101083576, 139627253, 160105028]
OVERVIEW_PY = [180.5256722, 159.1423717, 173.9948696, 168.1608547, 186.1491044, 210.9060843, 278.76]
OVERVIEW_AGENTS = [304, 309, 347, 400, 451, 514, 556]

def _is_month_label(s):
    s = (s or "").strip()
    return len(s) >= 2 and s.endswith("月") and s[:-1].isdigit()

_over5 = os.path.join(BASE, "_raw_sheet5.csv")
if os.path.exists(_over5):
    try:
        rows5 = read_csv_rows(_over5)
        _parsed = []
        for r in rows5[1:]:
            if not r or len(r) < 4:
                continue
            m = (r[0] or "").strip()
            if not _is_month_label(m):
                continue
            c = fnum(r[1]); p = fnum(r[2]); a = fnum(r[3])
            if c is None and p is None and a is None:
                continue
            _parsed.append((m, c, p, a))
        if _parsed:
            _order = {f"{i}月": i for i in range(1, 13)}
            _parsed.sort(key=lambda x: _order.get(x[0], 99))
            OVERVIEW_MONTHS = [x[0] for x in _parsed]
            OVERVIEW_CALLS = [x[1] for x in _parsed]
            OVERVIEW_PY = [x[2] for x in _parsed]
            OVERVIEW_AGENTS = [x[3] for x in _parsed]
            print("  [sheet5] 使用 _raw_sheet5.csv 覆盖总览数据")
    except Exception as e:
        print("  [sheet5] CSV 解析失败，回退内嵌值:", e)

overview_monthly = [
    {"month": m, "calls": c, "personYear": round(p, 2), "activeAgents": a}
    for m, c, p, a in zip(OVERVIEW_MONTHS, OVERVIEW_CALLS, OVERVIEW_PY, OVERVIEW_AGENTS)
]
overview_kpis = {
    "totalCalls": sum(OVERVIEW_CALLS),
    "totalPersonYear": round(sum(OVERVIEW_PY), 2),
    "latestActiveAgents": OVERVIEW_AGENTS[-1],
    "avgCalls": round(sum(OVERVIEW_CALLS) / len(OVERVIEW_CALLS)),
    "peakMonth": OVERVIEW_MONTHS[max(range(len(OVERVIEW_CALLS)), key=lambda i: OVERVIEW_CALLS[i])],
    "peakCalls": max(OVERVIEW_CALLS),
    "yoyPersonYear": None,  # 真实文件无同比字段 -> /
}

# ---------- 2) agents (sheet4) ----------
agents = []
rows4 = read_csv_rows(os.path.join(BASE, "_raw_sheet4.csv"))
# 表头在 rows4[0]
hdr4 = rows4[0]
# 列索引：0 推广场景,1 省份,2 应用名称,3 创建时间,4 创建人,5 场景,6..13 各月,14 总计,15 备注
group_fill = ""
for r in rows4[1:]:
    if not r or len(r) < 15:
        continue
    name = (r[2] or "").strip()
    if name == "":
        continue
    grp = (r[0] or "").strip()
    if grp:
        group_fill = grp
    province = (r[1] or "").strip()
    created_at = (r[3] or "").strip()
    creator = (r[4] or "").strip()
    scenario = (r[5] or "").strip()
    # 类型（推广案例/优秀案例/双周优秀案例），col5「场景」可多标签，如"推广案例,优秀案例"
    KNOWN_TYPES = ["推广案例", "优秀案例", "双周优秀案例"]
    raw_types = [t.strip() for t in scenario.split(",") if t.strip()]
    types = [t for t in raw_types if t in KNOWN_TYPES] or raw_types
    monthly = [fnum(r[i]) if i < len(r) else None for i in range(6, 14)]  # 1-8月
    total = fnum(r[14]) if len(r) > 14 else None
    note = (r[15] or "").strip() if len(r) > 15 else ""
    agents.append({
        "group": group_fill,
        "province": province or None,
        "name": name,
        "createdAt": created_at or None,
        "creator": creator or None,
        "scenario": scenario or None,
        "types": types,
        "monthly": monthly,
        "total": total,
        "note": note or None,
    })
# 活跃智能体（真实文件无独立活跃字段）-> 用 total 非空的 agent 计数作为参考
active_agent_count = sum(1 for a in agents if (a["total"] or 0) > 0)

# ---------- 3) provinces (sheet6 + sheet7) ----------
# 保留月度拆分（monthlyCalls/monthlyActive 1-7月，monthlyTokens/monthlyCost 1-6月），
# 以便前端按「月维度」筛选时可在省份维度汇总所选月份。calls/tokens/cost 仍保留为全周期累计值。
provinces = {}
rows6 = read_csv_rows(os.path.join(BASE, "_raw_sheet6.csv"))
# 跳过前两行表头；数据从 index 2 开始
for r in rows6[2:]:
    if not r or len(r) < 3:
        continue
    prov = (r[0] or "").strip()
    if prov == "" or prov == "省份":
        continue
    # 调用量在奇数列(1,3,5,7,9,11,13)，活跃在偶数列(2,4,6,8,10,12,14)
    calls = [fnum(r[i]) for i in (1, 3, 5, 7, 9, 11, 13) if i < len(r)]
    acts = [fnum(r[i]) for i in (2, 4, 6, 8, 10, 12, 14) if i < len(r)]
    calls = [c for c in calls if c is not None]
    acts = [a for a in acts if a is not None]
    if not calls:
        continue
    provinces[prov] = {
        "province": prov,
        "monthlyCalls": calls,   # 1-7月 调用量
        "monthlyActive": acts,   # 1-7月 活跃智能体
        "monthlyTokens": None,   # 1-6月（来自 sheet7）
        "monthlyCost": None,     # 1-6月（来自 sheet7）
        "calls": sum(calls),
        "activeAgents": acts[-1] if acts else None,  # 取最新月(7月)活跃
        "tokens": None,
        "cost": None,
    }
rows7 = read_csv_rows(os.path.join(BASE, "_raw_sheet7.csv"))
for r in rows7[2:]:
    if not r or len(r) < 3:
        continue
    prov = (r[0] or "").strip()
    if prov == "" or prov == "省份名称":
        continue
    toks = [fnum(r[i]) for i in range(1, 7) if i < len(r)]
    costs = [fnum(r[i]) for i in range(7, 13) if i < len(r)]
    toks = [t for t in toks if t is not None]
    costs = [c for c in costs if c is not None]
    if prov not in provinces:
        provinces[prov] = {"province": prov, "monthlyCalls": None, "monthlyActive": None,
                           "monthlyTokens": None, "monthlyCost": None,
                           "calls": None, "activeAgents": None, "tokens": None, "cost": None}
    provinces[prov]["monthlyTokens"] = toks
    provinces[prov]["monthlyCost"] = costs
    provinces[prov]["tokens"] = sum(toks) if toks else None
    provinces[prov]["cost"] = round(sum(costs), 2) if costs else None
province_list = list(provinces.values())

# ---------- 3.5) overviewByProvince（支撑总览 11 张核心卡；文档仅有省份级 calls/active/tokens/cost）----------
# 说明：新 overview.js 的 11 指标中，「数据验证」文档在省份粒度仅提供
#   calls / activeAgents（sheet6）、tokens / cost（sheet7，1-6月）；
#   hotAgents 对应 sheet11「活跃智能体调用量（缺失）」为空；pageClicks/pageVisitors/activeUsers 属平台流量（跨文档）、
#   successRate/avgLatency 文档无来源 -> 一律 None，前端显「/」。
#   personYear 文档无分省值，按全国 personYear/calls 因子估算（已在注释标注）。
_pyf = None
_tot_c = sum(OVERVIEW_CALLS); _tot_py = sum(OVERVIEW_PY)
if _tot_c:
    _pyf = _tot_py / _tot_c

def _build_obp_prov(p):
    months = OVERVIEW_MONTHS
    mc = p.get("monthlyCalls") or []; ma = p.get("monthlyActive") or []
    mt = p.get("monthlyTokens") or []; mco = p.get("monthlyCost") or []
    recs = []
    for i, m in enumerate(months):
        calls = mc[i] if i < len(mc) else None
        recs.append({
            "month": m,
            "calls": calls,
            "activeAgents": ma[i] if i < len(ma) else None,
            "hotAgents": None,
            "tokens": mt[i] if i < len(mt) else None,
            "pageClicks": None,
            "pageVisitors": None,
            "activeUsers": None,
            "successRate": None,
            "avgLatency": None,
            "personYear": round(calls * _pyf, 2) if (calls is not None and _pyf) else None,
            "cost": mco[i] if i < len(mco) else None,
        })
    return recs

overviewByProvince = {}
for p in province_list:
    overviewByProvince[p["province"]] = _build_obp_prov(p)

# 全网：全国汇总（sheet5 提供 calls/personYear/activeAgents 真实；tokens/cost 由省份求和）
_n = len(OVERVIEW_MONTHS)
_net_tokens = [None] * _n
_net_cost = [None] * _n
for p in province_list:
    mt = p.get("monthlyTokens") or []; mco = p.get("monthlyCost") or []
    for i in range(min(len(mt), _n)):
        if mt[i] is not None: _net_tokens[i] = (_net_tokens[i] or 0) + mt[i]
    for i in range(min(len(mco), _n)):
        if mco[i] is not None: _net_cost[i] = (_net_cost[i] or 0) + mco[i]
_net_recs = []
for i, m in enumerate(OVERVIEW_MONTHS):
    _net_recs.append({
        "month": m,
        "calls": overview_monthly[i]["calls"],
        "activeAgents": overview_monthly[i]["activeAgents"],
        "hotAgents": None,
        "tokens": _net_tokens[i],
        "pageClicks": None,
        "pageVisitors": None,
        "activeUsers": None,
        "successRate": None,
        "avgLatency": None,
        "personYear": overview_monthly[i]["personYear"],
        "cost": _net_cost[i],
    })
overviewByProvince["全网"] = _net_recs
print(f"  [overviewByProvince] 已生成 {len(overviewByProvince)} 个主体（含 全网）；真实字段 calls/activeAgents/tokens/cost，personYear 估算，其余 6 项文档缺失→/")

# ---------- 4) platform tracking (平台分析 doc, 多周 3-block) ----------
# 数据源：金山文档「平台分析」(atbL8BymF1MWRdUn3wue1xkekdEskSQYj)
#   每张周表 3 个并排 metric block：点击量(province,NAME,PAGE,COUNT) / 访客(province,PAGE,count) / 曝光(province,NAME,PAGE,COUNT)
#   自动化每日刷新会写入 _raw_platform_<label>.csv（13 周）；本地当前以 _raw_sheet9.csv（0720-0726 单周）兜底。
def parse_platform_csv(path):
    """解析一张周表 CSV，返回 7 个字典：(点击/访客/曝光 的 页面维度, 省份维度) + 省份×模块点击量。"""
    rows = read_csv_rows(path)
    cp, vp, ep = {}, {}, {}
    cpro, vpro, epro = {}, {}, {}
    cpro_page = {}  # {page: {province: clicks}}  用于省份×三级模块交叉
    cpro_mod = {}  # {module: {province: clicks}}  用于省份×模块交叉与灵犀省份渗透
    for r in rows[2:]:
        if not r or len(r) < 13:
            continue
        # 点击量 block: col0 province, col2 PAGE, col3 COUNT
        pa = (r[2] or "").strip()
        if pa:
            cp[pa] = cp.get(pa, 0) + (fnum(r[3]) or 0)
            pra = (r[0] or "").strip()
            if pra:
                cpro[pra] = cpro.get(pra, 0) + (fnum(r[3]) or 0)
                m = module_of(pa)
                cpro_mod.setdefault(m, {})
                cpro_mod[m][pra] = cpro_mod[m].get(pra, 0) + (fnum(r[3]) or 0)
                cpro_page.setdefault(pa, {})
                cpro_page[pa][pra] = cpro_page[pa].get(pra, 0) + (fnum(r[3]) or 0)
        # 访客 block: col5 province, col6 PAGE, col7 count
        pb = (r[6] or "").strip()
        if pb:
            vp[pb] = vp.get(pb, 0) + (fnum(r[7]) or 0)
            prb = (r[5] or "").strip()
            if prb: vpro[prb] = vpro.get(prb, 0) + (fnum(r[7]) or 0)
        # 曝光 block: col9 province, col11 PAGE, col12 COUNT
        pc = (r[11] or "").strip()
        if pc:
            ep[pc] = ep.get(pc, 0) + (fnum(r[12]) or 0)
            prc = (r[9] or "").strip()
            if prc: epro[prc] = epro.get(prc, 0) + (fnum(r[12]) or 0)
    return cp, vp, ep, cpro, vpro, epro, cpro_mod, cpro_page

def module_of(page):
    """页面名首个 '-' 段 = 一级菜单（模块），用于菜单结构与流量分布分析。"""
    return (page.split("-")[0].strip() if page else "其他")

# ---------- 平台分析-月 · 一级模块 taxonomy（用户定义 6 个） ----------
L1_MODULES = ["个人探索", "APP灵犀", "智能应用工厂", "AI能力工厂", "运营配置", "系统管理"]
# 原始页面名首段 → 6 个一级模块映射（样本数据首段为 智能体*，真实数据首段应已是 6 模块）。
MODULE_MAP = {
    "个人探索": "个人探索",
    "APP灵犀": "APP灵犀",
    "智能应用工厂": "智能应用工厂",
    "AI能力工厂": "AI能力工厂",
    "智能体调优": "智能应用工厂",   # 智能体调优/构建 = 智能应用工厂（构建/调优智能体）
    "智能体构建": "智能应用工厂",
    "智能体应用": "APP灵犀",        # 智能体应用 = APP（应用侧）
    "智能体运营": "运营配置",        # 智能体运营 = 运营配置
}
def l1_of(page):
    """将任意页面名映射到 6 个一级模块之一（永不直接出现 智能体* 等非定义模块）。"""
    if not page:
        return "智能应用工厂"
    seg = page.split("-")[0].strip()
    if seg in L1_MODULES:
        return seg
    if seg in MODULE_MAP:
        return MODULE_MAP[seg]
    # 兜底关键字（极少触发）：保证只归入 6 模块
    if "灵犀" in page: return "APP灵犀"
    if "运营" in page or "配置" in page: return "运营配置"
    if "系统" in page or "管理" in page: return "系统管理"
    return "智能应用工厂"

def _ctr(c, e):
    return round(c / e * 100, 2) if e else None

import glob as _glob
_platform_csvs = sorted(_glob.glob(os.path.join(BASE, "_raw_platform_*.csv")))
if _platform_csvs:
    _week_defs = [(os.path.basename(p).replace("_raw_platform_", "").replace(".csv", ""), p) for p in _platform_csvs]
    print(f"  [platform] 检测到 {len(_week_defs)} 个周表 CSV（平台分析·多周）")
else:
    _week_defs = [("0720-0726", os.path.join(BASE, "_raw_sheet9.csv"))]
    print("  [platform] 未检测到 _raw_platform_*.csv，回退 _raw_sheet9.csv（0720-0726 单周）")

def week_to_month(label):
    # "0522-0524" -> "2026-05"
    return "2026-" + label[:2]

# 逐周明细 + 全周期累计
page_by_week, prov_by_week, mod_by_week, prov_page_by_week = {}, {}, {}, {}
prov_module_by_week = {}
agg_cp, agg_vp, agg_ep = {}, {}, {}
agg_cpro, agg_vpro, agg_epro = {}, {}, {}
agg_cm = {}
agg_pm = {}  # {module: {province: clicks}}
weekly_labels, weekly_clicks, weekly_visitors, weekly_exposures = [], [], [], []
week_month, months_set = {}, []
for _label, _path in _week_defs:
    if not os.path.exists(_path):
        continue
    _cp, _vp, _ep, _cpro, _vpro, _epro, _pm, _cpro_page = parse_platform_csv(_path)
    # 逐周·页面
    _pg = {}
    for k, v in _cp.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["clicks"] += v
    for k, v in _vp.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["visitors"] += v
    for k, v in _ep.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["exposures"] += v
    page_by_week[_label] = _pg
    # 逐周·省份
    _pr = {}
    for k, v in _cpro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["clicks"] += v
    for k, v in _vpro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["visitors"] += v
    for k, v in _epro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["exposures"] += v
    prov_by_week[_label] = _pr
    # 逐周·省份×模块
    prov_module_by_week[_label] = _pm
    prov_page_by_week[_label] = _cpro_page
    for m, d in _pm.items():
        if m not in agg_pm: agg_pm[m] = {}
        for prv, v in d.items(): agg_pm[m][prv] = agg_pm[m].get(prv, 0) + v
    # 逐周·模块
    _md = {}
    for k, d in _pg.items():
        m = module_of(k)
        _md.setdefault(m, {"clicks": 0, "visitors": 0, "exposures": 0})
        _md[m]["clicks"] += d["clicks"]; _md[m]["visitors"] += d["visitors"]; _md[m]["exposures"] += d["exposures"]
    mod_by_week[_label] = _md
    # 全周期累计
    for k, v in _cp.items(): agg_cp[k] = agg_cp.get(k, 0) + v
    for k, v in _vp.items(): agg_vp[k] = agg_vp.get(k, 0) + v
    for k, v in _ep.items(): agg_ep[k] = agg_ep.get(k, 0) + v
    for k, v in _cpro.items(): agg_cpro[k] = agg_cpro.get(k, 0) + v
    for k, v in _vpro.items(): agg_vpro[k] = agg_vpro.get(k, 0) + v
    for k, v in _epro.items(): agg_epro[k] = agg_epro.get(k, 0) + v
    for k, d in _md.items():
        agg_cm.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})
        agg_cm[k]["clicks"] += d["clicks"]; agg_cm[k]["visitors"] += d["visitors"]; agg_cm[k]["exposures"] += d["exposures"]
    wk_c = int(sum(_cp.values())); wk_v = int(sum(_vp.values())); wk_e = int(sum(_ep.values()))
    weekly_labels.append(_label); weekly_clicks.append(wk_c); weekly_visitors.append(wk_v); weekly_exposures.append(wk_e)
    _m = week_to_month(_label); week_month[_label] = _m
    if _m not in months_set: months_set.append(_m)

# 周/月按时间排序（周标签 MMDD 自然序；月 2026-MM 自然序）
weekly_labels_sorted = sorted(weekly_labels)
def _realign(d): return {w: d.get(w, {}) for w in weekly_labels_sorted}
page_by_week = _realign(page_by_week)
prov_by_week = _realign(prov_by_week)
mod_by_week = _realign(mod_by_week)
week_month = {w: week_month[w] for w in weekly_labels_sorted}
months_sorted = sorted(months_set)
_idx = [weekly_labels.index(w) for w in weekly_labels_sorted]
weekly_clicks = [weekly_clicks[i] for i in _idx]
weekly_visitors = [weekly_visitors[i] for i in _idx]
weekly_exposures = [weekly_exposures[i] for i in _idx]

# 省份 × 三级模块（页面名按 '-' 取前 3 段），供平台分析「省份×模块交叉」细化到三级目录
prov_module_l3_by_week = {}
for _label in weekly_labels_sorted:
    _pgmap = prov_page_by_week.get(_label, {})
    _l3 = {}
    for _page, _pmap in _pgmap.items():
        _k = "-".join(_page.split("-")[:3])
        if _k not in _l3: _l3[_k] = {}
        for _pr, _c in _pmap.items():
            _l3[_k][_pr] = _l3[_k].get(_pr, 0) + _c
    prov_module_l3_by_week[_label] = _l3

# 页面维度（全周期；兼容旧 tracking 扁平结构）
all_pages = set(agg_cp) | set(agg_vp) | set(agg_ep)
tracking = []
for p in all_pages:
    c = int(agg_cp.get(p, 0)); v = int(agg_vp.get(p, 0)); e = int(agg_ep.get(p, 0))
    tracking.append({"page": p, "clicks": c, "visitors": v, "exposures": e, "ctr": _ctr(c, e)})
tracking.sort(key=lambda x: x["clicks"], reverse=True)

# 省份维度
all_provs = set(agg_cpro) | set(agg_vpro) | set(agg_epro)
province_totals = []
for p in all_provs:
    c = int(agg_cpro.get(p, 0)); v = int(agg_vpro.get(p, 0)); e = int(agg_epro.get(p, 0))
    province_totals.append({"province": p, "clicks": c, "visitors": v, "exposures": e, "ctr": _ctr(c, e)})
province_totals.sort(key=lambda x: x["clicks"], reverse=True)

# 模块维度（全周期）
module_totals = [{"module": m, "clicks": int(d["clicks"]), "visitors": int(d["visitors"]), "exposures": int(d["exposures"]), "ctr": _ctr(d["clicks"], d["exposures"])} for m, d in agg_cm.items()]
module_totals.sort(key=lambda x: x["clicks"], reverse=True)

platform_tracking = {
    "source": "金山文档·平台分析（在线·周度埋点）",
    "fileUrl": "https://www.kdocs.cn/l/chnCnULrXTy3",
    "weeks": weekly_labels_sorted,
    "weekMonth": week_month,
    "months": months_sorted,
    "weekly": {"labels": weekly_labels_sorted, "clicks": weekly_clicks, "visitors": weekly_visitors, "exposures": weekly_exposures},
    "pageTotals": tracking,
    "provinceTotals": province_totals,
    "moduleTotals": module_totals,
    "pageByWeek": page_by_week,
    "provinceByWeek": prov_by_week,
    "provModuleByWeek": prov_module_by_week,
    "moduleByWeek": mod_by_week,
    "provModuleL3ByWeek": prov_module_l3_by_week,
}

# ---------- 4b) platformMonthly (平台分析-月 · 用户级埋点) ----------
# 数据源：金山文档「平台分析-月」(file_id=e9WB6rKPh1MuxmekMsGdrxBn4VZNyGuTY, link=https://www.kdocs.cn/l/cv4JlshDWcju)
# 每月一个 sheet（5/6/7/8 月），3 个并排 block：点击量/访客人数/曝光次数；点击量&曝光次数含 NAME（省份-姓名=用户唯一 ID）。
# 取数：kdocs get_range_data -> dump_month_full.py -> _raw_month_<mm>.csv（列：block,province,name,page,count）。
# 用户级去重：MAU = 各月 (province+NAME) 去重集合大小；月新增 = 本月 - 此前所有月并集；月留存 = 上月∩本月 / 上月。
def parse_month_csv(path):
    """解析 _raw_month_<mm>.csv（列：block,province,name,page,count）。
    block ∈ {click, visitor, exposure}；name 仅 click/exposure block 含（用于用户级去重）。
    返回 (cp, vp, ep, cpro, vpro, epro, cpro_mod, user_keys, page_users, user_clicks, user_exposures)：
      页面级计数、省份级计数、省份×模块点击量、用户级去重键集合、页面→用户键集合、
      每用户点击量累计、每用户曝光次数累计（供用户活跃度分层 / 留存用户活跃度）。"""
    rows = read_csv_rows(path)
    cp, vp, ep = {}, {}, {}
    cpro, vpro, epro = {}, {}, {}
    cpro_mod = {}  # {module: {province: clicks}}
    user_keys = set()
    page_users = {}  # {page: set("prov-name")}
    user_clicks = {}    # {userKey: 点击量累计}
    user_exposures = {} # {userKey: 曝光次数累计}
    user_page_clicks = {} # {userKey: {page: 点击量}} 供「互斥功能页构成」与「人均到达功能页数」
    user_page_exp = {}    # {userKey: {page: 曝光次数}}
    for r in rows[1:]:
        if not r or len(r) < 5:
            continue
        block = (r[0] or "").strip()
        prov = (r[1] or "").strip()
        name = (r[2] or "").strip()
        page = (r[3] or "").strip()
        cnt = fnum(r[4]) or 0
        if not page:
            continue
        if block == "click":
            cp[page] = cp.get(page, 0) + cnt
            if prov:
                cpro[prov] = cpro.get(prov, 0) + cnt
                m = module_of(page)
                cpro_mod.setdefault(m, {})
                cpro_mod[m][prov] = cpro_mod[m].get(prov, 0) + cnt
            if name:
                k = prov + "-" + name
                user_keys.add(k)
                page_users.setdefault(page, set()).add(k)
                user_clicks[k] = user_clicks.get(k, 0) + cnt
                user_page_clicks.setdefault(k, {})
                user_page_clicks[k][page] = user_page_clicks[k].get(page, 0) + cnt
        elif block == "visitor":
            vp[page] = vp.get(page, 0) + cnt
            if prov: vpro[prov] = vpro.get(prov, 0) + cnt
        elif block == "exposure":
            ep[page] = ep.get(page, 0) + cnt
            if prov: epro[prov] = epro.get(prov, 0) + cnt
            if name:
                k = prov + "-" + name
                user_keys.add(k)
                page_users.setdefault(page, set()).add(k)
                user_exposures[k] = user_exposures.get(k, 0) + cnt
                user_page_exp.setdefault(k, {})
                user_page_exp[k][page] = user_page_exp[k].get(page, 0) + cnt
    return cp, vp, ep, cpro, vpro, epro, cpro_mod, user_keys, page_users, user_clicks, user_exposures, user_page_clicks, user_page_exp

MONTH_ORDER = [("2026-05", "05"), ("2026-06", "06"), ("2026-07", "07"), ("2026-08", "08")]

def _month_csv(mm):
    """优先真实全量 _raw_month_<mm>.csv；否则回退样本 _raw_month_<mm>_sample.csv。"""
    canon = os.path.join(BASE, "_raw_month_%s.csv" % mm)
    sample = os.path.join(BASE, "_raw_month_%s_sample.csv" % mm)
    if os.path.exists(canon): return canon, False
    if os.path.exists(sample): return sample, True
    return None, False

_month_defs = []
for _m, _mm in MONTH_ORDER:
    _p, _is_s = _month_csv(_mm)
    if _p: _month_defs.append((_m, _p, _is_s))

platform_monthly = None
if _month_defs:
    _months = []
    _page_by_month, _module_by_month, _province_by_month, _province_module_by_month = {}, {}, {}, {}
    _module_l2_by_month, _module_l3_by_month = {}, {}
    _user_keys_by_month = {}
    _totals_by_month, _conv_rate = {}, {}
    _mau_by_month, _new_by_month, _ret_by_month = {}, {}, {}
    _prov_user_by_month, _prov_new_by_month = {}, {}
    _new_mod_by_month, _new_user_keys_by_month = {}, {}
    _user_agg_by_month, _user_l1_by_month, _user_l3_by_month = {}, {}, {}
    _new_l3_by_month, _page_prov_by_month = {}, {}
    _mau_comp_l3_by_month, _avg_pages_by_month = {}, {}
    _prev_m = None
    for _m, _path, _is_s in _month_defs:
        _cp, _vp, _ep, _cpro, _vpro, _epro, _cpro_mod, _uk, _pu, _uclk, _uexp, _upc, _upe = parse_month_csv(_path)
        # 页面维度
        _pg = {}
        for k, v in _cp.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["clicks"] += v
        for k, v in _vp.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["visitors"] += v
        for k, v in _ep.items(): _pg.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["exposures"] += v
        _page_by_month[_m] = _pg
        # 模块维度：一级（映射 6 模块）→ 二级（页面名第 2 段）→ 三级（页面名第 3 段）
        _md, _md2, _md3 = {}, {}, {}
        for k, d in _pg.items():
            _l1 = l1_of(k)
            _segs = k.split("-")
            _l2 = _segs[1].strip() if len(_segs) > 1 else "(根)"
            _l3 = _segs[2].strip() if len(_segs) > 2 else _l2
            # L1
            _md.setdefault(_l1, {"clicks": 0, "visitors": 0, "exposures": 0})
            _md[_l1]["clicks"] += d["clicks"]; _md[_l1]["visitors"] += d["visitors"]; _md[_l1]["exposures"] += d["exposures"]
            # L2
            _md2.setdefault(_l1, {}).setdefault(_l2, {"clicks": 0, "visitors": 0, "exposures": 0})
            _md2[_l1][_l2]["clicks"] += d["clicks"]; _md2[_l1][_l2]["visitors"] += d["visitors"]; _md2[_l1][_l2]["exposures"] += d["exposures"]
            # L3
            _md3.setdefault(_l1, {}).setdefault(_l2, {}).setdefault(_l3, {"clicks": 0, "visitors": 0, "exposures": 0})
            _md3[_l1][_l2][_l3]["clicks"] += d["clicks"]; _md3[_l1][_l2][_l3]["visitors"] += d["visitors"]; _md3[_l1][_l2][_l3]["exposures"] += d["exposures"]
        _module_by_month[_m] = _md
        _module_l2_by_month[_m] = _md2
        _module_l3_by_month[_m] = _md3
        # 省份维度
        _pr = {}
        for k, v in _cpro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["clicks"] += v
        for k, v in _vpro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["visitors"] += v
        for k, v in _epro.items(): _pr.setdefault(k, {"clicks": 0, "visitors": 0, "exposures": 0})["exposures"] += v
        _province_by_month[_m] = _pr
        _province_module_by_month[_m] = _cpro_mod
        # 汇总 + 转化率（页面级真实：Σ点击 ÷ Σ曝光）
        _clk = int(sum(_cp.values())); _vis = int(sum(_vp.values())); _exp = int(sum(_ep.values()))
        _totals_by_month[_m] = {"clicks": _clk, "visitors": _vis, "exposures": _exp}
        _conv_rate[_m] = round(_clk / _exp * 100, 2) if _exp else None
        # 用户级去重
        _u = set(_uk)
        _mau_by_month[_m] = len(_u)
        _user_keys_by_month[_m] = sorted(_u)
        # 用户级活跃度（per-user clicks/exposures —— 供用户活跃度分层 / 留存用户活跃度）
        _ua = {}
        for _k in _u:
            _ua[_k] = {"clicks": _uclk.get(_k, 0), "exposures": _uexp.get(_k, 0)}
        _user_agg_by_month[_m] = _ua
        # 用户级功能页归属：互斥构成（每用户归到 activity 最高的页面）+ 人均到达功能页数
        _comp_l3 = {}
        _ppc = {}
        for _k in _u:
            _pc = _upc.get(_k, {})
            _pe = _upe.get(_k, {})
            _act = {}
            for _pg, _v in _pc.items(): _act[_pg] = _act.get(_pg, 0) + _v
            for _pg, _v in _pe.items(): _act[_pg] = _act.get(_pg, 0) + _v
            _ppc[_k] = len(_act)
            if _act:
                _top = max(_act.items(), key=lambda kv: kv[1])[0]
                _comp_l3[_top] = _comp_l3.get(_top, 0) + 1
        _mau_comp_l3_by_month[_m] = _comp_l3
        _avg_pages_by_month[_m] = round(sum(_ppc.values()) / len(_u), 2) if _u else 0
        # 活跃用户模块分布（L1/L3，按去重用户数）—— 供 MAU 下钻「活跃用户使用的一级/三级模块分布」
        _ul1 = {}; _ul3 = {}
        for _pg, _us in _pu.items():
            _l1 = l1_of(_pg)
            _segs = _pg.split("-")
            _l2 = _segs[1].strip() if len(_segs) > 1 else "(根)"
            _l3 = _segs[2].strip() if len(_segs) > 2 else _l2
            for _k in _us:
                _ul1.setdefault(_l1, set()).add(_k)
                _ul3.setdefault(_l3, set()).add(_k)
        _user_l1_by_month[_m] = {_k: len(_v) for _k, _v in _ul1.items()}
        _user_l3_by_month[_m] = {_k: len(_v) for _k, _v in _ul3.items()}
        # 页面×省份 活跃用户分布 —— 供活跃页面下钻「部门/省份 各页活跃用户分布」
        _ppv = {}
        for _pg, _us in _pu.items():
            _d = {}
            for _k in _us:
                _p = _k.split("-", 1)[0]
                _d[_p] = _d.get(_p, 0) + 1
            if _d: _ppv[_pg] = _d
        _page_prov_by_month[_m] = _ppv
        # 各省份 MAU 排名（用户键前缀=省份）
        _pu_rank = {}
        for _k in _u:
            _p = _k.split("-", 1)[0]
            _pu_rank[_p] = _pu_rank.get(_p, 0) + 1
        _prov_user_by_month[_m] = _pu_rank
        if _prev_m is None:
            _new_by_month[_m] = None   # 基线月不报新增
            _ret_by_month[_m] = None
            _prov_new_by_month[_m] = {}
            _new_mod_by_month[_m] = {}
            _new_user_keys_by_month[_m] = []
        else:
            _prev_u = set(_user_keys_by_month[_prev_m])
            _new_u = _u - _prev_u
            _new_by_month[_m] = len(_new_u)
            _ret_by_month[_m] = round(len(_u & _prev_u) / len(_prev_u) * 100, 2) if _prev_u else None
            # 新增用户：省份归属 + 使用模块(L1/L3)归属（每新增用户按去重模块计数一次）
            _pnew = {}
            _nmod = {}
            _nl3c = {}
            _ul1 = {}  # 新增用户 -> 去重 L1 模块集合
            for _pg, _us in _pu.items():
                _inter = _us & _new_u
                if not _inter:
                    continue
                _l1 = l1_of(_pg)
                _segs = _pg.split("-")
                _l2 = _segs[1].strip() if len(_segs) > 1 else "(根)"
                _l3 = _segs[2].strip() if len(_segs) > 2 else _l2
                for _k in _inter:
                    _ul1.setdefault(_k, set()).add(_l1)
                    _nl3c[_l3] = _nl3c.get(_l3, 0) + 1
            for _k, _lset in _ul1.items():
                _p = _k.split("-", 1)[0]
                _pnew[_p] = _pnew.get(_p, 0) + 1
                for _l1 in _lset:
                    _nmod[_l1] = _nmod.get(_l1, 0) + 1
            _prov_new_by_month[_m] = _pnew
            _new_mod_by_month[_m] = _nmod
            _new_l3_by_month[_m] = _nl3c
            _new_user_keys_by_month[_m] = sorted(_new_u)
        _prev_m = _m
        _months.append(_m)
    _is_sample = any(d[2] for d in _month_defs)
    platform_monthly = {
        "source": "金山文档·平台分析-月（在线·用户级埋点）",
        "fileUrl": "https://www.kdocs.cn/l/cv4JlshDWcju",
        "isSample": _is_sample,
        "months": _months,
        "monthsLabel": [m.replace("2026-", "") + "月" for m in _months],
        "totalsByMonth": _totals_by_month,
        "convRate": _conv_rate,
        "mauByMonth": _mau_by_month,
        "newByMonth": _new_by_month,
        "retByMonth": _ret_by_month,
        "userKeysByMonth": _user_keys_by_month,
        "provUserByMonth": _prov_user_by_month,
        "provNewByMonth": _prov_new_by_month,
        "newUserModuleByMonth": _new_mod_by_month,
        "newUserKeysByMonth": _new_user_keys_by_month,
        "userAggByMonth": _user_agg_by_month,
        "userL1ByMonth": _user_l1_by_month,
        "userL3ByMonth": _user_l3_by_month,
        "newUserL3ByMonth": _new_l3_by_month,
        "pageProvUsersByMonth": _page_prov_by_month,
        "mauCompL3ByMonth": _mau_comp_l3_by_month,
        "avgPagesByMonth": _avg_pages_by_month,
        "pageByMonth": _page_by_month,
        "moduleByMonth": _module_by_month,
        "moduleL2ByMonth": _module_l2_by_month,
        "moduleL3ByMonth": _module_l3_by_month,
        "provinceByMonth": _province_by_month,
        "provinceModuleByMonth": _province_module_by_month,
    }
    print(f"  [platformMonthly] {len(_months)} 个月；MAU={_mau_by_month}；来源={'样本(非真实全量)' if _is_sample else '真实全量'}")

# ---------- 5) capability (sheet8) ----------
# 默认值（内嵌真实数值，兜底）；若存在 _raw_sheet8.csv 则以其为准（自动化每日刷新走这条）。
CAP_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月"]
CAP = {
    "灵运平台": [0, 0, 0, 179.21, 107.15, 116.07, 278.76],
    "RPA": [100.04, 89.55, 88.33, 96.86, 101.22, 99.68, 102.95],
    "教练": [22.36, 13.9, 29.24, 24.91, 22.61, 28.19, 32.55],
    "质检": [81.12, 54.93, 81.84, 82.06, 84.79, 82.95, 84.68],
    "立单": [9.526, 9.209, 11.125, 11.323, 11.453, 11.661, 11.716],
    "语音": [607.53, 677.11, 734.34, 777.39, 757.6, 741.32, 682.36],
}
# 4项总计（独立序列，来自文件列）
CAP_TOTAL4 = [811.05, 835.49, 933.75, 981.22, 966.22, 952.14, 902.54]

_over8 = os.path.join(BASE, "_raw_sheet8.csv")
if os.path.exists(_over8):
    try:
        rows8 = read_csv_rows(_over8)
        _caprows = {}
        for r in rows8[1:]:
            if not r or len(r) < 8:
                continue
            m = (r[0] or "").strip()
            if not _is_month_label(m):
                continue
            vals = [fnum(r[i]) for i in (1, 2, 3, 4, 5, 6, 7)]
            if all(v is None for v in vals):
                continue
            _caprows[m] = vals
        if _caprows:
            _order = {f"{i}月": i for i in range(1, 13)}
            _ms = [m for m in sorted(_caprows.keys(), key=lambda x: _order.get(x, 99)) if _order.get(m, 99) <= 7]
            if _ms:
                _names = ["灵运平台", "RPA", "教练", "质检", "立单", "语音"]
                CAP = {n: [] for n in _names}
                CAP_TOTAL4 = []
                for m in _ms:
                    v = _caprows[m]
                    for i, n in enumerate(_names):
                        CAP[n].append(v[i])
                    CAP_TOTAL4.append(v[6])
                CAP_MONTHS = _ms
                print("  [sheet8] 使用 _raw_sheet8.csv 覆盖能力数据")
    except Exception as e:
        print("  [sheet8] CSV 解析失败，回退内嵌值:", e)

capability_monthly = []
for i, m in enumerate(CAP_MONTHS):
    row = {"month": m}
    for k, v in CAP.items():
        row[k] = round(v[i], 2)
    row["四项总计"] = CAP_TOTAL4[i]
    capability_monthly.append(row)
capability_yearly = {k: round(sum(v), 2) for k, v in CAP.items()}
capability_yearly["四项总计"] = round(sum(CAP_TOTAL4), 2)

# ---------- 6) 分中心等效人年排名（sheet12 2025 / sheet13 2026，支持月份+省份+分项筛选）----------
center_year_rank = None
try:
    rows25 = read_csv_rows(os.path.join(BASE, "_raw_center_2025.csv"))
    rows26 = read_csv_rows(os.path.join(BASE, "_raw_center_2026.csv"))
    # 能力字段映射：key, 显示名, 2025列号, 2026列号
    CENTER_ABILITIES = [
        {"key": "voice", "name": "智能语音客服", "col2025": 4, "col2026": 4},
        {"key": "rpa", "name": "RPA", "col2025": 5, "col2026": 5},
        {"key": "select", "name": "智能点选", "col2025": 6, "col2026": None},
        {"key": "qa", "name": "智能质检", "col2025": 7, "col2026": 6},
        {"key": "coach", "name": "智能教练", "col2025": 8, "col2026": 7},
    ]
    # 可比同期区间 = 两年最新月的较小值（确保同年同月对齐对比）
    def _months_of(rows, prefix):
        return sorted({(r[0] or "").strip() for r in rows[1:] if r and r[0] and (r[0] or "").strip().startswith(prefix)})
    months25_all = _months_of(rows25, "2025")
    months26_all = _months_of(rows26, "2026")
    end25 = int(months25_all[-1][4:6]) if months25_all else 7
    end26 = int(months26_all[-1][4:6]) if months26_all else 7
    end_month = min(end25, end26)
    months = list(range(1, end_month + 1))
    months2025 = [f"2025{m:02d}" for m in months]
    months2026 = [f"2026{m:02d}" for m in months]
    period_label = f"1-{end_month}月"

    def _agg_entity(rows, year_prefix, month_list):
        """按主体聚合：每个能力在所选月份内的逐月数组 + 原始合计逐月数组。"""
        result = {}
        for r in rows[1:]:
            if not r or len(r) < 4:
                continue
            month = (r[0] or "").strip()
            prov = (r[2] or "").strip()
            if not prov or prov == "其他" or month not in month_list:
                continue
            mi = month_list.index(month)
            if prov not in result:
                result[prov] = {
                    "province": prov,
                    "code": (r[1] or "").strip(),
                    "ability": {ab["key"]: [0.0] * len(month_list) for ab in CENTER_ABILITIES},
                    "total": [0.0] * len(month_list),
                }
            try:
                result[prov]["total"][mi] += float(r[3] or 0)
            except Exception:
                pass
            for ab in CENTER_ABILITIES:
                col = ab["col2025"] if year_prefix == "2025" else ab["col2026"]
                if col is None or col >= len(r):
                    continue
                try:
                    result[prov]["ability"][ab["key"]][mi] += float(r[col] or 0)
                except Exception:
                    pass
        return result

    agg25 = _agg_entity(rows25, "2025", months2025)
    agg26 = _agg_entity(rows26, "2026", months2026)

    def _to_entity(prov, a25, a26):
        return {
            "province": prov,
            "code": (a26 or {}).get("code") or (a25 or {}).get("code") or "",
            "type": "national" if prov == "全国" else ("hq" if prov == "本部" else "center"),
            "ability2025": {ab["key"]: (a25["ability"][ab["key"]] if a25 else [0.0] * len(months)) for ab in CENTER_ABILITIES},
            "ability2026": {ab["key"]: (a26["ability"][ab["key"]] if a26 else [0.0] * len(months)) for ab in CENTER_ABILITIES},
            "total2025": (a25["total"] if a25 else [0.0] * len(months)),
            "total2026": (a26["total"] if a26 else [0.0] * len(months)),
        }

    entities = []
    for prov in sorted(set(agg25) | set(agg26)):
        entities.append(_to_entity(prov, agg25.get(prov), agg26.get(prov)))

    center_year_rank = {
        "periodLabel": period_label,
        "endMonth": end_month,
        "months": months,
        "months2025": months2025,
        "months2026": months2026,
        "abilities": [{"key": ab["key"], "name": ab["name"], "in2025": ab["col2025"] is not None, "in2026": ab["col2026"] is not None} for ab in CENTER_ABILITIES],
        "entities": entities,
    }
    print(f"  [center rank] 已生成 {len(entities)} 个主体（含 本部/全国），可比同期区间 {period_label}，逐月分项已就绪")
except Exception as e:
    print("  [center rank] 解析失败:", e)

# ---------- 7) alerts (真实文件无) ----------
alerts = []
gaps = [
    "告警明细：金山文档「数据验证」未包含告警/异动数据，告警 Tab 以「/」显示。",
    "智能体活跃度：真实文件仅有等效人年，无独立「活跃/健康分」字段，相关维度以「/」显示。",
    "同比/环比：文件无去年同期数据，部分增长率以「/」显示。",
]

# ---------- 7.5) 智能体页 / 数据总览页 数据域（来自 v2 xlsx）----------
# 重要：这两个域若缺失，智能体页与数据总览页会整页空白。
# 上面 3.5 节的 overviewByProvince 只含 calls/activeAgents/tokens/cost，其余字段为 None（页面显示"/"），
# 且本脚本不产出 agentMonthly。因此每次构建都必须用 gen_agents_overview.py 的产出覆盖，
# 否则每日自动刷新会把智能体数据冲掉、把总览数据换回残缺版。
# 重新生成：python build/gen_agents_overview.py
agentMonthly = []
LY_OVERVIEW_PANORAMA = {}
_ao_path = os.path.join(BASE, "build", "sources", "agents_overview.json")
try:
    with open(_ao_path, "r", encoding="utf-8") as _f:
        _ao = json.load(_f)
    agentMonthly = _ao.get("agentMonthly") or []
    if _ao.get("overviewByProvince"):
        overviewByProvince = _ao["overviewByProvince"]  # 覆盖残缺版
    LY_OVERVIEW_PANORAMA = _ao.get("LY_OVERVIEW_PANORAMA") or {}
    print(f"  [v2 domains] agentMonthly={len(agentMonthly)} 条；"
          f"overviewByProvince={len(overviewByProvince)} 个区域；"
          f"PANORAMA rows={len(LY_OVERVIEW_PANORAMA.get('rows', []))}")
except Exception as _e:
    print("  [v2 domains] 未合并（文件缺失或解析失败）:", _e)

# ---------- 7.6) qeMonthlySummary（质效分析·数据月度汇总，含灵运平台 / 智能立单）----------
# 数据源：金山文档「质效分析」sheet3「数据月度汇总」
#   file_id=P8sxhdnzw9MW7M5z5TemxxWJcX2dTNF1D   worksheet_id=5
# 落盘：build/sources/_raw_qe_monthly.csv（由 kdocs 取数后写入）
# 口径说明：
#   - 本表「智能语音」列与 centerYearRank 全国的 voice2026 完全一致，属同一口径的全国月度汇总；
#   - 灵运平台 1—3 月为 0（4 月起量）；
#   - 灵运平台、智能立单无 2025 年基线，其同比在页面显示「/」。
qe_monthly_summary = {}
try:
    _qe_rows = read_csv_rows(os.path.join(BASE, "build", "sources", "_raw_qe_monthly.csv"))
    # 列位：0月份 1灵运平台 2RPA 3智能教练 4智能质检 5智能立单 6智能语音 7四项总计 8月累计
    _QE_ABILITIES = [
        {"key": "platform", "name": "灵运平台", "col": 1, "has2025": False},
        {"key": "rpa", "name": "RPA", "col": 2, "has2025": True},
        {"key": "coach", "name": "智能教练", "col": 3, "has2025": True},
        {"key": "qa", "name": "智能质检", "col": 4, "has2025": True},
        {"key": "order", "name": "智能立单", "col": 5, "has2025": False},
        {"key": "voice", "name": "智能语音", "col": 6, "has2025": True},
    ]

    def _qf(v):
        try:
            return round(float(v), 4)
        except Exception:
            return None

    _months, _year_row = [], None
    _vals = {a["key"]: [] for a in _QE_ABILITIES}
    _tot4, _cum = [], []
    for r in _qe_rows[1:]:
        if not r or not r[0].strip():
            continue
        m = r[0].strip()
        if m == "2026年":
            _year_row = r
            continue
        if not m.endswith("月"):
            continue
        _months.append(m)
        for a in _QE_ABILITIES:
            _vals[a["key"]].append(_qf(r[a["col"]]) if a["col"] < len(r) else None)
        _tot4.append(_qf(r[7]) if len(r) > 7 else None)
        _cum.append(_qf(r[8]) if len(r) > 8 else None)

    _year_total = {}
    if _year_row:
        for a in _QE_ABILITIES:
            _year_total[a["key"]] = _qf(_year_row[a["col"]]) if a["col"] < len(_year_row) else None
        _year_total["total4"] = _qf(_year_row[7]) if len(_year_row) > 7 else None

    qe_monthly_summary = {
        "months": _months,
        "abilities": [
            {"key": a["key"], "name": a["name"], "has2025": a["has2025"], "values": _vals[a["key"]]}
            for a in _QE_ABILITIES
        ],
        "total4": _tot4,
        "cumTotal": _cum,
        "yearTotal": _year_total,
        "source": "金山文档·质效分析 sheet3「数据月度汇总」",
    }
    print(f"  [qeMonthlySummary] {len(_months)} 个月 × {len(_QE_ABILITIES)} 项能力；年度合计={_year_total}")
except Exception as _e:
    print("  [qeMonthlySummary] 未生成（文件缺失或解析失败）:", _e)

# ---------- 汇总输出 ----------
payload = {
    "meta": {
        "source": "金山文档·数据验证（在线）",
        "fileUrl": "https://www.kdocs.cn/l/csizWM8t2VLc",
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "period": "2026年1-7月",
        "provinces": sorted([p["province"] for p in province_list if p["province"]]),
        # 时间维度可用性（前端据此决定各维度选择器是否可用）
        "timeLevels": {
            "months": ["1月", "2月", "3月", "4月", "5月", "6月", "7月"],
            "weeks": weekly_labels_sorted if weekly_labels_sorted else ["0720-0726"],
            "days": [],
        },
        # 33 个单位：31 个省分中心 + 本部 + 全国(总计)
        "units": {
            "national": "总计",
            "hq": "本部",
            "total": 33,
            "note": "省份筛选含 31 个省分中心 + 本部 + 全国(总计) 共 33 个单位；周维度仅埋点模块可用；日维度数据尚未接入。",
        },
        "gaps": gaps,
    },
    "overview": {"monthly": overview_monthly, "kpis": overview_kpis},
    "overviewByProvince": overviewByProvince,
    "agentMonthly": agentMonthly,
    "agents": agents,
    "provinces": province_list,
    "tracking": tracking,
    "platformTracking": platform_tracking,
    "platformMonthly": platform_monthly,
    "capability": {"monthly": capability_monthly, "yearly": capability_yearly},
    "centerYearRank": center_year_rank or {},
    "qeMonthlySummary": qe_monthly_summary,
    "alerts": alerts,
}

os.makedirs(STATIC, exist_ok=True)
out = os.path.join(STATIC, "data.js")
with open(out, "w", encoding="utf-8") as f:
    f.write("// 自动生成（真实数据·金山文档「数据验证」）。重新生成：python build_real.py\n")
    f.write("window.LINGYUN_DATA = ")
    # 紧凑输出：indent 格式化会让 data.js 膨胀到 15MB+，导致首屏加载过慢（页面看似空白）
    f.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    f.write(";\n")
    if LY_OVERVIEW_PANORAMA:
        f.write("window.LY_OVERVIEW_PANORAMA = ")
        f.write(json.dumps(LY_OVERVIEW_PANORAMA, ensure_ascii=False, separators=(",", ":")))
        f.write(";\n")

print("已生成:", out)
print(f"  overview months={len(overview_monthly)}")
print(f"  agents={len(agents)} (有效等效人年>0: {active_agent_count})")
print(f"  provinces={len(province_list)}")
print(f"  tracking pages={len(tracking)}")
print(f"  platformTracking weeks={len(platform_tracking['weeks'])} pages={len(platform_tracking['pageTotals'])} provinces={len(platform_tracking['provinceTotals'])}")
print(f"  capability months={len(capability_monthly)}")
print(f"  alerts={len(alerts)} (gaps noted: {len(gaps)})")
