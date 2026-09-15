# -*- coding: utf-8 -*-
"""
fetch-data.py —— 灵运 BI 看板 统一取数脚本（基座负责人·赵莹维护）
=====================================================================
职责：把多个「页面数据源」合并成单一 static/data.js（window.LINGYUN_DATA）。
页面本身绝不写取数逻辑（规避金山文档浏览器直连 CORS+鉴权限制）。

三种模式：
  1) extract   从现有 static/data.js 拆出 6 份 mock 到 build/mock/（离线开发用，一般只需跑一次）
  2) mock      合并 build/mock/*.json -> static/data.dev.js（不覆盖真实 data.js）
  3) merge     合并 build/sources/*.json -> static/data.js（真实取数后由赵莹执行，覆盖）

每个页面数据源声明在 pages/<id>.data-source.json（个人填 fileId/sheet/range）。
真实取数流程：赵莹用 kdocs 连接器按声明取数 -> 落盘 build/sources/<id>.json -> python fetch-data.py merge
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
BUILD = os.path.join(ROOT, "build")
MOCK_DIR = os.path.join(BUILD, "mock")
SRC_DIR = os.path.join(BUILD, "sources")
DATA_JS = os.path.join(STATIC, "data.js")
DATA_DEV = os.path.join(STATIC, "data.dev.js")

# 页面 -> 该页需要的业务域顶层键（与 data-contract.json / core/data.js 保持一致）
PAGE_DOMAINS = {
    "overview": ["meta", "overview", "capability", "agents", "provinces"],
    "agents":   ["meta", "agents", "tracking"],
    "tracking": ["meta", "tracking"],
    "province": ["meta", "provinces"],
    "quality":  ["meta", "centerYearRank", "capability"],
    "alarms":   ["meta", "alerts"],
}
OWNERS = {
    "overview": "吴超", "agents": "羽琪", "tracking": "赵莹",
    "province": "吴超", "quality": "赵莹", "alarms": "羽琪",
}


def load_data_js(path=DATA_JS):
    """读取 static/data.js，解析出 window.LINGYUN_DATA 对象。"""
    text = open(path, encoding="utf-8").read()
    marker = "window.LINGYUN_DATA = "
    i = text.index(marker) + len(marker)
    rest = text[i:].rstrip().rstrip(";").rstrip()
    return json.loads(rest)


def deep_merge(dst, src):
    """字典深合并；数组直接覆盖（不拼接），避免重复。"""
    for k, v in src.items():
        if k in dst and isinstance(dst[k], dict) and isinstance(v, dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def extract():
    """从真实 data.js 拆出 6 份 mock。"""
    if not os.path.exists(MOCK_DIR):
        os.makedirs(MOCK_DIR)
    data = load_data_js()
    for page, keys in PAGE_DOMAINS.items():
        out = {"page": page, "owner": OWNERS[page],
               "note": "mock 数据（由 extract 从真实 data.js 拆分，离线开发用；接真实金山文档后由赵莹覆盖）"}
        for k in keys:
            out[k] = data.get(k)
        with open(os.path.join(MOCK_DIR, page + ".json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print("  ✓ 写出 build/mock/%s.json（含 %s）" % (page, ",".join(keys)))
    print("extract 完成：6 份 mock 已生成于 build/mock/")


def collect_json_files(folder):
    files = []
    if not os.path.isdir(folder):
        return files
    for fn in sorted(os.listdir(folder)):
        if fn.endswith(".json"):
            files.append(os.path.join(folder, fn))
    return files


# 合并时要剔除的元数据键（mock 文件自带 page/owner/note，真实 source 文件不应含这些）
RESERVED_KEYS = {"page", "owner", "note"}


def build_from(folder, out_path, label):
    files = collect_json_files(folder)
    if not files:
        print("[跳过] %s 下没有 json 文件" % folder)
        return False
    merged = {}
    for fp in files:
        part = json.load(open(fp, encoding="utf-8"))
        deep_merge(merged, part)
    for k in RESERVED_KEYS:
        merged.pop(k, None)
    header = ("// 自动生成（%s）。请勿手改；由 build/fetch-data.py 生成。\n" % label)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header + "window.LINGYUN_DATA = ")
        json.dump(merged, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    keys = [k for k in merged.keys() if k != "meta"]
    print("  ✓ 合并 %d 个文件 -> %s（顶层键: %s）" % (len(files), out_path, ",".join(keys)))
    return True


def mock():
    print("[mock] 合并 build/mock/ -> %s（不覆盖真实 data.js）" % DATA_DEV)
    build_from(MOCK_DIR, DATA_DEV, "mock 数据")


def merge():
    print("[merge] 合并 build/sources/ -> %s（覆盖真实 data.js，仅赵莹在部署前执行）" % DATA_JS)
    build_from(SRC_DIR, DATA_JS, "真实数据")


USAGE = """用法：
  python build/fetch-data.py extract    # 从真实 data.js 拆 6 份 mock 到 build/mock/
  python build/fetch-data.py mock       # 合并 mock -> static/data.dev.js（不覆盖真实数据）
  python build/fetch-data.py merge      # 合并 build/sources/*.json -> static/data.js（部署前）
"""


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "extract":
        extract()
    elif cmd == "mock":
        mock()
    elif cmd == "merge":
        merge()
    else:
        print(USAGE)
