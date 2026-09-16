# -*- coding: utf-8 -*-
"""
从【合】灵运BI重要数据_智能体分类_20260902.xlsx 生成 static/agents_preview_data.js（34列契约）

要点：
1. 只按表头名称映射，禁止固定列下标（应用ID插入后旧下标全部错位）。
2. 缺少必需表头立即报错退出，不生成错位数据。
3. Token / 计费：月份 < tokenStartMonth(6月) 一律写 None，即使源表有非零值。
4. 推广场景：案例总表存在纵向合并单元格，必须向下填充；仅推广案例区间继承。
5. 应用身份：entityId = appId || 省份|名称|创建人；统计回退行与同月冲突。
6. 案例入选月份：按 entityId 派生 promo/excellent/biweek 首次标记为 1 的月份。
7. 输出 1—8 月框架：缺失月份不造假记录，只在 meta.dataAvailability 标记 false。
8. 输出数据质量统计，供页面注脚与冒烟断言使用。

说明：用底层 XML 解析绕开 openpyxl 与本工作簿 DataValidation 属性的兼容问题。

用法：python3 build/gen_preview_data_v2.py
输出：static/agents_preview_data.js（覆盖）
"""
import json
import os
import re
import sys
import zipfile
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 数据源：最新合并表。按规范 6 位于 Downloads；找不到时回退到项目同级与基座包内。
SRC_CANDIDATES = [
    os.path.join(BASE, "【合】灵运BI重要数据_智能体分类_20260902.xlsx"),
    "/Users/yuuuki/Desktop/中移在线/工作-产品/看板/【合】灵运BI重要数据_智能体分类_20260902.xlsx",
    "/Users/yuuuki/Downloads/【合】灵运BI重要数据.xlsx",
    os.path.join(BASE, "..", "【合】灵运BI重要数据.xlsx"),
    os.path.join(BASE, "【合】灵运BI重要数据.xlsx"),
]
SRC = next((p for p in SRC_CANDIDATES if os.path.exists(p)), SRC_CANDIDATES[0])
OUT = os.path.join(BASE, "static", "agents_preview_data.js")

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

REPORT_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月"]
TOKEN_START_MONTH = "6月"          # 业务口径：Token 与计费自 6 月起统计
TOKEN_START_NUM = 6

THRESHOLDS = {"activeCalls": 1000, "hotCalls": 100000, "highEffRatio": 0.30}

MONTH_RE = re.compile(r"^(\d{1,2})月$")
EXCEL_EPOCH = datetime(1899, 12, 30)


def die(msg):
    print("✗ " + msg, file=sys.stderr)
    sys.exit(1)


def col_index(ref):
    n = 0
    for ch in ref or "":
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def read_sheet(z, target):
    """按 sheet 名读取，返回 (header: {名称: 列号}, rows: [ {列号: 值} ])"""
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml"), events=("end",)):
            if el.tag == NS + "si":
                shared.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rmap = {r.get("Id"): r.get("Target") for r in rels}
    path = None
    for sh in wb.find(NS + "sheets"):
        if sh.get("name") == target:
            t = rmap[sh.get(RNS + "id")]
            t = t.lstrip("/")
            path = t if t.startswith("xl/") else "xl/" + t
            break
    if not path:
        die("找不到工作表：" + target)

    rows = []
    cur = None
    for event, el in ET.iterparse(z.open(path), events=("start", "end")):
        if event == "start" and el.tag == NS + "row":
            cur = {}
        elif event == "end" and el.tag == NS + "c" and cur is not None:
            ref = el.get("r")
            t = el.get("t")
            v = el.find(NS + "v")
            isv = el.find(NS + "is")
            if t == "s" and v is not None:
                idx = int(v.text) if v.text else -1
                val = shared[idx] if 0 <= idx < len(shared) else None
            elif t == "inlineStr" and isv is not None:
                val = "".join(x.text or "" for x in isv.iter(NS + "t"))
            elif v is not None:
                raw = v.text
                if t in (None, "n") and raw is not None:
                    try:
                        val = float(raw) if ("." in raw or "e" in raw.lower()) else int(raw)
                    except ValueError:
                        val = raw
                else:
                    val = raw
            else:
                val = None
            if ref is not None:
                cur[col_index(ref)] = val
            el.clear()
        elif event == "end" and el.tag == NS + "row":
            rows.append(cur)
            cur = None
            el.clear()
    if not rows:
        die("工作表为空：" + target)
    header = {}
    for i, v in rows[0].items():
        if v is not None and str(v).strip():
            header[str(v).strip()] = i
    return header, rows[1:]


