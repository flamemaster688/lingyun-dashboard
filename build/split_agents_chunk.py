#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拆分 agentMonthly 为独立懒加载分块（性能修复）。

背景：
  static/data.js 中 agentMonthly（智能体逐月明细）约 22MB，占整个 data.js 的 95%+，
  但 7 个页面里只有「智能体」页用到它。首屏必须同步解析这 20MB+ 的对象字面量，
  主线程被冻结 1~3 秒，导致「数据加载不丝滑 / 点击不动」。

本脚本把 agentMonthly 抽出来，写成独立文件 static/data-agents.js
（window.LINGYUN_AGENT_MONTHLY = [...]），并重写 data.js 去掉该字段。
运行时由 core.js 的 ensureAgentMonthly 在「智能体」页打开时才异步加载分块。

用法：
  python build/split_agents_chunk.py
幂等：重复运行结果一致（每次基于原始 data.js 重新抽取，不二次抽取）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
DATA_JS = os.path.join(STATIC, "data.js")
CHUNK_JS = os.path.join(STATIC, "data-agents.js")

ASSIGN_PREFIX = "window.LINGYUN_DATA ="


def find_balanced(src, start_idx):
    """从 start_idx（应为 '{'）开始，括号配平找到对应的 '}' 位置（返回含该括号的切片结束索引）。"""
    depth = 0
    in_str = False
    esc = False
    i = start_idx
    n = len(src)
    while i < n:
        c = src[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"' or c == "'":
                in_str = False
            i += 1
            continue
        if c == '"' or c == "'":
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1  # 指向结束的 '}' 之后
        i += 1
    raise RuntimeError("未找到配平的 '}'")


def main():
    if not os.path.exists(DATA_JS):
        print("✗ 找不到 %s" % DATA_JS, file=sys.stderr)
        sys.exit(1)

    with open(DATA_JS, "r", encoding="utf-8") as f:
        src = f.read()

    p = src.find(ASSIGN_PREFIX)
    if p < 0:
        print("✗ %s 中未找到 %s" % (DATA_JS, ASSIGN_PREFIX), file=sys.stderr)
        sys.exit(1)

    brace = src.index("{", p)
    end = find_balanced(src, brace)
    obj_text = src[brace:end]  # 含首尾花括号
    tail = src[end:]  # 之后可能的尾部赋值（如 window.LY_OVERVIEW_PANORAMA = ...）

    try:
        data = json.loads(obj_text)
    except Exception as e:
        print("✗ 解析 LINGYUN_DATA 失败: %s" % e, file=sys.stderr)
        sys.exit(1)

    if "agentMonthly" not in data:
        print("ℹ  data.js 中已无 agentMonthly（可能已拆分过），跳过。")
        return

    agent_monthly = data.pop("agentMonthly")

    # 写入分块文件（紧凑、保留中文）
    chunk_payload = json.dumps(agent_monthly, ensure_ascii=False, separators=(",", ":"))
    with open(CHUNK_JS, "w", encoding="utf-8") as f:
        f.write("window.LINGYUN_AGENT_MONTHLY = ")
        f.write(chunk_payload)
        f.write(";\n")

    # 重写 data.js（去掉 agentMonthly），保留尾部赋值
    core_payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(DATA_JS, "w", encoding="utf-8") as f:
        f.write(ASSIGN_PREFIX + " ")
        f.write(core_payload)
        f.write(";\n")
        # 去掉尾部可能重复的 LINGYUN_DATA 赋值前缀（避免重复写 window.LINGYUN_DATA = ...）
        stripped = tail.lstrip()
        if stripped.startswith(ASSIGN_PREFIX):
            # 理论上不应出现：对象已结束，tail 只是赋值语句
            pass
        f.write(tail if tail.startswith("\n") else ("\n" + tail))

    print("✓ 已抽取 agentMonthly -> %s (%d 行, %.1f MB)"
          % (CHUNK_JS, len(agent_monthly), len(chunk_payload) / 1048576.0))
    print("✓ data.js 已精简（移除 agentMonthly）")


if __name__ == "__main__":
    main()
