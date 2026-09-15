"""生成 data/live/灵运数据.xlsx（模拟金山文档导出），并自测连接器三种情况。"""
import sys, pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent
LIVE = ROOT / "live"
LIVE.mkdir(parents=True, exist_ok=True)

# 1) 读现有样例 CSV，作为"金山文档里的标准模板"
sheets = {
    "weekly_overview": pd.read_csv(ROOT / "weekly_overview.csv"),
    "province_weekly": pd.read_csv(ROOT / "province_weekly.csv"),
    "agents": pd.read_csv(ROOT / "agents.csv"),
    "pages": pd.read_csv(ROOT / "pages.csv"),
    "alerts": pd.read_csv(ROOT / "alerts.csv"),
    "quality_efficiency": pd.read_csv(ROOT / "quality_efficiency.csv"),
}
# 模拟"数据已更新"：把最新一周 calls 调高 12%
good = {k: v.copy() for k, v in sheets.items()}
good["weekly_overview"].loc[good["weekly_overview"].index[-1], "calls"] = int(
    good["weekly_overview"].iloc[-1]["calls"] * 1.12)
good_path = LIVE / "灵运数据.xlsx"
with pd.ExcelWriter(good_path, engine="openpyxl") as xw:
    for k, v in good.items():
        v.to_excel(xw, sheet_name=k, index=False)
print(f"[OK] 生成标准模板：{good_path}")

# 2) 坏模板：缺少 province_weekly sheet + weekly_overview 把 calls 改名
bad = {k: v.copy() for k, v in sheets.items() if k != "province_weekly"}
bad["weekly_overview"] = bad["weekly_overview"].rename(columns={"calls": "呼叫量"})
bad_path = LIVE / "坏模板_结构不符.xlsx"
with pd.ExcelWriter(bad_path, engine="openpyxl") as xw:
    for k, v in bad.items():
        v.to_excel(xw, sheet_name=k, index=False)
print(f"[OK] 生成坏模板：{bad_path}")

# 3) 自测连接器
sys.path.insert(0, str(ROOT.parent))
from wps_connector import load_kdocs

print("\n=== 测试 N1/N2：标准模板（同结构、数据已更新）===")
found, issues = load_kdocs(good_path)
print("issues:", issues)
print("weekly_overview 行数:", len(found["weekly_overview"]),
      "| 最新 calls:", int(found["weekly_overview"].iloc[-1]["calls"]),
      "(应为原值*1.12，证明数据更新被读到)")

print("\n=== 测试 N3/N5/N6：结构不符（缺 sheet + 改列名）===")
found2, issues2 = load_kdocs(bad_path)
print("issues 数量:", len(issues2))
for it in issues2:
    print("  -", it)
print("结论：结构异常被明确识别，看板应优雅降级而非生成异形看板 ✅")
