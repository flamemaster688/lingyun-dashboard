# -*- coding: utf-8 -*-
"""
灵运 BI 看板 · 数据生成器
========================
把数据源（CSV 目录 或 金山文档导出的 xlsx）转换成前端用的 data.js。

用法：
  1) 用样例 CSV 生成：
     python build_data.py
  2) 用金山文档导出的 xlsx 生成：
     python build_data.py "data/live/灵运数据.xlsx"

输出：static/data.js  （window.LINGYUN_DATA = {...}）

约定（与看板模块固定绑定，勿改列名）：
  - weekly_overview : week_start,week_end,calls,tokens,token_per_call,active_agents,new_agents,excellent_cases,person_year_saved_cum,clicks,visits,exposures,conversion_rate
  - province_weekly : week_start,province,tier,calls,tokens,active_agents,person_year_saved,clicks,visits,exposures,conversion_rate
  - agents          : agent_id,agent_name,province,type,status,health_score,calls,tokens,person_year,satisfaction,trend
  - pages           : page_name,module,clicks,exposures,visits,conversion_rate,trend
  - quality         : week_start,domain,metric_name,value,unit,target
  - alerts          : alert_date,alert_type,province,metric_name,metric_value,threshold,severity,suggestion
"""
import sys
import os
import json
import csv

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE, "static")
DATA_DIR = os.path.join(BASE, "data")

# 数值列（转成 float / int），其余保持字符串
NUMERIC = {
    "weekly_overview": ["calls", "tokens", "token_per_call", "active_agents", "new_agents",
                        "excellent_cases", "person_year_saved_cum", "clicks", "visits",
                        "exposures", "conversion_rate"],
    "province_weekly": ["calls", "tokens", "active_agents", "person_year_saved", "clicks",
                        "visits", "exposures", "conversion_rate"],
    "agents": ["health_score", "calls", "tokens", "person_year", "satisfaction"],
    "pages": ["clicks", "exposures", "visits", "conversion_rate"],
    "quality": ["value", "target"],
    "alerts": [],
}


def to_number(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").replace("%", "").replace("倍", "").replace("个", "")
    s = s.replace("人年", "").replace("元", "").strip()
    if s == "" or s.lower() in ("nan", "none", "null"):
        return None
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return v  # 保留原始字符串（如 "2238 倍" 这类展示值）


def read_csv(path, key):
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            row = {}
            for k, v in r.items():
                if k is None:
                    continue
                k = k.strip()
                if k in NUMERIC[key]:
                    row[k] = to_number(v)
                else:
                    row[k] = v
            rows.append(row)
    return rows


# key -> 可能的 sheet 名（英文 / 金山文档中文导出名）
SHEET_ALIAS = {
    "weekly_overview": ["weekly_overview", "周总览", "总览", "weekly"],
    "province_weekly": ["province_weekly", "省份周", "省份", "province"],
    "agents": ["agents", "智能体", "agent"],
    "pages": ["pages", "页面", "埋点", "page"],
    "quality": ["quality", "quality_efficiency", "质效", "量质构效", "qe"],
    "alerts": ["alerts", "告警", "alert"],
}


def read_xlsx(path, key):
    """用 openpyxl 读取单个 sheet（按 SHEET_ALIAS 匹配 sheet 名）。"""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    sheet_names = wb.sheetnames
    aliases = SHEET_ALIAS.get(key, [key])
    target = None
    # 1) 精确包含匹配
    for sn in sheet_names:
        s = sn.strip()
        for a in aliases:
            if a.lower() in s.lower():
                target = sn
                break
        if target:
            break
    if target is None:
        # 2) 退回第一组顺序
        target = sheet_names[0]
    ws = wb[target]
    rows = []
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(it)]
    for r in it:
        if all(c is None for c in r):
            continue
        row = {}
        for i, h in enumerate(header):
            if h == "":
                continue
            v = r[i] if i < len(r) else None
            if h in NUMERIC[key]:
                row[h] = to_number(v)
            else:
                row[h] = "" if v is None else v
        rows.append(row)
    wb.close()
    return rows


def load_source(src):
    """返回 dict: key -> list[dict]"""
    out = {}
    keys = ["weekly_overview", "province_weekly", "agents", "pages", "quality", "alerts"]
    if src and src.lower().endswith(".xlsx"):
        for k in keys:
            try:
                out[k] = read_xlsx(src, k)
            except Exception as e:
                print(f"  [warn] sheet {k} 读取失败: {e}")
                out[k] = []
    else:
        file_map = {"quality": "quality_efficiency"}
        for k in keys:
            fname = file_map.get(k, k)
            p = os.path.join(DATA_DIR, f"{fname}.csv")
            if os.path.exists(p):
                out[k] = read_csv(p, k)
            else:
                out[k] = []
    return out


def build_meta(data):
    weeks = sorted({r.get("week_start") for r in data["weekly_overview"] if r.get("week_start")})
    provinces = sorted({r.get("province") for r in data["province_weekly"] if r.get("province")})
    return {
        "weeks": weeks,
        "provinces": provinces,
        "tiers": sorted({r.get("tier") for r in data["province_weekly"] if r.get("tier")}),
        "generatedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
        "source": "sample" if not SRC else "xlsx",
    }


def main():
    global SRC
    SRC = sys.argv[1] if len(sys.argv) > 1 else None
    print("读取数据源 ...")
    data = load_source(SRC)
    for k, v in data.items():
        print(f"  - {k}: {len(v)} 行")
    meta = build_meta(data)
    payload = {
        "meta": meta,
        "weekly": data["weekly_overview"],
        "provinceWeekly": data["province_weekly"],
        "agents": data["agents"],
        "pages": data["pages"],
        "quality": data["quality"],
        "alerts": data["alerts"],
    }
    os.makedirs(STATIC_DIR, exist_ok=True)
    out_path = os.path.join(STATIC_DIR, "data.js")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// 自动生成，请勿手改。重新生成：python build_data.py\n")
        f.write("window.LINGYUN_DATA = ")
        f.write(json.dumps(payload, ensure_ascii=False, indent=1))
        f.write(";\n")
    print(f"已生成: {out_path}")


if __name__ == "__main__":
    SRC = None
    main()
