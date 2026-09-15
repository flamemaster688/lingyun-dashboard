"""
灵运平台 BI 看板样例数据生成器
数据量级、趋势与结构参考《灵运平台综合分析报告》及《页面埋点数据分析报告》。
"""
import pandas as pd
import numpy as np
from pathlib import Path

np.random.seed(42)

OUT_DIR = Path(__file__).parent

# 33 个省份，按报告分层
PROVINCES_TIER = {
    "引领层": ["广东", "北京", "浙江", "江苏"],
    "成长层": ["四川", "山东", "湖南", "湖北", "安徽", "河南", "河北", "福建", "上海", "陕西",
              "重庆", "辽宁", "江西", "云南", "广西"],
    "潜力层": ["西藏", "青海", "宁夏", "新疆", "海南", "甘肃", "贵州", "黑龙江", "吉林", "山西",
              "内蒙古", "天津", "台湾", "香港", "澳门"],
}
PROVINCES = [p for tier in PROVINCES_TIER.values() for p in tier]
TIER_MAP = {p: tier for tier, ps in PROVINCES_TIER.items() for p in ps}

# 10 周：2026-05-19 ~ 2026-07-21（周一为周起点）
WEEK_STARTS = pd.date_range(start="2026-05-19", periods=10, freq="W-MON")
WEEK_ENDS = WEEK_STARTS + pd.Timedelta(days=6)

# 智能体类型与状态
AGENT_TYPES = ["问答", "工单", "质检", "教练", "RPA", "交叉营销", "话术", "其他"]
AGENT_STATUSES = ["活跃", "推广", "优秀", "沉睡", "待淘汰"]
HEALTH_SCORES = ["A", "B", "C", "D"]

# 页面与模块
PAGE_MODULES = {
    "灵犀": ["应用发布", "内测白名单", "业务流程", "回放管理", "业务接口", "意图配置"],
    "标注": ["标注任务", "标注审核", "标注合并"],
    "AI问答": ["问答入口", "问答历史"],
    "智能体广场": ["热门推荐", "场景导航", "省份精选"],
    "管理后台": ["权限管理", "数据看板", "配置中心"],
    "个人中心": ["我的智能体", "使用记录"],
}


def generate_weekly_overview():
    """生成周级总览数据，趋势参考报告：Token 增速远高于调用量，点击增长但访问量停滞。"""
    base_calls = 1_200_000
    base_tokens = 3_800_000_000
    base_agents = 210
    rows = []
    for i, (s, e) in enumerate(zip(WEEK_STARTS, WEEK_ENDS)):
        # calls 10 周累计 +104% → 约每周 +7.4%
        calls = int(base_calls * (1.074 ** i) * np.random.uniform(0.95, 1.05))
        # tokens 10 周累计 +325% → 约每周 +15.6%
        tokens = int(base_tokens * (1.156 ** i) * np.random.uniform(0.96, 1.04))
        token_per_call = tokens / calls
        active_agents = int(base_agents * (1.05 ** i) * np.random.uniform(0.98, 1.02))
        new_agents = int(active_agents * np.random.uniform(0.05, 0.12))
        excellent_cases = int(5 + i * 1.2 + np.random.randint(-1, 3))
        person_year_saved_cum = int(280 + i * 45 + np.random.randint(-10, 15))

        # 埋点指标：首周 4374 click, 1218 visit, 12133 exposure, 转化率 36.1%;
        # 第5周左右触底 24.9%，末周 9796 click, 1206 visit, 26350 exposure, 转化率 37.2%
        clicks = int(np.interp(i, [0, 4, 9], [4374, 5150, 9796]) + np.random.normal(0, 250))
        visits = int(np.interp(i, [0, 9], [1218, 1206]) + np.random.normal(0, 70))
        exposures = int(np.interp(i, [0, 9], [12133, 26350]) + np.random.normal(0, 800))
        conversion_rate = float(np.interp(i, [0, 4, 9], [36.1, 24.9, 37.2]) + np.random.normal(0, 1.2))

        rows.append({
            "week_start": s.strftime("%Y-%m-%d"),
            "week_end": e.strftime("%Y-%m-%d"),
            "calls": calls,
            "tokens": tokens,
            "token_per_call": round(token_per_call, 1),
            "active_agents": active_agents,
            "new_agents": max(0, new_agents),
            "excellent_cases": max(0, excellent_cases),
            "person_year_saved_cum": person_year_saved_cum,
            "clicks": max(0, clicks),
            "visits": max(0, visits),
            "exposures": max(0, exposures),
            "conversion_rate": round(conversion_rate, 2),
        })
    return pd.DataFrame(rows)