def num(x, nd=4):
    if x is None:
        return None
    if isinstance(x, bool):
        return int(x)
    if isinstance(x, (int, float)):
        if x != x:
            return None
        return round(float(x), nd)
    s = str(x).strip()
    if s in ("", "/", "暂无数据", "None", "nan", "-"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return round(f, nd)


def i01(x):
    n = num(x)
    return 1 if n else 0


def txt(x):
    if x is None:
        return ""
    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d %H:%M")
    s = str(x).strip()
    return "" if s in ("None", "nan") else s


def optional_txt(x):
    """清洗可选字段中的 Excel 占位符，避免把 -- 当成真实 ID/分类。"""
    s = txt(x)
    return "" if s in ("--", "—", "/", "-") else s


def fmt_created(x):
    """兼容 Excel 日期序列号与字符串两种形态"""
    if x is None:
        return ""
    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d %H:%M")
    if isinstance(x, (int, float)):
        try:
            return (EXCEL_EPOCH + timedelta(days=float(x))).strftime("%Y-%m-%d %H:%M")
        except Exception:
            return ""
    s = str(x).strip()
    return s[:16] if s else ""


def month_num(m):
    mm = MONTH_RE.match(txt(m))
    return int(mm.group(1)) if mm else 99


def norm_key(s):
    return re.sub(r"\s+", "", txt(s))


def main():
    if not os.path.exists(SRC):
        die("数据源不存在：" + SRC)
    z = zipfile.ZipFile(SRC)

    # ---------- 智能体清单：表头映射 ----------
    H, arows = read_sheet(z, "智能体清单（各省）")
    REQUIRED = ["月份", "省份", "应用名称", "应用调用量", "应用状态",
                "是否活跃智能体（月调用量>1000）",
                "是否活跃且高提效智能体（月调用量>1000&提效>30%）",
                "是否高热度智能体（月调用量>100000）", "提效比率"]
    miss = [k for k in REQUIRED if k not in H]
    if miss:
        die("缺少必需表头，已中止以避免生成错位数据：" + "、".join(miss))

    def g(row, key):
        i = H.get(key)
        return row.get(i) if i is not None else None

    print("=== 智能体清单表头（%d 列，按名称映射）===" % len(H))
    print("  " + "、".join(sorted(H, key=lambda k: H[k])[:8]) + " …")

    # ---------- 案例总表：场景向下填充 ----------
    CH, crows = read_sheet(z, "推广+双周+优秀（总表）")

    def cg(row, key):
        i = CH.get(key)
        return row.get(i) if i is not None else None

    def norm_scene(s):
        s = txt(s).replace("\n", "").replace("\r", "").strip()
        return "" if s in ("/", "None", "nan") else s

    def parse_kinds(v):
        s = txt(v).replace("，", ",")
        return [x.strip() for x in s.split(",") if x.strip()]

    py_cols = [(i, re.sub(r"\D", "", k)[:1] + "月")
               for k, i in CH.items() if "等效人年" in k]
    py_cols.sort(key=lambda x: int(x[1].replace("月", "") or 99))

    case_catalog = []
    scene_map = {}          # (省份, 应用名称) -> 场景
    ambiguous_join = 0
    last_scene = ""
    for r in crows:
        name = txt(cg(r, "应用名称"))
        if not name:
            continue
        kinds = parse_kinds(cg(r, "案例类型"))
        prov = txt(cg(r, "省份"))
        # 仅推广案例区间继承合并单元格场景
        if "推广案例" in kinds:
            s = norm_scene(cg(r, "推广场景"))
            if s:
                last_scene = s
            scene = last_scene
        else:
            scene = ""
        py = {}
        for i, m in py_cols:
            v = num(cg(r, "等效人年") if False else r.get(i), 4)
            if v is not None:
                py[m] = v
        case_catalog.append({
            "kinds": kinds,
            "promoScene": scene,
            "province": prov,
            "name": name,
            "creator": txt(cg(r, "创建人")),
            "createdAt": fmt_created(cg(r, "创建时间")),
            "monthlyPersonYear": py,
        })
        if scene:
            key = (norm_key(prov), norm_key(name))
            if key in scene_map and scene_map[key] != scene:
                ambiguous_join += 1
            scene_map[key] = scene

    # ---------- 逐行归一化 ----------
    agents = []
    fallback_rows = 0
    appid_rows = 0
    mark_mismatch = Counter()
    month_seen = set()
    collision = Counter()
    agent_pn_keys = set()      # (省份, 名称) —— 案例总表可关联键
    agent_pnc_keys = set()     # (省份, 名称, 创建人) —— 严格关联键

    for r in arows:
        month = txt(g(r, "月份"))
        name = txt(g(r, "应用名称"))
        if not month or not name:
            continue
        month_seen.add(month)
        province = txt(g(r, "省份")) or "未标注"
        creator = txt(g(r, "创建人"))
        app_id = optional_txt(g(r, "应用ID"))

        if app_id:
            appid_rows += 1
            entity_id = "ID:" + app_id
        else:
            fallback_rows += 1
            entity_id = "K:" + norm_key(province) + "|" + norm_key(name) + "|" + norm_key(creator)
        collision[(month, entity_id)] += 1

        calls = num(g(r, "应用调用量"), 2) or 0
        eff = num(g(r, "提效比率"), 4)
        if eff is not None and eff > 1:
            eff = round(eff / 100.0, 4)

        # 源表标记 + 公式复核（不一致只记录，不静默覆盖）
        m_active = i01(g(r, "是否活跃智能体（月调用量>1000）"))
        m_higheff = i01(g(r, "是否活跃且高提效智能体（月调用量>1000&提效>30%）"))
        m_hot = i01(g(r, "是否高热度智能体（月调用量>100000）"))
        f_active = 1 if calls > THRESHOLDS["activeCalls"] else 0
        f_hot = 1 if calls > THRESHOLDS["hotCalls"] else 0
        f_higheff = 1 if (calls > THRESHOLDS["activeCalls"] and eff is not None
                          and eff > THRESHOLDS["highEffRatio"]) else 0
        if m_active != f_active:
            mark_mismatch["isActive"] += 1
        if m_higheff != f_higheff:
            mark_mismatch["isHighEff"] += 1
        if m_hot != f_hot:
            mark_mismatch["isHot"] += 1

        # Token / 计费：早于采集起点一律 None
        mn = month_num(month)
        if mn < TOKEN_START_NUM:
            tokens = busy_tokens = idle_tokens = None
            model_cost = busy_cost = idle_cost = None
        else:
            tokens = num(g(r, "总Token数"), 2)
            busy_tokens = num(g(r, "忙时总Token数"), 2)
            idle_tokens = num(g(r, "闲时总Token数"), 2)
            model_cost = num(g(r, "模型计费（元）"), 2)
            busy_cost = num(g(r, "忙时模型计费（元）"), 2)
            idle_cost = num(g(r, "闲时模型计费（元）"), 2)

        mk = g(r, "是否上架到应用广场")
        if mk is None or optional_txt(mk) == "":
            is_marketplace = None
        else:
            is_marketplace = i01(mk)

        scene_key = (norm_key(province), norm_key(name))
        agent_pn_keys.add(scene_key)
        agent_pnc_keys.add((norm_key(province), norm_key(name), norm_key(creator)))

        agents.append({
            "entityId": entity_id,
            "appId": app_id or None,
            "month": month,
            "province": province,
            "creator": creator,
            "createdAt": fmt_created(g(r, "创建时间")),
            "name": name,
            "description": txt(g(r, "应用说明")),
            "type": txt(g(r, "应用类型")) or "其他",
            "tags": optional_txt(g(r, "应用标签")),
            "servicePhase": optional_txt(g(r, "服务环节大分类")) or None,
            "appScene": optional_txt(g(r, "应用场景小分类")) or None,
            "status": txt(g(r, "应用状态")) or "未标注",
            "calls": calls,
            "tokens": tokens,
            "busyTokens": busy_tokens,
            "idleTokens": idle_tokens,
            "modelCost": model_cost,
            "busyCost": busy_cost,
            "idleCost": idle_cost,
            "hasCalls": i01(g(r, "是否有调用标记（月调用量>0）")),
            "isActive": m_active,
            "isHighEff": m_higheff,
            "isHot": m_hot,
            "isPromo": i01(g(r, "是否推广智能体")),
            "isExcellent": i01(g(r, "是否优秀智能体")),
            "isBiweek": i01(g(r, "是否双周优秀智能体")),
            "effRatio": eff,
            "saveSec": num(g(r, "单笔节约时长"), 2),
            "personYear": num(g(r, "节约人年"), 4),
            "isMarketplace": is_marketplace,
            "copyCount": num(g(r, "复制量"), 2) or 0,
            # 源表该列为空时，以存在 Token 作为“使用大模型”的可审计回退标记。
            "isLLM": i01(g(r, "是否使用大模型")) or (1 if tokens is not None and tokens > 0 else 0),
            "successRate": None,     # 本页禁用：不展示、不筛选、不参与计算
            "responseSec": None,     # 本页禁用：不展示、不筛选、不参与计算
            "promoScene": scene_map.get(scene_key, ""),
        })

    # ---------- 案例入选月份（按 entityId，遍历全部月份取首次为 1） ----------
    first_hit = {}
    for a in sorted(agents, key=lambda x: month_num(x["month"])):
        e = a["entityId"]
        rec = first_hit.setdefault(
            e, {"promoEntryMonth": None, "excellentEntryMonth": None, "biweekEntryMonth": None})
        if a["isPromo"] and rec["promoEntryMonth"] is None:
            rec["promoEntryMonth"] = a["month"]
        if a["isExcellent"] and rec["excellentEntryMonth"] is None:
            rec["excellentEntryMonth"] = a["month"]
        if a["isBiweek"] and rec["biweekEntryMonth"] is None:
            rec["biweekEntryMonth"] = a["month"]

    # ---------- 数据可用性（1—8 月框架） ----------
    avail = {}
    for m in REPORT_MONTHS:
        has = m in month_seen
        avail[m] = {"agentDetail": has, "token": has and month_num(m) >= TOKEN_START_NUM}

    # 案例总表与智能体清单的关联命中（口径：省份+应用名称；严格口径再加创建人）
    def _ck(c):
        return (norm_key(c["province"]), norm_key(c["name"]))
    case_total = len(case_catalog)
    case_hit = [c for c in case_catalog if _ck(c) in agent_pn_keys]
    case_hit_strict = [c for c in case_catalog
                       if (norm_key(c["province"]), norm_key(c["name"]),
                           norm_key(c["creator"])) in agent_pnc_keys]
    promo_cases = [c for c in case_catalog if "推广案例" in c["kinds"]]

    quality = {
        "missingAppIdRows": fallback_rows,
        "identityFallbackRows": fallback_rows,
        "identityCollisionCount": sum(1 for v in collision.values() if v > 1),
        "ambiguousCaseJoinCount": ambiguous_join,
        "missingPromoSceneCount": sum(1 for c in promo_cases if not c["promoScene"]),
        "markVsFormulaMismatch": dict(mark_mismatch),
        # —— 案例总表关联率（口径：省份+应用名称） ——
        "caseTotalCount": case_total,
        "caseJoinHitCount": len(case_hit),
        "caseJoinHitRate": round(len(case_hit) / case_total, 4) if case_total else 0,
        "caseJoinUnmatchedCount": case_total - len(case_hit),
        # —— 严格口径（再加创建人）——
        "caseJoinStrictHitCount": len(case_hit_strict),
        # —— 推广场景覆盖 ——
        "promoCaseCount": len(promo_cases),
        "promoSceneCoveredCount": sum(1 for c in promo_cases if c["promoScene"]),
        "promoSceneTypes": len({c["promoScene"] for c in promo_cases if c["promoScene"]}),
    }

    latest = sorted(month_seen, key=month_num)[-1] if month_seen else None

    out = {
        "meta": {
            "source": os.path.basename(SRC),
            "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "reportMonths": REPORT_MONTHS,
            "latestCompleteMonth": latest,
            "tokenStartMonth": TOKEN_START_MONTH,
            "thresholds": THRESHOLDS,
            "dataAvailability": avail,
            "dataQuality": quality,
        },
        "agents": agents,
        "caseCatalog": case_catalog,
        "agentLifecycle": first_hit,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 预览数据：由" + os.path.basename(SRC) + "生成；不作为正式部署数据。\n")
        f.write("window.LINGYUN_DATA = " +
                json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    z.close()

    # ---------- 自检输出 ----------
    print("\n=== 自检 ===")
    print("智能体行：%d ｜ 案例条目：%d ｜ lifecycle：%d"
          % (len(agents), len(case_catalog), len(first_hit)))
    print("实际月份：%s" % sorted(month_seen, key=month_num))
    agg = defaultdict(lambda: dict(n=0, calls=0, act=0, hot=0, high=0, tok=0, cost=0))
    for a in agents:
        d = agg[a["month"]]
        d["n"] += 1
        d["calls"] += a["calls"] or 0
        d["act"] += a["isActive"]
        d["hot"] += a["isHot"]
        d["high"] += a["isHighEff"]
        d["tok"] += a["tokens"] or 0
        d["cost"] += a["modelCost"] or 0
    print("\n月份  应用数      调用量   活跃 高热度 高提效   Token(亿)   计费(万)")
    for m in REPORT_MONTHS:
        if m not in agg:
            print("%-4s  %-8s %s" % (m, "待接入", "(缺失月份，框架保留，不生成假记录)"))
            continue
        d = agg[m]
        print("%-4s %7d %11s %5d %5d %5d %10s %10s"
              % (m, d["n"], format(int(d["calls"]), ","), d["act"], d["hot"], d["high"],
                 ("%.1f" % (d["tok"] / 1e8)) if d["tok"] else "—",
                 ("%.1f" % (d["cost"] / 1e4)) if d["cost"] else "—"))
    print("\n数据质量：")
    for k, v in quality.items():
        print("  %-26s %s" % (k, v))
    scenes = Counter(c["promoScene"] or "未分类"
                     for c in case_catalog if "推广案例" in c["kinds"])
    print("\n推广场景（向下填充后）：", dict(scenes.most_common()))
    print("\n输出：%s（%.1f MB）" % (OUT, os.path.getsize(OUT) / 1048576))


if __name__ == "__main__":
    main()
