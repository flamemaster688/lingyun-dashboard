# -*- coding: utf-8 -*-
"""
strip_kdocs.py —— 移除 data.js 中一切「在线文档」痕迹，统一改为离线 Excel 固化描述。

背景：早期版本把 meta / platformMonthly 两个域标注为「金山文档·在线」，并带 kdocs.cn 链接。
现在项目只保留 build/sources 下的 Excel，看板不依赖任何在线文档，运行时也不联网。
本脚本在 build_from_xlsx.py / build_extra.py / fix_data_sept18.py 之后执行，可重复运行（幂等）。

处理内容：
  1. meta.source / platformMonthly.source  → 离线 Excel 固化描述
  2. meta.fileUrl / platformMonthly.fileUrl → 清空（前端不再渲染「打开在线文件」）
  3. meta.gaps 等文案里的「金山文档」→「离线 Excel」
  4. 兜底：深度遍历 meta / platformMonthly / platformTracking，任何残留 kdocs.cn 链接置空
  5. 写入 meta.dataSources：项目内 Excel 清单（前端可展示）

用法：python3 build/strip_kdocs.py
"""
import os
import re
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, "static", "data.js")
PREFIX = "window.LINGYUN_DATA = "

# 项目内离线 Excel 清单（与 build/sources 目录一一对应）
DATA_SOURCES = [
    {"name": "【合】灵运BI重要数据（终版）.xlsx", "covers": "数据总览 / 省份分析 / 智能体 / 分省月度"},
    {"name": "【合】灵运BI重要数据_智能体分类_20260902.xlsx", "covers": "智能体服务环节 / 应用场景 标注"},
    {"name": "质效分析.xlsx", "covers": "质效分析（等效人年 / 月度汇总）"},
    {"name": "用户行为记录.xlsx", "covers": "平台分析（埋点 点击/访客/曝光 · 周月）"},
]

KDOC_RE = re.compile(r"https?://(www\.)?kdocs\.cn/\S*", re.I)


def load():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        s = f.read()
    i = s.index("=")
    body = s[i + 1:].strip()
    if body.endswith(";"):
        body = body[:-1]
    return json.loads(body)


def save(d):
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write(PREFIX + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + ";\n")


def scrub(obj):
    """深度清理：任何 kdocs 链接置空，任何「金山文档」字眼换成「离线 Excel」。"""
    n = 0
    if isinstance(obj, dict):
        for k in list(obj.keys()):
            v = obj[k]
            if isinstance(v, str):
                if KDOC_RE.search(v):
                    obj[k] = KDOC_RE.sub("", v).strip()
                    n += 1
                if "金山文档" in v:
                    obj[k] = v.replace("金山文档", "离线 Excel")
                    n += 1
            else:
                n += scrub(v)
    elif isinstance(obj, list):
        for i in range(len(obj)):
            v = obj[i]
            if isinstance(v, str):
                if KDOC_RE.search(v):
                    obj[i] = KDOC_RE.sub("", v).strip()
                    n += 1
                if "金山文档" in v:
                    obj[i] = v.replace("金山文档", "离线 Excel")
                    n += 1
            else:
                n += scrub(v)
    return n


def main():
    d = load()
    changed = []

    # ---- meta ----
    meta = d.setdefault("meta", {})
    old = meta.get("source")
    meta["source"] = "灵运BI·离线数据（Excel 固化·「数据验证」口径）"
    if old != meta["source"]:
        changed.append("meta.source: %r -> %r" % (old, meta["source"]))
    if meta.get("fileUrl"):
        changed.append("meta.fileUrl: %r -> ''" % meta["fileUrl"])
        meta["fileUrl"] = ""
    meta["offline"] = True
    meta["dataSources"] = DATA_SOURCES

    # ---- platformMonthly ----
    pm = d.get("platformMonthly")
    if isinstance(pm, dict):
        old = pm.get("source")
        pm["source"] = "灵运BI·平台分析-月（离线Excel固化·用户级埋点）"
        if old != pm["source"]:
            changed.append("platformMonthly.source: %r -> %r" % (old, pm["source"]))
        if pm.get("fileUrl"):
            changed.append("platformMonthly.fileUrl: %r -> ''" % pm["fileUrl"])
            pm["fileUrl"] = ""
        pm["offline"] = True

    # ---- 兜底深度清理 ----
    for key in ("meta", "platformMonthly", "platformTracking", "tracking", "provinces", "agents"):
        if key in d:
            n = scrub(d[key])
            if n:
                changed.append("%s: 清理 %d 处在线文档痕迹" % (key, n))

    save(d)
    print("[strip_kdocs] 完成，改动：")
    for c in changed:
        print("  -", c)
    if not changed:
        print("  (无改动，已经是离线版)")
    # 自检
    with open(DATA_JS, "r", encoding="utf-8") as f:
        s = f.read()
    left = KDOC_RE.findall(s)
    print("[strip_kdocs] 残留 kdocs 链接：%d" % len(left))
    print("[strip_kdocs] 残留「金山文档」字样：%d" % s.count("金山文档"))


if __name__ == "__main__":
    main()
