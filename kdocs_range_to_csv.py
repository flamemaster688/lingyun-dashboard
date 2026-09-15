# -*- coding: utf-8 -*-
"""
把 kdocs get_range_data 落盘的 JSON（超大，自动存盘）转换为 build_real.py 可消费的
_raw_month_<mm>.csv（列：block,province,name,page,count）。

每个月份 sheet 含 3 个并排 block：
  点击量   cols 0-3   province, NAME, PAGE, COUNT
  访客人数 cols 5-7   province, PAGE, count      (无 NAME)
  曝光次数 cols 9-12  province, NAME, PAGE, COUNT
（col 4 / col 8 为间隔空列；第 0-1 行为表头，数据从第 2 行起）

用法：
  python kdocs_range_to_csv.py <input.json> <output.csv>
"""
import sys, csv, json


def convert(inp, out):
    with open(inp, encoding="utf-8") as f:
        data = json.load(f)
    detail = data.get("data", {}).get("detail", {}) or data.get("detail", {})
    rd = detail.get("rangeData", [])
    grid = {}
    for c in rd:
        grid[(c.get("rowFrom"), c.get("colFrom"))] = (c.get("cellText") or "").strip()
    if not grid:
        print("  [warn] 空数据：", out)
        return 0
    maxr = max(r for (r, _) in grid.keys())
    rows = []
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
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["block", "province", "name", "page", "count"])
        for row in rows:
            w.writerow(row)
    print(f"  [ok] {out}：{len(rows)} 行")
    return len(rows)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: python kdocs_range_to_csv.py <input.json> <output.csv>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
