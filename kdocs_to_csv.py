# -*- coding: utf-8 -*-
"""
把 mcp__kdocs get_range_data 返回的 verbose JSON 转成 build_real.py 能读的
_raw_sheetN.csv（纯网格，含表头，按 originalCellValue 取值，合并单元格按矩形展开）。

用法：
  python kdocs_to_csv.py input.json output.csv
  cat input.json | python kdocs_to_csv.py - output.csv
"""
import sys, json, csv, io


def extract_range_data(obj):
    """从各种可能的 JSON 外层结构中取出 rangeData 单元格列表（递归，兼容任意嵌套层级）。"""
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict) and ("rowFrom" in obj[0] or "originalCellValue" in obj[0]):
            return obj
        for item in obj:
            r = extract_range_data(item)
            if r:
                return r
        return []
    if isinstance(obj, dict):
        if "rangeData" in obj and isinstance(obj["rangeData"], list):
            return obj["rangeData"]
        for v in obj.values():
            r = extract_range_data(v)
            if r:
                return r
        if "rowFrom" in obj or "originalCellValue" in obj:
            return [obj]
    return []


def to_grid(cells):
    """cells: list of cell dicts -> 2D list (rows of str)，合并单元格按矩形展开。"""
    max_r = 0
    max_c = 0
    pts = []
    for c in cells:
        r1 = int(c.get("rowFrom", 0))
        c1 = int(c.get("colFrom", 0))
        r2 = int(c.get("rowTo", r1))
        c2 = int(c.get("colTo", c1))
        # 取值优先级：originalCellValue（最完整）> understandableType.value > cellText
        val = c.get("originalCellValue")
        if val is None:
            ut = c.get("understandableType") or {}
            val = ut.get("value") if isinstance(ut, dict) else None
        if val is None:
            val = c.get("cellText")
        if val is None:
            val = ""
        pts.append((r1, c1, r2, c2, "" if val is None else str(val)))
        max_r = max(max_r, r2)
        max_c = max(max_c, c2)
    grid = [["" for _ in range(max_c + 1)] for _ in range(max_r + 1)]
    for r1, c1, r2, c2, v in pts:
        for r in range(r1, r2 + 1):
            for cc in range(c1, c2 + 1):
                grid[r][cc] = v
    return grid


def merge_grids(grids):
    """合并多个绝对定位网格（按行列位置叠加，非空覆盖空）。用于分段抓取后拼接。"""
    if not grids:
        return [[""]]
    max_r = max(len(g) for g in grids) - 1
    max_c = max((len(g[0]) if g else 0) for g in grids) - 1
    combined = [["" for _ in range(max_c + 1)] for _ in range(max_r + 1)]
    for g in grids:
        for r in range(len(g)):
            row = g[r]
            for c in range(len(row)):
                v = row[c]
                if v != "":
                    combined[r][c] = v
    return combined


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: kdocs_to_csv.py <input1.json> [input2.json ...] <output.csv>\n"
                         "       cat input.json | kdocs_to_csv.py - output.csv\n")
        sys.exit(2)
    out = sys.argv[-1]
    inputs = sys.argv[1:-1]
    grids = []
    for src in inputs:
        if src in ("-", "stdin"):
            raw = sys.stdin.read()
        else:
            with open(src, encoding="utf-8") as f:
                raw = f.read()
        obj = json.loads(raw)
        cells = extract_range_data(obj)
        if not cells:
            sys.stderr.write(f"WARN: 未在 {src} 中找到 rangeData，跳过\n")
            continue
        grids.append(to_grid(cells))
    if not grids:
        sys.stderr.write("ERROR: 未从任何输入中找到 rangeData 单元格\n")
        sys.exit(1)
    grid = merge_grids(grids) if len(grids) > 1 else grids[0]
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        for row in grid:
            w.writerow(row)
    sys.stderr.write(f"OK: {len(grid)} 行 × {len(grid[0]) if grid else 0} 列 -> {out}\n")


if __name__ == "__main__":
    main()
