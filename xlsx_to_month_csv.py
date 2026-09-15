# -*- coding: utf-8 -*-
"""
将《用户行为记录》xlsx（每月一个 sheet：5/6/7/8 月，3 个并排 block：点击量/访客人数/曝光次数）
转换为 build_real.py 所需的 _raw_month_<mm>.csv（列：block,province,name,page,count）。

关键约定（与 build_real.py parse_month_csv 对齐）：
- 每个 sheet 前 2 行为说明行 / 列头行，从第 3 行起为数据。
- click  block：列 0-3 = province, NAME, PAGE, COUNT(1)
- visitor block：列 5-7 = province, PAGE, count(1)  —— 无 NAME 列，name 留空
- exposure block：列 9-12 = province, NAME, PAGE, COUNT(1)
- 三个 block 行数不一定对齐，因此按列区间独立抽取（与 build_real.py 按 block 独立聚合的消费方式一致）。
- 用户唯一键 = province + "-" + name（仅 click/exposure 含 name，用于 MAU 去重）。

用法：
  python xlsx_to_month_csv.py [xlsx路径] [--dry]
  默认 xlsx 路径为 ../../Temp/copyFile/用户行为记录(1)(1).xlsx（相对常见位置），--dry 只打印不写盘。
"""
import openpyxl, csv, os, sys, shutil

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_XLSX = r"C:/Users/赵莹/AppData/Local/Temp/copyFile/用户行为记录(1)(1).xlsx"
SHEET_TO_MM = {"5月": "05", "6月": "06", "7月": "07", "8月": "08"}


def clean(v):
    if v is None:
        return ""
    s = str(v).strip()
    return s


def clean_cnt(v):
    if v is None or v == "":
        return "0"
    if isinstance(v, (int, float)):
        f = float(v)
        return str(int(f)) if f.is_integer() else str(v)
    s = str(v).strip()
    try:
        f = float(s)
        return str(int(f)) if f.is_integer() else s
    except Exception:
        return s


def convert(xlsx_path, dry=False):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    summary = []
    for ws in wb.worksheets:
        mm = SHEET_TO_MM.get(ws.title)
        if not mm:
            print(f"  [跳过] 未识别的 sheet: {ws.title}")
            continue
        click, visitor, exposure = [], [], []
        for i, r in enumerate(ws.iter_rows(values_only=True)):
            if i < 2:
                continue  # 跳过 2 行表头
            if r is None:
                continue
            # click block cols 0-3
            if len(r) > 3 and r[2] not in (None, ""):
                click.append([clean(r[0]), clean(r[1]), clean(r[2]), clean_cnt(r[3])])
            # visitor block cols 5-7（无 name）
            if len(r) > 7 and r[6] not in (None, ""):
                visitor.append([clean(r[5]), "", clean(r[6]), clean_cnt(r[7])])
            # exposure block cols 9-12
            if len(r) > 12 and r[11] not in (None, ""):
                exposure.append([clean(r[9]), clean(r[10]), clean(r[11]), clean_cnt(r[12])])

        # MAU = click ∪ exposure 用户键去重
        keys = set()
        for prov, name, page, cnt in click:
            if name:
                keys.add(prov + "-" + name)
        for prov, name, page, cnt in exposure:
            if name:
                keys.add(prov + "-" + name)

        out_csv = os.path.join(BASE, "_raw_month_%s.csv" % mm)
        if dry:
            print(f"  [DRY] {ws.title} -> {os.path.basename(out_csv)} | click={len(click)} visitor={len(visitor)} exposure={len(exposure)} MAU={len(keys)}")
            continue

        # 备份原文件
        if os.path.exists(out_csv):
            bak = out_csv + ".bak"
            shutil.copy2(out_csv, bak)
            print(f"  [备份] {os.path.basename(out_csv)} -> {os.path.basename(bak)}")

        with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["block", "province", "name", "page", "count"])
            for row in click:
                w.writerow(["click"] + row)
            for row in visitor:
                w.writerow(["visitor"] + row)
            for row in exposure:
                w.writerow(["exposure"] + row)
        print(f"  [写入] {os.path.basename(out_csv)} | click={len(click)} visitor={len(visitor)} exposure={len(exposure)} MAU={len(keys)}")
        summary.append((mm, len(click), len(visitor), len(exposure), len(keys)))
    return summary


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    xlsx = args[0] if args else DEFAULT_XLSX
    print("xlsx:", xlsx, "| dry:", dry)
    convert(xlsx, dry=dry)
