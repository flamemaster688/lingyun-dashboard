# -*- coding: utf-8 -*-
"""
灵运 BI 看板 · 机械拆分脚本
把单文件巨石 lingyun.app.v10.js 无损拆分为：
  - static/core/core.js        （共享状态/工具/取数管线/tab 分发，全局脚本）
  - static/pages/<id>.js       （每个页面一个文件，各自 IIFE，只挂 registerPage）
原文件保持不动（由 index.legacy.html 兜底引用）。
"""
import os, io

SRC = os.path.join(os.path.dirname(__file__), "..", "static", "lingyun.app.v10.js")
SRC = os.path.abspath(SRC)
STATIC = os.path.dirname(SRC)
CORE_DIR = os.path.join(STATIC, "core")
PAGES_DIR = os.path.join(STATIC, "pages")
os.makedirs(CORE_DIR, exist_ok=True)
os.makedirs(PAGES_DIR, exist_ok=True)

with io.open(SRC, "r", encoding="utf-8") as f:
    TEXT = f.read()

# ---- 1. 括号配对提取某个顶层函数（跳过注释/字符串/正则字面量） ----
def _prev_significant(text, pos):
    """返回 pos 之前最后一个非空白、非注释的字符。"""
    j = pos - 1
    while j >= 0:
        c = text[j]
        if c in " \t\r\n":
            j -= 1
            continue
        if c == "*" and j > 0 and text[j-1] == "/":  # 块注释结尾 */
            # 回退到注释开头
            k = j - 1
            while k >= 0 and not (text[k] == "/" and k > 0 and text[k-1] == "*"):
                k -= 1
            j = k - 2
            continue
        return c
    return ""

def find_func(text, name):
    needle = "function " + name + "("
    idx = text.find(needle)
    if idx < 0:
        raise RuntimeError("找不到函数: " + name)
    br = text.index("{", idx)
    depth = 0
    i = br
    n = len(text)
    while i < n:
        c = text[i]
        # 行注释
        if c == "/" and i + 1 < n and text[i+1] == "/":
            nl = text.find("\n", i)
            i = n if nl < 0 else nl
            continue
        # 块注释
        if c == "/" and i + 1 < n and text[i+1] == "*":
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        # 字符串
        if c in ("'", '"', "`"):
            q = c
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == q:
                    break
                i += 1
            i += 1
            continue
        # 正则字面量 vs 除号
        if c == "/":
            nxt = text[i+1] if i + 1 < n else ""
            if nxt not in ("/", "*"):
                prev = _prev_significant(text, i)
                is_regex = not (prev.isalnum() or prev in ")]}_$.")
                if is_regex:
                    j = i + 1
                    in_cls = False
                    found = False
                    while j < n:
                        ch = text[j]
                        if ch == "\\":
                            j += 2
                            continue
                        if ch == "[" and not in_cls:
                            in_cls = True
                        elif ch == "]" and in_cls:
                            in_cls = False
                        elif ch == "/" and not in_cls:
                            j += 1
                            while j < n and text[j].isalnum():
                                j += 1
                            found = True
                            break
                        j += 1
                    if found:
                        i = j
                        continue
                    # 没找到结尾，当作普通字符继续
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[idx:i+1], idx, i+1
        i += 1
    raise RuntimeError("函数未闭合: " + name)

# ---- 2. 各页面要搬走的函数（按源文件出现顺序） ----
PAGES = [
    {"id": "overview", "file": "overview.js", "title": "数据总览", "icon": "◆",
     "order": 1, "owner": "吴超", "main": "renderOverview",
     "fns": ["renderOverview", "renderProvinceMap"]},
    {"id": "agents", "file": "agents.js", "title": "智能体", "icon": "◎",
     "order": 2, "owner": "羽琪", "main": "renderAgents",
     "fns": ["renderAgents", "renderAgentTypeStats", "renderAgentCalls"]},
    {"id": "pages", "file": "tracking.js", "title": "平台分析（埋点）", "icon": "◎",
     "order": 3, "owner": "赵莹", "main": "renderPages",
     "fns": ["renderPages"]},
    {"id": "province", "file": "province.js", "title": "省份分析", "icon": "◎",
     "order": 4, "owner": "吴超", "main": "renderProvince",
     "fns": ["renderProvince"]},
    {"id": "quality", "file": "quality.js", "title": "质效分析", "icon": "◎",
     "order": 5, "owner": "赵莹", "main": "renderQuality",
     "fns": ["initCenterRankState", "renderCenterRank", "renderCenterRankMonthFilter",
             "renderCenterRankAbilityFilter", "renderCenterRankProvFilter",
             "centerSumAbility", "selRangeLabel", "selProvLabel", "breakdownCols",
             "centerCompute", "drawCenterRankTable", "downloadCenterRank", "renderQuality"]},
    {"id": "alerts", "file": "alarms.js", "title": "告警中心", "icon": "⚠",
     "order": 6, "owner": "羽琪", "main": "renderAlerts",
     "fns": ["renderAlerts"]},
    {"id": "report", "file": "report.js", "title": "报告生成", "icon": "◈",
     "order": 7, "owner": "吴超", "main": "renderReport",
     "fns": ["renderReport"]},
]

# 提取并收集待删除区间
extracted = {}          # id -> list of function texts
spans = []              # (start,end)
for p in PAGES:
    texts = []
    for fn in p["fns"]:
        t, s, e = find_func(TEXT, fn)
        texts.append(t)
        spans.append((s, e))
    extracted[p["id"]] = texts

