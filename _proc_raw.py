# -*- coding: utf-8 -*-
"""Validate the framework-saved .txt (raw kdocs JSON) files and copy them to _raw_*.json."""
import json, os

BASE = r"C:/Users/赵莹/WorkBuddy/2026-08-07-14-38-17/lingyun_dashboard"
TR = (r"C:/Users/赵莹/.workbuddy/projects/"
      r"c-Users-赵莹-WorkBuddy-2026-08-07-14-38-17-lingyun_dashboard/"
      r"238206b2-a227-40fa-9ef5-35d4a8a730ae/tool-results")

maps = {
    "_raw_sheet4.json": "mcp-connector-proxy-kdocs_sheet_get_range_data-1788486744384-b86696.txt",
    "_raw_sheet6.json": "mcp-connector-proxy-kdocs_sheet_get_range_data-1788486743707-2f707e.txt",
    "_raw_sheet7.json": "mcp-connector-proxy-kdocs_sheet_get_range_data-1788486743135-5be82a.txt",
    "_raw_center_2025.json": "mcp-connector-proxy-kdocs_sheet_get_range_data-1788486745540-7cacd3.txt",
    "_raw_center_2026.json": "mcp-connector-proxy-kdocs_sheet_get_range_data-1788486744951-a9a561.txt",
}

for out, fn in maps.items():
    p = os.path.join(TR, fn)
    with open(p, encoding="utf-8") as f:
        raw = f.read()
    # strip any stray leading/trailing whitespace/newlines
    raw = raw.strip()
    d = json.loads(raw)
    rd = d.get("data", {}).get("detail", {}).get("rangeData", [])
    if not rd:
        raise SystemExit(f"NO rangeData in {fn}")
    outp = os.path.join(BASE, out)
    with open(outp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    maxr = max((c.get("rowTo", 0) for c in rd), default=0)
    print(f"OK {out}: cells={len(rd)} maxRow={maxr} size={os.path.getsize(outp)//1024}KB")
print("ALL DONE")
