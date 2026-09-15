import json, os, shutil
BASE = r"C:/Users/赵莹/WorkBuddy/2026-08-07-14-38-17/lingyun_dashboard"
TR = r"C:/Users/赵莹/.workbuddy/projects/c-Users-赵莹-WorkBuddy-2026-08-07-14-38-17-lingyun_dashboard/2c0b4133-4d43-437f-9bb5-338e5c110511/tool-results"
paths = [
 ("0522-0524","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405024758-f6ffd4.txt"),
 ("0525-0531","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405027795-18eacc.txt"),
 ("0601-0607","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405028564-a923cd.txt"),
 ("0608-0614","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405027053-22bb09.txt"),
 ("0615-0621","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405025394-a7cdd6.txt"),
 ("0622-0628","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405029169-5f8e81.txt"),
 ("0629-0705","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405026299-f5e282.txt"),
 ("0706-0712","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405023804-5e3449.txt"),
 ("0713-0719","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405030347-aacce0.txt"),
 ("0720-0726","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405037835-137141.txt"),
 ("0727-0802","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405037797-1a184d.txt"),
 ("0803-0809","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405033810-c931e9.txt"),
 ("0810-0816","mcp-connector-proxy-kdocs_sheet_get_range_data-1788405037762-1081c8.txt"),
]
for label, fn in paths:
    src = os.path.join(TR, fn)
    dst = os.path.join(BASE, "_raw_platform_%s.json" % label)
    shutil.copyfile(src, dst)
    d = json.load(open(dst, encoding="utf-8"))
    c = d["data"]["detail"]["rangeData"]
    print("cp _raw_platform_%s.json  cells=%d maxRow=%d" % (label, len(c), max(x.get("rowTo",0) for x in c)))
print("DONE 13 weeks")
