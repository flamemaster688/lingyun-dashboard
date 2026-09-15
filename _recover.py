# -*- coding: utf-8 -*-
"""从线上已部署 data.js 的 agents 数组重建本地 _raw_sheet4.csv（恢复 178 智能体）。"""
import json, re, csv

txt = open('_deployed_data.js', encoding='utf-8').read()
m = re.search(r'window\.LINGYUN_DATA\s*=\s*(\{.*\})\s*;', txt, re.S)
data = json.loads(m.group(1))
agents = data['agents']
print("deployed agents count:", len(agents))

header = ["推广场景", "省份", "应用名称", "创建时间", "创建人", "场景",
          "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "总计", "备注"]
rows = [header]
for a in agents:
    monthly = a.get("monthly") or []
    monthly8 = (list(monthly) + [None] * 8)[:8]
    scenario = a.get("scenario") or ""
    if not scenario and a.get("types"):
        scenario = ",".join(a["types"])
    row = [
        a.get("group") or "",
        a.get("province") or "",
        a.get("name") or "",
        a.get("createdAt") or "",
        a.get("creator") or "",
        scenario,
    ] + ["" if v is None else v for v in monthly8] + [
        a.get("total") if a.get("total") is not None else "",
        a.get("note") or "",
    ]
    rows.append(row)

with open('_raw_sheet4.csv', 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    for r in rows:
        w.writerow(r)
print("wrote _raw_sheet4.csv, total rows (incl header):", len(rows))