# 从原文删掉这些函数（倒序删，保证索引有效）
core_base = TEXT
for s, e in sorted(spans, reverse=True):
    core_base = core_base[:s] + core_base[e:]

# ---- 3. 去掉 IIFE 包裹，改为全局脚本 ----
# 删掉开头的 (function () {
first = core_base.find("(function () {")
assert first >= 0, "未找到 IIFE 开头"
core_base = core_base[:first] + core_base[first + len("(function () {"):]
# 删掉结尾的 })();（最后一个出现）
last = core_base.rfind("})();")
assert last >= 0, "未找到 IIFE 结尾"
core_base = core_base[:last] + core_base[last + len("})();"):]

# ---- 4. 注入注册表基础设施（紧跟 var instMap = {};） ----
core_base = core_base.replace(
    "var instMap = {};",
    "var instMap = {};\n  window.LY = window.LY || { pages: {} };\n"
    "  window.registerPage = function (cfg) { window.LY.pages[cfg.id] = cfg; };\n"
    "  window.optimizePage = function (id) { var p = window.LY.pages[id]; if (p && p.render) p.render(); };\n",
    1)

# ---- 5. renderCurrent 改为注册表分发 ----
old_rc = (
    '  function renderCurrent(tab) {\n'
    '    if (tab === "overview") renderOverview();\n'
    '    else if (tab === "agents") renderAgents();\n'
    '    else if (tab === "pages") renderPages();\n'
    '    else if (tab === "province") renderProvince();\n'
    '    else if (tab === "quality") renderQuality();\n'
    '    else if (tab === "report") renderReport();\n'
    '    setTimeout(function () { Object.keys(instMap).forEach(function (k) { try { instMap[k].resize(); } catch (e) {} }); }, 30);\n'
    '  }'
)
new_rc = (
    '  function renderCurrent(tab) {\n'
    '    var p = (window.LY && window.LY.pages) ? window.LY.pages[tab] : null;\n'
    '    if (p && typeof p.render === "function") { p.render(); }\n'
    '    else if (typeof window["__legacyRender_" + tab] === "function") { window["__legacyRender_" + tab](); }\n'
    '    else { console.warn("[灵运] 未注册页面：" + tab); }\n'
    '    setTimeout(function () { Object.keys(instMap).forEach(function (k) { try { instMap[k].resize(); } catch (e) {} }); }, 30);\n'
    '  }'
)
assert old_rc in core_base, "renderCurrent 模板不匹配"
core_base = core_base.replace(old_rc, new_rc, 1)

# ---- 6. 修补 init 中对 renderReport 的引用（renderReport 已移到 report 页） ----
old_btn = '    if ($("btnGen")) $("btnGen").onclick = renderReport;'
new_btn = '    if ($("btnGen")) $("btnGen").onclick = function () { var p = window.LY.pages.report; if (p && p.render) p.render(); };'
assert old_btn in core_base, "btnGen 模板不匹配"
core_base = core_base.replace(old_btn, new_btn, 1)

old_chg = '    if ($("reportType")) $("reportType").onchange = renderReport;'
new_chg = '    if ($("reportType")) $("reportType").onchange = function () { var p = window.LY.pages.report; if (p && p.render) p.render(); };'
assert old_chg in core_base, "reportType 模板不匹配"
core_base = core_base.replace(old_chg, new_chg, 1)

# 头部注释
core_header = (
    "/* core/core.js — 灵运 BI 看板·共享内核（全局脚本）\n"
    " * 由 build/split.py 从 lingyun.app.v10.js 自动拆分生成，请勿手工搬动页面渲染函数。\n"
    " * 职责：共享状态(D/FILTER/V)、工具函数、金山文档取数管线、tab 注册表与分发。\n"
    " * 页面渲染函数全部位于 static/pages/*.js，通过 window.registerPage 注册。\n"
    " */\n"
)
core_out = core_header + core_base

with io.open(os.path.join(CORE_DIR, "core.js"), "w", encoding="utf-8") as f:
    f.write(core_out)

# ---- 7. 写出每个页面文件 ----
for p in PAGES:
    fns = extracted[p["id"]]
    body = "\n\n".join(fns)
    main_call = p["main"] + "();"
    tpl = (
        "/* pages/{file} — {title}（负责人：{owner}）\n"
        " * 本文件只负责本页面渲染，只读 core/core.js 暴露的全局共享状态（D / FILTER / V 等），\n"
        " * 不写任何取数逻辑。优化本页只需改这个文件，互不影响其他页面。\n"
        " */\n"
        "(function () {{\n"
        "  if (!window.LY) window.LY = {{ pages: {{}} }};\n"
        "  window.registerPage({{\n"
        "    id: \"{id}\",\n"
        "    title: \"{title}\",\n"
        "    icon: \"{icon}\",\n"
        "    order: {order},\n"
        "    owner: \"{owner}\",\n"
        "    render: function () {{ {main} }}\n"
        "  }});\n\n"
        "  /* ===== 本页面渲染函数（从原 v10 无损搬入） ===== */\n"
        "{body}\n"
        "}})();\n"
    ).format(file=p["file"], title=p["title"], owner=p["owner"], id=p["id"],
             icon=p["icon"], order=p["order"], main=main_call, body=body)
    with io.open(os.path.join(PAGES_DIR, p["file"]), "w", encoding="utf-8") as f:
        f.write(tpl)

print("OK: 生成 core/core.js + %d 个页面文件" % len(PAGES))
for p in PAGES:
    print("  - pages/%s  (%s, 负责人 %s)" % (p["file"], p["title"], p["owner"]))
