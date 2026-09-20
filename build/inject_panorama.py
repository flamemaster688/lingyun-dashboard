# -*- coding: utf-8 -*-
"""
inject_panorama.py —— 把「推广/优秀/双周优秀案例全景图」数据域写回 data.js（幂等）。

背景：
  overview.js 的「数据总览」页读取 window.LY_OVERVIEW_PANORAMA（推广案例全景图、
  环比变动因素下钻等）。该域原由 build_real.py（已删除）从
  build/sources/agents_overview.json 追加进 data.js；970d170 重构建链时该环节
  被遗漏，导致数据总览页全景图空白、点击无数据。

本脚本做两件事：
  1) 从 agents_overview.json 读取 LY_OVERVIEW_PANORAMA，并归一化为页面期望的结构：
     - rows[*].app          = name（页面用 r.app 展示应用名）
     - rows[*].monthly      = [1月..6月] 数值数组（None→0）
     - rows[*].createdMonth = 首次产生数据的月份下标（2025 年及以前创建→0）
     - sceneStats[scene]    = 6 个月的 {appCount, provinceCount, eqPersonYear}
  2) 幂等追加到 static/data.js 末尾：
     window.LY_OVERVIEW_PANORAMA = {...};
     window.LINGYUN_DATA.panorama = window.LY_OVERVIEW_PANORAMA;

用法：python3 build/inject_panorama.py   （在仓库根目录或任意位置均可）
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_JSON = os.path.join(BASE, "build", "sources", "agents_overview.json")
DATA_JS = os.path.join(BASE, "static", "data.js")

MARK_BEGIN = "/* __LY_PANORAMA_BEGIN__ */"
MARK_END = "/* __LY_PANORAMA_END__ */"


def month_index_from_created(created):
    """createdAt 形如 2025-11-12 17:50:25；2026 年 M 月 → M-1，更早 → 0；无法解析 → None。"""
    m = re.match(r"^(\d{4})-(\d{1,2})", (created or "").strip())
    if not m:
        return None
    y, mo = int(m.group(1)), int(m.group(2))
    if y < 2026:
        return 0
    return max(0, min(5, mo - 1))


def normalize(pano):
    months = pano.get("months") or []
    n = len(months)
    rows = []
    for r in (pano.get("rows") or []):
        monthly = []
        for m in months:
            v = r.get(m)
            try:
                v = float(v) if v is not None else 0.0
            except (TypeError, ValueError):
                v = 0.0
            monthly.append(round(v, 4))
        first_nz = next((i for i, v in enumerate(monthly) if v > 0), None)
        # 规则：以创建时间为准（2025 年及以前创建 → 0，即 1 月起已存在）；
        # 创建时间无法解析时回退「首次有数月份」，再无则 0。
        cm = month_index_from_created(r.get("createdAt"))
        if cm is None:
            cm = first_nz if first_nz is not None else 0
        rows.append({
            "tags": r.get("tags", ""),
            "scene": r.get("scene", ""),
            "province": r.get("province", ""),
            "app": r.get("name", ""),
            "name": r.get("name", ""),
            "createdAt": r.get("createdAt", ""),
            "creator": r.get("creator", ""),
            "monthly": monthly,
            "createdMonth": cm,
        })

    scene_stats = {}
    for r in rows:
        st = scene_stats.setdefault(r["scene"], [
            {"appCount": 0, "provinceCount": 0, "eqPersonYear": 0.0} for _ in months
        ])
        for i, v in enumerate(r["monthly"]):
            if v > 0:
                st[i]["appCount"] += 1
                st[i]["eqPersonYear"] = round(st[i]["eqPersonYear"] + v, 4)

    # provinceCount 需按月去重省份，单独再算一遍
    for scene in scene_stats:
        for i in range(len(months)):
            provs = {r["province"] for r in rows
                     if r["scene"] == scene and r["monthly"][i] > 0}
            scene_stats[scene][i]["provinceCount"] = len(provs)

    # 空场景（如 "/"）若全为 0，保留原样即可（页面会过滤 0）
    return {"rows": rows, "months": months,
            "scenes": pano.get("scenes") or [], "sceneStats": scene_stats}


def strip_old(text):
    """移除旧的注入块（幂等）以及历史遗留的单行赋值。"""
    text = re.sub(re.escape(MARK_BEGIN) + r"[\s\S]*?" + re.escape(MARK_END) + r"\n?", "", text)
    text = re.sub(r"window\.LY_OVERVIEW_PANORAMA\s*=\s*\{[\s\S]*?\};\n?", "", text, count=1)
    text = re.sub(r"window\.LINGYUN_DATA\.panorama\s*=[^\n]*\n?", "", text)
    return text


def extract_lingyun(data):
    """定位并返回 (header, json_text)；用括号配平扫描，对文件末尾是否有附加语句均幂等。"""
    key = "window.LINGYUN_DATA"
    start = data.find(key)
    if start < 0:
        return None, None
    i = data.find("{", start)
    if i < 0:
        return None, None
    depth = 0
    in_str = False
    esc = False
    for j in range(i, len(data)):
        ch = data[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return data[:start], data[i:j + 1]
    return None, None


def main():
    with open(SRC_JSON, encoding="utf-8") as f:
        src = json.load(f)
    pano = src.get("LY_OVERVIEW_PANORAMA")
    if not pano:
        print("[inject_panorama] agents_overview.json 中无 LY_OVERVIEW_PANORAMA，退出")
        sys.exit(1)

    norm = normalize(pano)

    # panorama 必须放进 LINGYUN_DATA（encrypt_data.js 只加密该 JSON，独立全局会丢），
    # 再由 data.js 末尾的赋值语句同步出 window.LY_OVERVIEW_PANORAMA 兼容旧读取。
    with open(DATA_JS, encoding="utf-8") as f:
        data = f.read()
    header, json_text = extract_lingyun(data)
    if not json_text:
        print("[inject_panorama] ✗ 无法从 data.js 解析 window.LINGYUN_DATA")
        sys.exit(1)
    obj = json.loads(json_text)
    obj["panorama"] = norm
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    out = (header.rstrip() + "\n"
           + "window.LINGYUN_DATA = " + payload + ";\n"
           + "// 2026-09-20: 恢复数据总览「推广/优秀/双周优秀案例全景图」数据域（970d170 重构建链时遗漏）\n"
           + "// 归一化逻辑见 build/inject_panorama.py；重跑本脚本幂等。\n"
           + "window.LY_OVERVIEW_PANORAMA = window.LINGYUN_DATA.panorama;\n")
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write(out)

    nz = sum(1 for r in norm["rows"] if any(v > 0 for v in r["monthly"]))
    print(f"[inject_panorama] rows={len(norm['rows'])}（有数行 {nz}） months={len(norm['months'])} "
          f"scenes={len(norm['scenes'])} sceneStats={len(norm['sceneStats'])} → LINGYUN_DATA.panorama 已写入")


if __name__ == "__main__":
    main()
