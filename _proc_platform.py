# -*- coding: utf-8 -*-
"""Map framework-saved platform .txt files (by unique hash) to _raw_*.json and
verify the unique rowTo anchors so week/month labels are provably correct."""
import json, os, glob

BASE = r"C:/Users/赵莹/WorkBuddy/2026-08-07-14-38-17/lingyun_dashboard"
TR = (r"C:/Users/赵莹/.workbuddy/projects/"
      r"c-Users-赵莹-WorkBuddy-2026-08-07-14-38-17-lingyun_dashboard/"
      r"238206b2-a227-40fa-9ef5-35d4a8a730ae/tool-results")

# (hash, target_json, expected_maxRow, label)
weeks = [
    ("9ec83c", "_raw_platform_0522-0524.json", 1766, "0522-0524"),
    ("e733b9", "_raw_platform_0525-0531.json", 1001, "0525-0531"),
    ("2eda0c", "_raw_platform_0601-0607.json", 1001, "0601-0607"),
    ("4dd4a9", "_raw_platform_0608-0614.json", 1001, "0608-0614"),
    ("0846fa", "_raw_platform_0615-0621.json", 1001, "0615-0621"),
    ("2809a5", "_raw_platform_0622-0628.json", 1001, "0622-0628"),
    ("8d0ce6", "_raw_platform_0629-0705.json", 1001, "0629-0705"),
    ("870106", "_raw_platform_0706-0712.json", 1001, "0706-0712"),
    ("68573c", "_raw_platform_0713-0719.json", 2652, "0713-0719"),
    ("7e7e0f", "_raw_platform_0720-0726.json", 4766, "0720-0726"),
    ("6c3408", "_raw_platform_0727-0802.json", 4531, "0727-0802"),
    ("1ede84", "_raw_platform_0803-0809.json", 3806, "0803-0809"),
    ("01a6e2", "_raw_platform_0810-0816.json", 3840, "0810-0816"),
]
months = [
    ("695a65", "_raw_month_05.json", 1001, "05"),
    ("37356e", "_raw_month_06.json", 1001, "06"),
    ("6db309", "_raw_month_07.json", 1001, "07"),
    ("25e4a5", "_raw_month_08.json", 1001, "08"),
]


def process(hash_, target, exp_max, label):
    hits = glob.glob(os.path.join(TR, f"*mcp-connector-proxy-kdocs_sheet_get_range_data*-{hash_}.txt"))
    if not hits:
        raise SystemExit(f"NOT FOUND: hash={hash_} label={label}")
    p = hits[0]
    raw = open(p, encoding="utf-8").read().strip()
    d = json.loads(raw)
    rd = d.get("data", {}).get("detail", {}).get("rangeData", [])
    if not rd:
        raise SystemExit(f"NO rangeData {label}")
    mr = max((c.get("rowTo", 0) for c in rd), default=0)
    ok = (mr == exp_max)
    outp = os.path.join(BASE, target)
    json.dump(d, open(outp, "w", encoding="utf-8"), ensure_ascii=False)
    size = os.path.getsize(outp) // 1024
    tag = "VERIFY-OK" if ok else "!!! MISMATCH !!!"
    print(f"{tag} {target}: cells={len(rd)} maxRow={mr} exp={exp_max} size={size}KB")


for h, t, e, l in weeks:
    process(h, t, e, l)
for h, t, e, l in months:
    process(h, t, e, l)
print("DONE platform/months")
