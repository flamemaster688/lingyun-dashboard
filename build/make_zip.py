# -*- coding: utf-8 -*-
"""打包灵运 BI 看板基座包为 zip（保留目录结构，剔除旧版本冗余）。

用法: python build/make_zip.py
产物: <项目根>/灵运BI看板_基座包.zip
"""
import os
import zipfile

ROOT = r"C:\Users\赵莹\WorkBuddy\2026-08-07-14-38-17"
SRC = os.path.join(ROOT, "lingyun_dashboard")
OUT = os.path.join(ROOT, "灵运BI看板_基座包.zip")
TOP = "灵运BI看板_基座包"

# static/ 内明确不发包的冗余/旧文件（v3/v8/v9 是历史版本，legacy 只需 v10）
EXCLUDE_STATIC_FILES = {
    "lingyun.app.v3.js",
    "lingyun.app.v8.js",
    "lingyun.app.v9.js",
    "style.v5.css",
    "README.md",
}
# 整目录排除（构建产物/缓存/无关）
EXCLUDE_DIRS = {".workbuddy", "__pycache__", "dist", "node_modules", ".git", "screenshots"}

# 项目根目录需要一并打包的文档（不在 lingyun_dashboard 内）
ROOT_DOCS = [
    "灵运BI看板_决策结论表.md",
    "灵运BI看板_多人协作搭建流程.md",
    "用WorkBuddy优化页面_指南.md",
]


def collect():
    files = []  # (abs_path, arc_path)
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            ap = os.path.join(dirpath, fn)
            rel = os.path.relpath(ap, SRC)  # e.g. static/index.html
            parts = rel.split(os.sep)
            if parts[0] == "static" and fn in EXCLUDE_STATIC_FILES:
                continue
            files.append((ap, os.path.join(TOP, rel)))
    for d in ROOT_DOCS:
        ap = os.path.join(ROOT, d)
        if os.path.exists(ap):
            files.append((ap, os.path.join(TOP, d)))
        else:
            print("[警告] 根文档缺失，跳过: " + d)
    return files


def main():
    files = collect()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for ap, arc in files:
            z.write(ap, arc)
    print("✓ 打包完成:", OUT)
    print("✓ 文件数:", len(files))


if __name__ == "__main__":
    main()
