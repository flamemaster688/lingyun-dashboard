"""
金山文档数据连接器（MVP：本地同步文件模式）

设计原则：
- 金山文档只是数据源；看板模块（7 个 Tab）由 app.py 定死。
- 本模块只负责：读取标准模板 xlsx → 校验 6 个固定 sheet 的结构 → 清洗类型 → 返回 6 张 DataFrame。
- 任何结构不符都返回明确的 issues 列表，由 app.py 优雅降级，绝不生成异形看板。

标准模板（6 个 sheet，列名固定）：
  weekly_overview / province_weekly / agents / pages / alerts / quality_efficiency
"""
from pathlib import Path
import pandas as pd

# 项目内放置金山文档导出文件的位置（或金山文档 PC 客户端同步到此路径）
LIVE_DIR = Path(__file__).parent / "data" / "live"
LIVE_PATH = LIVE_DIR / "灵运数据.xlsx"

# 标准模板：sheet 名 -> 必需列
EXPECTED_SHEETS = {
    "weekly_overview": ["week_start", "week_end", "calls", "tokens", "active_agents",
                          "visits", "clicks", "exposures", "conversion_rate", "person_year_saved_cum"],
    "province_weekly": ["week_start", "province", "tier", "calls", "tokens",
                          "active_agents", "person_year_saved", "clicks", "visits"],
    "agents": ["agent_id", "agent_name", "type", "status", "province", "health_score", "person_year"],
    "pages": ["page_name", "module", "clicks", "exposures", "visits", "conversion_rate"],
    "alerts": ["alert_date", "severity", "alert_type", "province", "metric_name",
               "metric_value", "threshold", "suggestion"],
    "quality_efficiency": ["week_start", "domain", "metric_name", "value", "unit"],
}


def coerce_types(df: pd.DataFrame, sheet: str) -> pd.DataFrame:
    """按 sheet 做基础类型清洗，尽量容忍真实表格里的脏数据。"""
    df = df.copy()
    for col in df.columns:
        if col in ("week_start", "week_end", "alert_date"):
            df[col] = pd.to_datetime(df[col], errors="coerce")
        else:
            # 数值列：去掉逗号、空白、无法解析的填 NaN
            if df[col].dtype == object:
                sample = df[col].dropna().astype(str).head(20)
                looks_numeric = sample.str.replace(r"[,，]", "", regex=True).str.replace(
                    r"[^\d.\-]", "", regex=True).str.replace(".", "", regex=False).str.isdigit().mean()
                if looks_numeric and len(sample) > 0:
                    df[col] = pd.to_numeric(
                        df[col].astype(str).str.replace(r"[,，]", "", regex=True), errors="coerce")
    return df


def validate_workbook(xls: pd.ExcelFile):
    """校验工作簿结构，返回 (found_dict, issues_list)。"""
    issues = []
    found = {}
    for sheet, cols in EXPECTED_SHEETS.items():
        if sheet not in xls.sheet_names:
            issues.append(f"缺失数据表（sheet）：{sheet}")
            continue
        df = xls.parse(sheet)
        missing = [c for c in cols if c not in df.columns]
        if missing:
            issues.append(f"表「{sheet}」缺少必需列：{', '.join(missing)}")
            # 即使缺列也保留已读到的部分，便于降级展示
        found[sheet] = coerce_types(df, sheet)
    return found, issues


def load_kdocs(path=LIVE_PATH):
    """
    读取金山文档导出的标准模板 xlsx。
    返回 (data_dict, issues)：
      - data_dict 含 6 张 df（键名同 EXPECTED_SHEETS）
      - issues 非空代表结构异常，调用方应优雅降级
    """
    path = Path(path)
    if not path.exists():
        return None, [f"未找到金山文档同步文件：{path}\n请将金山文档导出为 xlsx 放到 data/live/ 目录（默认名 灵运数据.xlsx）。"]
    try:
        xls = pd.ExcelFile(path)
    except Exception as e:
        return None, [f"文件读取失败（可能不是合法 xlsx）：{e}"]
    found, issues = validate_workbook(xls)
    return found, issues


def discover_live_file():
    """在 data/live/ 下自动发现 xlsx（支持非标准文件名）。"""
    if LIVE_PATH.exists():
        return LIVE_PATH
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    xs = sorted(LIVE_DIR.glob("*.xlsx"))
    return xs[0] if xs else None
