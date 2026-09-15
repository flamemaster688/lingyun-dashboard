# -*- coding: utf-8 -*-
"""按调用顺序把 12 个平台周表 .txt 落盘为 _raw_platform_<label>.json，
并以 max(rowTo) 反查校验周标签映射是否与 get_sheets_info 的 rowTo 一致。"""
import json, os, shutil

BASE = os.path.dirname(os.path.abspath(__file__))
TR = "C:/Users/赵莹/.workbuddy/projects/c-Users-赵莹-WorkBuddy-2026-08-07-14-38-17-lingyun_dashboard/9878cbf9-d22b-4df7-8b3e-0e8eebea0881/tool-results"

# (周标签, .txt 文件名, get_sheets_info 探测 rowTo)
pairs = [
    ("0525-0531", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799297364-d4ee75.txt", 1001),
    ("0601-0607", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799293361-b4a750.txt", 1001),
    ("0608-0614", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799294670-6d04c8.txt", 1001),
    ("0615-0621", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799296486-e6ebe2.txt", 1001),
    ("0622-0628", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799294071-66673c.txt", 1001),
    ("0629-0705", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799295245-589ae2.txt", 1001),
    ("0706-0712", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799295876-e779eb.txt", 1001),
    ("0713-0719", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799298290-b6f31e.txt", 2652),
    ("0720-0726", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799305839-9d4a4e.txt", 4766),
    ("0727-0802", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799305801-c222a0.txt", 4531),
    ("0803-0809", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799303749-d1e343.txt", 3806),
    ("0810-0816", "mcp-connector-proxy-kdocs_sheet_get_range_data-1787799305768-562088.txt", 3840),
]

ok = True
for label, fn, expected in pairs:
    p = os.path.join(TR, fn)
    d = json.load(open(p, encoding="utf-8"))
    rd = d.get("data", {}).get("detail", {}).get("rangeData") or []
    maxr = max((c.get("rowTo", 0) for c in rd), default=-1)
    # 校验：请求 rowTo=expected+2，实际数据 max(rowTo) 应接近 expected（最后一行常为空)
    consistent = (maxr >= expected - 5)
    status = "OK " if consistent else "WARN"
    if not consistent:
        ok = False
    dst = os.path.join(BASE, "_raw_platform_%s.json" % label)
    shutil.copyfile(p, dst)
    print(f"{status} {label:10s} cells={len(rd):6d} maxRowTo={maxr:5d} (expected~{expected}) -> {os.path.basename(dst)}")

print("ALL_CONSISTENT" if ok else "MAPPING_CHECK_FAILED")
