# -*- coding: utf-8 -*-
"""把今日实时取数得到的 sheet5(内联) / sheet8(内联) 紧凑还原为 _raw_*.json。
仅保留 kdocs_to_csv.py 所需字段 rowFrom/colFrom/rowTo/colTo/originalCellValue。
数值与金山文档当前内容一致（取自本次 get_range_data 内联返回）。"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))


def build(grid):
    cells = []
    for r, row in enumerate(grid):
        for c, val in enumerate(row):
            if val is None or val == "":
                continue
            cells.append({
                "rowFrom": r, "colFrom": c, "rowTo": r, "colTo": c,
                "originalCellValue": val,
            })
    return {"code": 0, "message": "成功",
            "data": {"detail": {"rangeData": cells}}, "result": "ok"}


# sheet5 总览 1-7月调用量/节约人年/活跃智能体（内联实时值）
sheet5 = [
    ["月份", "调用量", "节约人年", "活跃智能体总数"],
    ["1月", 68434403, 180.5256722, 304],
    ["2月", 66801684, 159.1423717, 309],
    ["3月", 82433308, 173.9948696, 347],
    ["4月", 92177760, 168.1608547, 400],
    ["5月", 101083576, 186.1491044, 451],
    ["6月", 139627253, 210.9060843, 514],
    ["7月", 160105028, 278.76, 556],
    ["月均值", 101523287.428571, 193.948422414286, 411.571428571429],
]

# sheet8 多能力等效人年（内联实时值；8-12月/2026年行仅年累计列有值）
sheet8 = [
    ["数智化产品", "灵运平台", "RPA", "教练", "质检", "立单", "语音", "4项总计", "月累计"],
    ["1月", 0, 100.04, 22.36, 81.12, 9.526, 607.53, 811.05, 811.05],
    ["2月", 0, 89.55, 13.9, 54.93, 9.209, 677.11, 835.49, 1646.54],
    ["3月", 0, 88.33, 29.24, 81.84, 11.125, 734.34, 933.75, 2580.29],
    ["4月", 179.21, 96.86, 24.91, 82.06, 11.323, 777.39, 981.22, 3561.51],
    ["5月", 107.15, 101.22, 22.61, 84.79, 11.453, 757.6, 966.22, 4527.73],
    ["6月", 116.07, 99.68, 28.19, 82.95, 11.661, 741.32, 952.14, 5479.87],
    ["7月", 278.76, 102.95, 32.55, 84.68, 11.716, 682.36, 902.54, 6382.41],
    ["8月", None, None, None, None, None, None, 0, 6382.41],
    ["9月", None, None, None, None, None, None, 0, 6382.41],
    ["10月", None, None, None, None, None, None, 0, 6382.41],
    ["11月", None, None, None, None, None, None, 0, 6382.41],
    ["12月", None, None, None, None, None, None, 0, 6382.41],
    ["2026年", 681.19, 678.63, 173.76, 552.37, 76.013, 4977.65, 6382.41, None],
]

for name, grid in (("_raw_sheet5.json", sheet5), ("_raw_sheet8.json", sheet8)):
    path = os.path.join(BASE, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(build(grid), f, ensure_ascii=False)
    print("OK ->", name, "(cells=%d)" % sum(1 for row in grid for v in row if v not in (None, "")))