def generate_province_weekly(weekly_df):
    """生成省份 × 周数据，头部省份占 60%+，尾部稀疏。"""
    rows = []
    # 省份权重：引领层 >> 成长层 > 潜力层
    weights = {p: {"引领层": 0.35, "成长层": 0.12, "潜力层": 0.03}[TIER_MAP[p]] for p in PROVINCES}
    weights_arr = np.array([weights[p] for p in PROVINCES])
    weights_arr = weights_arr / weights_arr.sum()

    for _, w in weekly_df.iterrows():
        total_calls = w["calls"]
        total_tokens = w["tokens"]
        total_clicks = w["clicks"]
        total_visits = w["visits"]
        total_exposures = w["exposures"]
        total_py = w["person_year_saved_cum"]

        calls_split = np.random.dirichlet(weights_arr * 2 + 0.5) * total_calls
        tokens_split = np.random.dirichlet(weights_arr * 2 + 0.3) * total_tokens
        clicks_split = np.random.dirichlet(weights_arr * 1.5 + 0.3) * total_clicks
        visits_split = np.random.dirichlet(weights_arr * 1.2 + 0.2) * total_visits
        exposures_split = np.random.dirichlet(weights_arr * 1.5 + 0.3) * total_exposures
        py_split = np.random.dirichlet(weights_arr * 2 + 0.2) * total_py
        agents_split = np.random.dirichlet(weights_arr * 1.8 + 0.2) * w["active_agents"]

        for j, prov in enumerate(PROVINCES):
            clicks = int(clicks_split[j])
            exposures = int(exposures_split[j])
            rows.append({
                "week_start": w["week_start"],
                "province": prov,
                "tier": TIER_MAP[prov],
                "calls": int(calls_split[j]),
                "tokens": int(tokens_split[j]),
                "active_agents": max(1, int(agents_split[j])),
                "person_year_saved": round(py_split[j], 1),
                "clicks": clicks,
                "visits": max(0, int(visits_split[j])),
                "exposures": exposures,
                "conversion_rate": round(min(0.95, clicks / max(1, exposures)) * 100, 2),
            })
    return pd.DataFrame(rows)


def generate_agents(n=260):
    """生成智能体清单，含高价值标杆与沉睡待淘汰样本。"""
    rows = []
    for i in range(n):
        prov = np.random.choice(PROVINCES, p=np.array([{"引领层": 0.25, "成长层": 0.45, "潜力层": 0.30}[TIER_MAP[p]] for p in PROVINCES]) / sum([{"引领层": 0.25, "成长层": 0.45, "潜力层": 0.30}[TIER_MAP[p]] for p in PROVINCES]))
        agent_type = np.random.choice(AGENT_TYPES, p=[0.22, 0.18, 0.12, 0.08, 0.10, 0.12, 0.12, 0.06])
        # 状态分布：活跃 60%，推广 15%，优秀 5%，沉睡 15%，待淘汰 5%
        status = np.random.choice(AGENT_STATUSES, p=[0.60, 0.15, 0.05, 0.15, 0.05])
        health = np.random.choice(HEALTH_SCORES, p=[0.20, 0.35, 0.30, 0.15])

        # 调整：优秀/推广多为 A/B，沉睡/待淘汰多为 C/D
        if status in ["优秀", "推广"] and health in ["C", "D"]:
            health = np.random.choice(["A", "B"])
        if status in ["沉睡", "待淘汰"] and health in ["A", "B"]:
            health = np.random.choice(["C", "D"])

        calls = int(np.random.lognormal(11, 1.5))  #  mostly 10k-200k
        tokens = int(calls * np.random.uniform(2000, 4500))
        # 等效人年 = calls * 单次节约分钟 / 年工作分钟
        minutes_saved_per_call = np.random.uniform(0.3, 2.5)
        person_year = calls * minutes_saved_per_call / (60 * 8 * 250)
        satisfaction = round(np.clip(np.random.normal(4.2 if health in ["A", "B"] else 3.5, 0.4), 1, 5), 2)

        # 故意生成一个 148 人年的标杆（重庆）和一个重复来电场景
        if i == 0:
            prov = "重庆"
            agent_type = "交叉营销"
            status = "优秀"
            health = "A"
            calls = 850_000
            tokens = calls * 2800
            person_year = 148.0
            satisfaction = 4.8
        if i == 1:
            agent_type = "话术"
            status = "活跃"

        rows.append({
            "agent_id": f"AGT{1000 + i}",
            "agent_name": f"{prov}-{agent_type}助手-{i + 1}" if i > 1 else ("数智员工·灵运联动AI助手" if i == 0 else "重复来电场景助手"),
            "province": prov,
            "type": agent_type,
            "status": status,
            "health_score": health,
            "calls": calls,
            "tokens": tokens,
            "person_year": round(person_year, 1),
            "satisfaction": satisfaction,
            "trend": np.random.choice(["上升", "平稳", "下降"], p=[0.45, 0.35, 0.20]),
        })
    return pd.DataFrame(rows)


