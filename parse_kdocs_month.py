# -*- coding: utf-8 -*-
"""
把金山文档「平台分析-月」某月 sheet 的 get_range_data 结果（紧凑 JSON）转换为
build_real.py 可消费的 _raw_month_<mm>.csv。

每个 sheet 含 3 个并排 block：
  点击量   cols 0-3   province, NAME, PAGE, COUNT
  访客人数 cols 5-7   province, PAGE, count      (无 NAME)
  曝光次数 cols 9-12  province, NAME, PAGE, COUNT

输出 CSV 列：block,province,name,page,count
  block ∈ {click, visitor, exposure}
"""
import sys, json, csv, os


def main():
    if len(sys.argv) < 3:
        print("usage: parse_kdocs_month.py <raw.json> <out.csv>")
        sys.exit(1)
    raw_path, out_path = sys.argv[1], sys.argv[2]
    with open(raw_path, encoding="utf-8") as f:
        data = json.load(f)
    # 兼容两种外层结构
    detail = data.get("data", {}).get("detail", {}) or data.get("detail", {})
    rd = detail.get("rangeData", [])
    grid = {}
    for c in rd:
        grid[(c.get("rowFrom"), c.get("colFrom"))] = (c.get("cellText") or "").strip()

    rows = []
    if not grid:
        print("  [parse] 警告：未解析到任何单元格")
        return
    maxr = max(r for (r, _) in grid.keys())
    for r in range(2, maxr + 1):  # 跳过 0/1 表头行
        # 点击量 block cols 0-3
        cp = grid.get((r, 0), ""); cn = grid.get((r, 1), ""); cpg = grid.get((r, 2), ""); cc = grid.get((r, 3), "")
        if cpg:
            rows.append(("click", cp, cn, cpg, cc))
        # 访客人数 block cols 5-7（无 NAME）
        vp = grid.get((r, 5), ""); vpg = grid.get((r, 6), ""); vc = grid.get((r, 7), "")
        if vpg:
            rows.append(("visitor", vp, "", vpg, vc))
        # 曝光次数 block cols 9-12
        ep = grid.get((r, 9), ""); en = grid.get((r, 10), ""); epg = grid.get((r, 11), ""); ec = grid.get((r, 12), "")
        if epg:
            rows.append(("exposure", ep, en, epg, ec))

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["block", "province", "name", "page", "count"])
        for row in rows:
            w.writerow(row)
    print(f"  [parse] {out_path}: {len(rows)} 条记录")


if __name__ == "__main__":
    main()
