# -*- coding: utf-8 -*-
"""
merge_agents_v2.py —— 把 v2 智能体生成器产物合并进正式 static/data.js

做法（符合「智能体页_v2数据接入交接_赵莹.md」）：
1. 读取当前 static/data.js（window.LINGYUN_DATA），保留 overview/agents/provinces/
   tracking/centerYearRank/qeMonthlySummary 等所有既有域。
2. 读取 gen_preview_data_v2.py 生成的 window.LINGYUN_DATA（含 meta/agents/caseCatalog/
   agentLifecycle）。
3. 整批覆盖注入三个 v2 域：
      agentMonthly      <- 生成器的 agents（31,850 条，月份 1—8）
      agentCaseCatalog  <- 生成器的 caseCatalog
      agentLifecycle    <- 生成器的 agentLifecycle
   （旧 agentMonthly 若存在则被整批替换；旧顶层 agents 域保留，供总览页使用，不被覆盖。）
4. 合并 meta：仅追加/覆盖智能体 v2 需要的键（reportMonths / latestCompleteMonth /
   tokenStartMonth / thresholds / dataAvailability / dataQuality），不动 base 的
   timeLevels/period/provinces/units/gaps（避免影响其他页面）。
5. 紧凑输出（无缩进）写回 static/data.js，文件头注明合并来源与时间。
"""
import json
import os
import sys
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
DATA_JS = os.path.join(STATIC, "data.js")

# 生成器产物（优先用项目内刚生成的，其次用交付 zip 内的）
CANDIDATES = [
    os.path.join(ROOT, "static", "agents_preview_data.js"),
    "/tmp/zipexplore/智能体看板_赵莹交付_20260916/static/agents_preview_data.js",
]
PREVIEW = next((p for p in CANDIDATES if os.path.exists(p)), None)

MARKER = "window.LINGYUN_DATA = "


def load(path):
    text = open(path, encoding="utf-8").read()
    i = text.index(MARKER) + len(MARKER)
    rest = text[i:].rstrip().rstrip(";").rstrip()
    return json.loads(rest)


def main():
    if not PREVIEW:
        print("✗ 找不到生成器产物 agents_preview_data.js", file=sys.stderr)
        sys.exit(1)

    print("读取正式 data.js:", DATA_JS)
    base = load(DATA_JS)
    print("读取 v2 生成产物:", PREVIEW)
    pv = load(PREVIEW)

    # 1) 整批覆盖三个 v2 域
    base["agentMonthly"] = pv["agents"]                 # 重命名：agents -> agentMonthly
    base["agentCaseCatalog"] = pv["caseCatalog"]
    base["agentLifecycle"] = pv["agentLifecycle"]
    print("  ✓ agentMonthly   = %d 条" % len(base["agentMonthly"]))
    print("  ✓ agentCaseCatalog = %d 条" % len(base["agentCaseCatalog"]))
    print("  ✓ agentLifecycle   = %d 个实体" % len(base["agentLifecycle"]))

    # 2) 合并 meta（只追加 v2 需要的键）
    pm = pv.get("meta", {}) or {}
    bm = base.setdefault("meta", {})
    for k in ["reportMonths", "latestCompleteMonth", "tokenStartMonth",
              "thresholds", "dataAvailability", "dataQuality"]:
        if k in pm:
            bm[k] = pm[k]
    # 在 gaps 中注明智能体 v2 已并入（不影响其他页口径）
    gaps = bm.get("gaps", []) or []
    note = "智能体 v2（agentMonthly 1—8 月）已并入，由 pages/agents.js v2 读取。"
    if note not in gaps:
        gaps.append(note)
    bm["gaps"] = gaps

    # 3) 紧凑输出
    header = (
        "// 自动生成（真实数据·智能体 v2 合并 %s）。\n"
        "// 基座数据由 build_real.py / build/fetch-data.py 生成；智能体 v2 域由 "
        "gen_preview_data_v2.py 生成后经 merge_agents_v2.py 并入。请勿手改。\n"
        % datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    )
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write(header + MARKER + json.dumps(base, ensure_ascii=False, separators=(",", ":")) + ";\n")

    size = os.path.getsize(DATA_JS) / 1048576.0
    print("  ✓ 写回 static/data.js（%.1f MB）" % size)

    # 4) 验收：1—8 月调用量 / 活跃 / 高热度
    TH = bm.get("thresholds", {}) or {}
    act = TH.get("activeCalls", 1000)
    hot = TH.get("hotCalls", 100000)
    by = {}
    for r in base["agentMonthly"]:
        m = r.get("month")
        d = by.setdefault(m, {"n": 0, "calls": 0, "act": 0, "hot": 0})
        d["n"] += 1
        d["calls"] += (r.get("calls") or 0)
        c = r.get("calls") or 0
        if c > act: d["act"] += 1
        if c > hot: d["hot"] += 1
    print("\n月份  应用数      调用量       活跃  高热度")
    for m in sorted(by.keys(), key=lambda x: int("".join(filter(str.isdigit, x)) or 0)):
        d = by[m]
        print("%-5s %6d  %12d  %5d  %5d" % (m, d["n"], d["calls"], d["act"], d["hot"]))


if __name__ == "__main__":
    main()