def generate_pages():
    """生成页面埋点数据，复现灵犀模块转化率。"""
    rows = []
    for module, pages in PAGE_MODULES.items():
        for page in pages:
            # 参考灵犀表格量级
            if module == "灵犀" and page == "应用发布":
                exposures, clicks = 4156, 719
            elif module == "灵犀" and page == "意图配置":
                exposures, clicks = 1066, 655
            elif module == "灵犀" and page == "业务流程":
                exposures, clicks = 9473, 3090
            elif module == "标注":
                exposures = np.random.randint(3000, 15000)
                clicks = int(exposures * np.random.uniform(0.35, 0.55))
            elif module == "AI问答":
                exposures = np.random.randint(18000, 26000)
                clicks = int(exposures * np.random.uniform(0.03, 0.06))
            else:
                exposures = np.random.randint(200, 4000)
                clicks = int(exposures * np.random.uniform(0.10, 0.50))
            visits = int(clicks * np.random.uniform(0.6, 1.0))
            rows.append({
                "page_name": page,
                "module": module,
                "clicks": clicks,
                "exposures": exposures,
                "visits": visits,
                "conversion_rate": round(clicks / exposures * 100, 2),
                "trend": np.random.choice(["上升", "平稳", "下降"], p=[0.35, 0.40, 0.25]),
            })
    return pd.DataFrame(rows)


def generate_quality_efficiency(weekly_df):
    """生成智能质检 / 教练 / 工单 / RPA 的质效指标趋势。"""
    configs = {
        "智能质检": [("质检覆盖率", "%", 85, 95), ("质检合格率", "%", 92, 98), ("违规点闭环率", "%", 70, 90)],
        "智能教练": [("教练覆盖率", "%", 60, 85), ("跟练完成率", "%", 65, 88), ("能力达标率", "%", 55, 80)],
        "智能工单": [("工单自动解决率", "%", 45, 68), ("平均处理时长", " min", 8, 5), ("转人工率", "%", 25, 12)],
        "RPA平台": [("执行成功率", "%", 96, 99), ("节省工时", " h", 1200, 3600), ("失败重跑率", "%", 8, 3)],
    }
    rows = []
    for domain, metrics in configs.items():
        for i, (s, e) in enumerate(zip(WEEK_STARTS, WEEK_ENDS)):
            for metric, unit, start, end in metrics:
                # 指标在周期内从 start 改善到 end，带波动
                progress = i / max(1, len(WEEK_STARTS) - 1)
                base = start + (end - start) * progress
                noise = np.random.normal(0, abs(end - start) * 0.03)
                value = base + noise
                # 百分比类指标限制在 0-100
                if unit == "%":
                    value = max(0, min(100, value))
                rows.append({
                    "week_start": s.strftime("%Y-%m-%d"),
                    "domain": domain,
                    "metric_name": metric,
                    "value": round(value, 1),
                    "unit": unit,
                    "target": end,
                })
    return pd.DataFrame(rows)


