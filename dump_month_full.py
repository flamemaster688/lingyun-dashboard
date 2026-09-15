# -*- coding: utf-8 -*-
"""
全量 dump 脚本：把金山文档「平台分析-月」(file_id=e9WB6rKPh1MuxmekMsGdrxBn4VZNyGuTY) 的 4 个月 sheet
经 kdocs get_range_data 落盘的 JSON(.txt) 转换为 build_real.py 可消费的 _raw_month_<mm>.csv。

每个月 sheet 含 3 个并排 block（见 parse_one）：
  点击量   cols 0-3   province, NAME, PAGE, COUNT
  访客人数 cols 5-7   province, PAGE, count      (无 NAME)
  曝光次数 cols 9-12  province, NAME, PAGE, COUNT

输出 CSV 列：block,province,name,page,count（与 parse_kdocs_month.py 一致）。

用法：
  python dump_month_full.py
  → 优先读取同目录 _month_dump_map.json（{ "05": "<路径>", ... }）；
    若不存在则使用本文件内置 MAP（当前指向 _smp/ 样本，便于本地验证；
    真实全量时请把 MAP 改为自动化落盘的 4 个 .txt 路径，或写 _month_dump_map.json）。

注意：源文件路径如含中文，请以「文件字面量」方式写入（本脚本在文件内解析，无 argv 中文编码问题）。
"""
import os, json, csv

BASE = os.path.dirname(os.path.abspath(__file__))

# 内置映射（中文/长路径请写文件字面量；argv 传中文会触发编码问题，故不依赖命令行参数）。
# 当前指向样本 _smp/m05.txt..m08.txt；真实全量改为自动化落盘的 4 个 kdocs JSON(.txt) 路径即可。
MAP = {
    "05": os.path.join(BASE, "_smp", "m05.txt"),
    "06": os.path.join(BASE, "_smp", "m06.txt"),
    "07": os.path.join(BASE, "_smp", "m07.txt"),
    "08": os.path.join(BASE, "_smp", "m08.txt"),
}

MONTH_FILE = os.path.join(BASE, "_month_dump_map.json")
if os.path.exists(MONTH_FILE):
    try:
        with open(MONTH_FILE, encoding="utf-8") as f:
            _user = json.load(f)
        if isinstance(_user, dict) and _user:
            MAP = {k: v for k, v in _user.items() if v}
            print(f"  [dump] 使用外部映射 _month_dump_map.json：{list(MAP.keys())}")
    except Exception as e:
        print("  [dump] 读取 _month_dump_map.json 失败，回退内置 MAP：", e)


def parse_one(raw_path):
    with open(raw_path, encoding="utf-8") as f:
        data = json.load(f)
    detail = data.get("data", {}).get("detail", {}) or data.get("detail", {})
    rd = detail.get("rangeData", [])
    grid = {}
    for c in rd:
        grid[(c.get("rowFrom"), c.get("colFrom"))] = (c.get("cellText") or "").strip()
    rows = []
    if not grid:
        return rows
    maxr = max(r for (r, _) in grid.keys())
    for r in range(2, maxr + 1):  # 跳过 0/1 表头行
        cp = grid.get((r, 0), ""); cn = grid.get((r, 1), ""); cpg = grid.get((r, 2), ""); cc = grid.get((r, 3), "")
        if cpg:
            rows.append(("click", cp, cn, cpg, cc))
        vp = grid.get((r, 5), ""); vpg = grid.get((r, 6), ""); vc = grid.get((r, 7), "")
        if vpg:
            rows.append(("visitor", vp, "", vpg, vc))
        ep = grid.get((r, 9), ""); en = grid.get((r, 10), ""); epg = grid.get((r, 11), ""); ec = grid.get((r, 12), "")
        if epg:
            rows.append(("exposure", ep, en, epg, ec))
    return rows


def main():
    print("=== dump_month_full：平台分析-月 → _raw_month_*.csv ===")
    any_ok = False
    for mm in ("05", "06", "07", "08"):
        src = MAP.get(mm)
        out = os.path.join(BASE, "_raw_month_%s.csv" % mm)
        if not src or not os.path.exists(src):
            print(f"  [skip] {mm} 源文件缺失：{src}")
            continue
        rows = parse_one(src)
        if not rows:
            print(f"  [warn] {mm} 解析为 0 行：{src}")
            continue
        with open(out, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f)
            w.writerow(["block", "province", "name", "page", "count"])
            for row in rows:
                w.writerow(row)
        print(f"  [ok] _raw_month_{mm}.csv：{len(rows)} 行  <- {os.path.basename(src)}")
        any_ok = True
    print("=== 完成 ===" if any_ok else "=== 无可用源，请检查 MAP / _month_dump_map.json ===")


if __name__ == "__main__":
    main()