def generate_alerts(weekly_df, agents_df, pages_df):
    """基于阈值生成告警。"""
    alerts = []
    latest = weekly_df.iloc[-1]
    prev = weekly_df.iloc[-2]

    # Token 增速超调用量增速
    calls_growth = (latest["calls"] - prev["calls"]) / prev["calls"]
    tokens_growth = (latest["tokens"] - prev["tokens"]) / prev["tokens"]
    if tokens_growth > calls_growth * 2:
        alerts.append({
            "alert_date": latest["week_end"],
            "alert_type": "Token 成本异常",
            "province": "全国",
            "metric_name": "Token 周环比增速",
            "metric_value": f"{tokens_growth*100:.1f}%",
            "threshold": f"调用量增速 {calls_growth*100:.1f}%",
            "severity": "高",
            "suggestion": "启用模型路由与 Prompt 模板优化，识别高 Token 智能体并针对性降本。",
        })

    # 访问量停滞
    if abs(latest["visits"] - prev["visits"]) / prev["visits"] < 0.05:
        alerts.append({
            "alert_date": latest["week_end"],
            "alert_type": "访问量停滞",
            "province": "全国",
            "metric_name": "最新周访问量",
            "metric_value": f"{latest['visits']:,}",
            "threshold": "环比变化 < 5%",
            "severity": "中",
            "suggestion": "加强灵犀等常态化产品拉新，避免增长仅依赖标注任务。",
        })

    # 沉睡/待淘汰智能体
    dormant = agents_df[agents_df["status"].isin(["沉睡", "待淘汰"])]
    if len(dormant) > 0:
        alerts.append({
            "alert_date": latest["week_end"],
            "alert_type": "智能体活跃度低",
            "province": "多省份",
            "metric_name": "沉睡/待淘汰智能体数",
            "metric_value": f"{len(dormant)} 个",
            "threshold": "连续低调用",
            "severity": "中",
            "suggestion": "对 D 级及沉睡智能体评估后下线或激活，释放 Token 配额。",
        })

    # 低使用率页面
    low_pages = pages_df[pages_df["clicks"] < 50]
    if len(low_pages) > 0:
        alerts.append({
            "alert_date": latest["week_end"],
            "alert_type": "低使用率页面",
            "province": "全国",
            "metric_name": "近零使用页面数",
            "metric_value": f"{len(low_pages)} 个",
            "threshold": "点击量 < 50",
            "severity": "低",
            "suggestion": "合并或下线无效页面，将运营资源聚焦核心场景。",
        })

    # 省份差距
    prov_latest = generate_province_weekly(weekly_df)
    prov_latest = prov_latest[prov_latest["week_start"] == latest["week_start"]]
    top = prov_latest["calls"].max()
    bottom = prov_latest["calls"].min()
    if top / bottom > 100:
        alerts.append({
            "alert_date": latest["week_end"],
            "alert_type": "省份发展不均",
            "province": f"{prov_latest.loc[prov_latest['calls'].idxmax(), 'province']} vs {prov_latest.loc[prov_latest['calls'].idxmin(), 'province']}",
            "metric_name": "头部/尾部调用量差距",
            "metric_value": f"{top/bottom:.0f} 倍",
            "threshold": "> 100 倍",
            "severity": "高",
            "suggestion": "对潜力层省份派驻运营对接，优先部署高频场景模板。",
        })

    return pd.DataFrame(alerts)


if __name__ == "__main__":
    weekly = generate_weekly_overview()
    province_weekly = generate_province_weekly(weekly)
    agents = generate_agents()
    pages = generate_pages()
    alerts = generate_alerts(weekly, agents, pages)

    quality = generate_quality_efficiency(weekly)

    weekly.to_csv(OUT_DIR / "weekly_overview.csv", index=False, encoding="utf-8-sig")
    province_weekly.to_csv(OUT_DIR / "province_weekly.csv", index=False, encoding="utf-8-sig")
    agents.to_csv(OUT_DIR / "agents.csv", index=False, encoding="utf-8-sig")
    pages.to_csv(OUT_DIR / "pages.csv", index=False, encoding="utf-8-sig")
    alerts.to_csv(OUT_DIR / "alerts.csv", index=False, encoding="utf-8-sig")
    quality.to_csv(OUT_DIR / "quality_efficiency.csv", index=False, encoding="utf-8-sig")

    print("样例数据已生成：")
    for f in ["weekly_overview.csv", "province_weekly.csv", "agents.csv", "pages.csv", "alerts.csv", "quality_efficiency.csv"]:
        print(f"  - {f}")
