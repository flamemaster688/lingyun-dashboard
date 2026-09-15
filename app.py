import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from pathlib import Path
from wps_connector import load_kdocs, discover_live_file

# ---------- 页面配置 ----------
st.set_page_config(
    page_title="灵运平台 BI 数据看板",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------- 配色 ----------
C_PRIMARY = "#1c5f9e"
C_PRIMARY_L = "#5b9bd5"
C_TEAL = "#0f6e56"
C_TEAL_L = "#5dcaa5"
C_CORAL = "#e1574c"
C_AMBER = "#e8973a"
C_BG = "#eef3f8"
C_TEXT = "#1f2a37"

PLOT_COLORS = [C_PRIMARY, C_TEAL, C_CORAL, "#7F77DD", "#1D9E75", C_AMBER, "#378ADD", C_PRIMARY_L]

# ---------- 自定义主题 CSS ----------
CSS = """
<style>
:root{
  --primary:#1c5f9e; --primary-l:#5b9bd5; --teal:#0f6e56; --teal-l:#5dcaa5;
  --coral:#e1574c; --amber:#e8973a; --ink:#1f2a37; --muted:#6b7785;
  --bg:#eef3f8; --card:#ffffff; --border:#e6edf5;
}
[data-testid="stAppViewContainer"]{
  background:linear-gradient(180deg,#f4f8fc 0%, #eef3f8 100%);
}
[data-testid="stSidebar"]{
  background:#ffffff;
  border-right:1px solid #e6edf5;
}
[data-testid="stSidebar"] .sidebar-content{padding-top:0;}
.block-container{padding-top:1.2rem;padding-bottom:2rem;}
h1,h2,h3{color:#1f2a37;}

/* 隐藏默认标题留白 */
[data-testid="stHeader"]{background:transparent;}

/* Hero 顶部标题 */
.hero{
  display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(100deg,#1c5f9e 0%, #2f7fb8 55%, #0f6e56 130%);
  border-radius:16px;padding:18px 24px;color:#fff;
  box-shadow:0 8px 24px rgba(28,95,158,.18);margin-bottom:18px;
}
.hero-title{font-size:22px;font-weight:800;letter-spacing:.5px;}
.hero-sub{font-size:13px;opacity:.9;margin-top:4px;}
.hero-badge{
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);
  padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:600;white-space:nowrap;
}

/* 分区标题 */
.section-h{display:flex;align-items:center;gap:10px;margin:4px 0 14px;}
.section-h .bar{width:5px;height:20px;border-radius:3px;background:linear-gradient(180deg,#1c5f9e,#0f6e56);}
.section-h .txt{font-size:17px;font-weight:750;color:#1f2a37;}

/* KPI 卡片 */
.kpi-card{
  background:#fff;border-radius:14px;padding:15px 16px 13px;
  box-shadow:0 1px 3px rgba(20,40,80,.06),0 8px 20px rgba(20,40,80,.05);
  border:1px solid #e6edf5;height:100%;
}
.kpi-top{display:flex;align-items:center;gap:9px;margin-bottom:9px;}
.kpi-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;}
.kpi-label{font-size:12.5px;color:#6b7785;font-weight:600;letter-spacing:.2px;}
.kpi-value{font-size:23px;font-weight:800;color:#1f2a37;line-height:1.15;word-break:break-all;}
.kpi-delta{font-size:12px;font-weight:700;margin-top:7px;}
.kpi-delta.muted{color:#9aa7b4;font-weight:600;}

/* 洞察卡片 */
.insight-card{
  display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-radius:10px;
  font-size:13px;line-height:1.6;color:#33414f;margin:9px 0;
}

/* 图表卡片容器 */
.chart-card{
  background:#fff;border-radius:14px;padding:8px 10px 4px;
  box-shadow:0 1px 3px rgba(20,40,80,.05),0 8px 20px rgba(20,40,80,.04);
  border:1px solid #eef2f7;margin-bottom:14px;
}

/* 通用分隔 */
.divider{height:1px;background:#e2e9f1;margin:18px 0;}

/* 表格圆角 */
[data-testid="stDataFrame"]{border-radius:12px;overflow:hidden;border:1px solid #eef2f7;}

/* 侧边栏标题 */
.side-title{font-size:15px;font-weight:800;color:#1f2a37;margin:4px 0 2px;}
.side-sub{font-size:11.5px;color:#9aa7b4;margin-bottom:10px;}

/* Tab 美化 */
button[data-baseweb="tab"]{font-weight:650;font-size:14px;}
button[data-baseweb="tab"][aria-selected="true"]{color:#1c5f9e !important;}

/* 主按钮 */
button[data-testid="baseButton-primary"]{
  background:linear-gradient(100deg,#1c5f9e,#0f6e56) !important;
  border-radius:10px !important;font-weight:700 !important;
}

/* 页脚 */
.foot{text-align:center;color:#9aa7b4;font-size:12px;margin-top:24px;}
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)


# ---------- 数据加载 ----------
@st.cache_data(ttl=300)
def load_sample_data():
    base = Path(__file__).parent / "data"
    weekly = pd.read_csv(base / "weekly_overview.csv")
    province_weekly = pd.read_csv(base / "province_weekly.csv")
    agents = pd.read_csv(base / "agents.csv")
    pages = pd.read_csv(base / "pages.csv")
    alerts = pd.read_csv(base / "alerts.csv")
    quality = pd.read_csv(base / "quality_efficiency.csv")
    weekly["week_start"] = pd.to_datetime(weekly["week_start"])
    province_weekly["week_start"] = pd.to_datetime(province_weekly["week_start"])
    quality["week_start"] = pd.to_datetime(quality["week_start"])
    return weekly, province_weekly, agents, pages, alerts, quality


def detect_dataset(df: pd.DataFrame) -> str | None:
    cols = set(df.columns.str.lower())
    if {"alert_type", "severity"}.issubset(cols):
        return "alerts"
    if {"agent_id", "province", "calls"}.issubset(cols):
        return "agents"
    if {"page_name", "module", "clicks"}.issubset(cols):
        return "pages"
    if {"week_start", "province", "calls"}.issubset(cols):
        return "province_weekly"
    if {"week_start", "calls", "tokens"}.issubset(cols):
        return "weekly_overview"
    if {"week_start", "domain", "metric_name"}.issubset(cols):
        return "quality"
    return None


def read_uploaded(file):
    ext = file.name.split(".")[-1].lower()
    if ext == "csv":
        return pd.read_csv(file)
    return pd.read_excel(file)


# ---------- 侧边栏 ----------
st.sidebar.markdown('<div class="side-title">⚙️ 数据与控制</div>', unsafe_allow_html=True)
st.sidebar.markdown('<div class="side-sub">配置数据来源、时间范围与省份维度</div>', unsafe_allow_html=True)

source = st.sidebar.radio(
    "数据来源",
    ["使用样例数据", "上传自己的数据", "金山文档（本地同步）"],
    index=0,
    horizontal=True,
)

weekly, province_weekly, agents, pages, alerts, quality = load_sample_data()
data_source_label = "样例数据"

if source == "上传自己的数据":
    files = st.sidebar.file_uploader(
        "上传 CSV/Excel（支持多选，需包含 sample_data 同名字段）",
        type=["csv", "xlsx"],
        accept_multiple_files=True,
    )
    for f in files:
        try:
            df = read_uploaded(f)
            name = detect_dataset(df)
            if name == "weekly_overview":
                weekly = df.copy()
                weekly["week_start"] = pd.to_datetime(weekly["week_start"])
            elif name == "province_weekly":
                province_weekly = df.copy()
                province_weekly["week_start"] = pd.to_datetime(province_weekly["week_start"])
            elif name == "agents":
                agents = df.copy()
            elif name == "pages":
                pages = df.copy()
            elif name == "alerts":
                alerts = df.copy()
            elif name == "quality":
                quality = df.copy()
                quality["week_start"] = pd.to_datetime(quality["week_start"])
            else:
                st.sidebar.warning(f"{f.name} 未识别数据集类型，仅预览前 3 行。")
                st.sidebar.dataframe(df.head(3), use_container_width=True)
        except Exception as e:
            st.sidebar.error(f"{f.name} 读取失败：{e}")

elif source == "金山文档（本地同步）":
    st.sidebar.markdown("📁 读取 `data/live/` 下的标准模板 xlsx（默认 `灵运数据.xlsx`）")
    if st.sidebar.button("🔄 从金山文档刷新", type="primary", use_container_width=True):
        st.rerun()
    live_path = discover_live_file()
    if live_path is None:
        st.sidebar.error("未找到 data/live/ 下的 xlsx，请先在金山文档导出标准模板到该目录。")
    else:
        found, issues = load_kdocs(live_path)
        if issues:
            for it in issues:
                st.sidebar.warning(it)
        if found:
            if "weekly_overview" in found:
                weekly = found["weekly_overview"]
            if "province_weekly" in found:
                province_weekly = found["province_weekly"]
            if "agents" in found:
                agents = found["agents"]
            if "pages" in found:
                pages = found["pages"]
            if "alerts" in found:
                alerts = found["alerts"]
            if "quality_efficiency" in found:
                quality = found["quality_efficiency"]
            data_source_label = f"金山文档 · {live_path.name}"

st.sidebar.markdown("---")
st.sidebar.caption(f"当前数据源：{data_source_label}")
min_d = weekly["week_start"].min().date()
max_d = weekly["week_start"].max().date()
date_range = st.sidebar.date_input("📅 时间范围", value=(min_d, max_d), min_value=min_d, max_value=max_d)

all_provinces = sorted(province_weekly["province"].unique())
default_provinces = all_provinces[:10] if len(all_provinces) > 10 else all_provinces
sel_provinces = st.sidebar.multiselect("🌏 省份（多选）", all_provinces, default=default_provinces)

start_dt = pd.to_datetime(date_range[0])
end_dt = pd.to_datetime(date_range[1])

weekly_f = weekly[(weekly["week_start"] >= start_dt) & (weekly["week_start"] <= end_dt)].copy()
province_f = province_weekly[
    (province_weekly["week_start"] >= start_dt)
    & (province_weekly["week_start"] <= end_dt)
    & (province_weekly["province"].isin(sel_provinces))
].copy()
quality_f = quality[(quality["week_start"] >= start_dt) & (quality["week_start"] <= end_dt)].copy()

latest_week = weekly_f.iloc[-1] if not weekly_f.empty else weekly.iloc[-1]
prev_week = weekly_f.iloc[-2] if len(weekly_f) > 1 else latest_week
latest_date = latest_week["week_end"]


# ---------- 通用 UI 组件 ----------
def kpi_card(label, value, delta=None, good=True, accent=C_PRIMARY, icon="📊"):
    if delta is None:
        arrow, dcolor, dtxt = "•", "#9aa7b4", "—"
    else:
        s = str(delta)
        is_down = ("-" in s)
        arrow = "▼" if is_down else "▲"
        if good:
            dcolor = "#0f9d76" if not is_down else "#e1574c"
        else:
            dcolor = "#e1574c" if not is_down else "#0f9d76"
        dtxt = s
    html = f"""
    <div class="kpi-card" style="border-top:3px solid {accent}">
      <div class="kpi-top">
        <span class="kpi-icon" style="background:{accent}1f;color:{accent}">{icon}</span>
        <span class="kpi-label">{label}</span>
      </div>
      <div class="kpi-value">{value}</div>
      <div class="kpi-delta" style="color:{dcolor}">{arrow} {dtxt}</div>
    </div>"""
    return html


def section_h(title):
    return f'<div class="section-h"><span class="bar"></span><span class="txt">{title}</span></div>'


def insight_card(text, kind="info"):
    colors = {
        "info": (C_PRIMARY, "#eaf2fb", "💡"),
        "warning": (C_AMBER, "#fdf3e6", "⚠️"),
        "success": (C_TEAL, "#e8f6ef", "✅"),
        "danger": (C_CORAL, "#fdecea", "🚨"),
    }
    c, bg, ic = colors.get(kind, colors["info"])
    html = f'<div class="insight-card" style="border-left:4px solid {c};background:{bg}"><span>{ic}</span><span>{text}</span></div>'
    st.markdown(html, unsafe_allow_html=True)


def chart_card(fig, *, use_container_width=True):
    st.plotly_chart(fig, use_container_width=use_container_width)


def apply_theme(fig):
    fig.update_layout(
        template="plotly_white",
        font=dict(family="-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif", size=13, color="#1f2a37"),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.4)",
        margin=dict(l=46, r=22, t=52, b=42),
        xaxis=dict(gridcolor="#eef2f7", zeroline=False, showline=False),
        yaxis=dict(gridcolor="#eef2f7", zeroline=False, showline=False),
        colorway=PLOT_COLORS,
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.04, x=0, font=dict(size=12)),
    )
    return fig


def fmt_num(n, unit=""):
    if abs(n) >= 1e8:
        return f"{n/1e8:.2f}亿{unit}"
    if abs(n) >= 1e4:
        return f"{n/1e4:.1f}万{unit}"
    return f"{n:,.0f}{unit}"


def safe_delta(cur, prev, fmt="{:.1f}%"):
    if prev == 0 or pd.isna(prev):
        return None
    return fmt.format((cur - prev) / prev * 100)


# ---------- Hero 标题 ----------
st.markdown(
    f"""
    <div class="hero">
      <div>
        <div class="hero-title">📊 灵运平台 BI 数据看板</div>
        <div class="hero-sub">量质构效全景 · 一键生成看板与数据报告</div>
      </div>
      <div class="hero-badge">数据截至 {latest_date} ｜ 覆盖 {len(sel_provinces)} 省 ｜ 本周期 {len(weekly_f)} 周</div>
    </div>
    """,
    unsafe_allow_html=True,
)

# ---------- Tab 路由 ----------
tabs = st.tabs(["总览", "智能体", "埋点分析", "省份分析", "质效分析", "告警中心", "报告生成"])

# ====== 总览 ======
with tabs[0]:
    st.markdown(section_h("平台总览 · 量质构效全景"), unsafe_allow_html=True)
    c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
    with c1:
        st.markdown(kpi_card("总调用量", fmt_num(latest_week["calls"]), safe_delta(latest_week["calls"], prev_week["calls"]), icon="📞", accent=C_PRIMARY), unsafe_allow_html=True)
    with c2:
        st.markdown(kpi_card("Token 消耗", fmt_num(latest_week["tokens"]), safe_delta(latest_week["tokens"], prev_week["tokens"]), icon="🪙", accent=C_TEAL), unsafe_allow_html=True)
    with c3:
        st.markdown(kpi_card("活跃智能体", fmt_num(latest_week["active_agents"]), safe_delta(latest_week["active_agents"], prev_week["active_agents"]), icon="🤖", accent=C_PRIMARY_L), unsafe_allow_html=True)
    with c4:
        st.markdown(kpi_card("累计等效人年", f"{latest_week['person_year_saved_cum']:.0f} 人年", safe_delta(latest_week["person_year_saved_cum"], prev_week["person_year_saved_cum"]), icon="⏱️", accent=C_TEAL), unsafe_allow_html=True)
    with c5:
        st.markdown(kpi_card("页面访问量", fmt_num(latest_week["visits"]), safe_delta(latest_week["visits"], prev_week["visits"]), icon="👀", accent=C_PRIMARY), unsafe_allow_html=True)
    with c6:
        st.markdown(kpi_card("点击转化率", f"{latest_week['conversion_rate']:.1f}%", f"{latest_week['conversion_rate'] - prev_week['conversion_rate']:+.1f} pct", icon="🎯", accent=C_TEAL_L), unsafe_allow_html=True)
    with c7:
        sev_high = len(alerts[alerts["severity"] == "高"])
        st.markdown(kpi_card("高危告警", f"{sev_high} 条", None, good=False, icon="🚨", accent=C_CORAL), unsafe_allow_html=True)

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    col_left, col_right = st.columns(2)
    with col_left:
        fig = make_subplots(specs=[[{"secondary_y": True}]])
        fig.add_trace(go.Scatter(x=weekly_f["week_start"], y=weekly_f["calls"], name="调用量", mode="lines+markers", line=dict(color=C_PRIMARY, width=3), fill="tozeroy", fillcolor="rgba(28,95,158,.08)"), secondary_y=False)
        fig.add_trace(go.Scatter(x=weekly_f["week_start"], y=weekly_f["tokens"], name="Token 消耗", mode="lines+markers", line=dict(color=C_CORAL, width=3)), secondary_y=True)
        fig.update_layout(title="调用量与 Token 消耗趋势")
        fig.update_yaxes(title_text="调用量", secondary_y=False)
        fig.update_yaxes(title_text="Token 消耗", secondary_y=True)
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
        calls_growth = (latest_week["calls"] - weekly_f.iloc[0]["calls"]) / weekly_f.iloc[0]["calls"] * 100
        tokens_growth = (latest_week["tokens"] - weekly_f.iloc[0]["tokens"]) / weekly_f.iloc[0]["tokens"] * 100
        insight_card(f"Token 增速（{tokens_growth:.0f}%）显著高于调用量增速（{calls_growth:.0f}%），单次调用成本上升，建议启用 Prompt 优化与模型路由。" + (" ⚠️ Token 增速是调用量增速 2 倍以上" if tokens_growth > calls_growth * 2 else ""), kind="warning" if tokens_growth > calls_growth * 2 else "info")

    with col_right:
        fig2 = make_subplots(specs=[[{"secondary_y": True}]])
        fig2.add_trace(go.Bar(x=weekly_f["week_start"], y=weekly_f["clicks"], name="点击量", marker_color=C_PRIMARY_L), secondary_y=False)
        fig2.add_trace(go.Bar(x=weekly_f["week_start"], y=weekly_f["exposures"], name="曝光量", marker_color=C_TEAL_L), secondary_y=False)
        fig2.add_trace(go.Scatter(x=weekly_f["week_start"], y=weekly_f["conversion_rate"], name="转化率", mode="lines+markers", line=dict(color=C_CORAL, width=3)), secondary_y=True)
        fig2.update_layout(title="埋点流量与转化率趋势", barmode="group")
        fig2.update_yaxes(title_text="次数", secondary_y=False)
        fig2.update_yaxes(title_text="转化率 (%)", secondary_y=True)
        fig2 = apply_theme(fig2)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig2)
        st.markdown('</div>', unsafe_allow_html=True)
        visit_growth = (latest_week["visits"] - weekly_f.iloc[0]["visits"]) / weekly_f.iloc[0]["visits"] * 100
        insight_card(f"点击量/曝光量分别增长 {(latest_week['clicks']-weekly_f.iloc[0]['clicks'])/weekly_f.iloc[0]['clicks']*100:.0f}% / {(latest_week['exposures']-weekly_f.iloc[0]['exposures'])/weekly_f.iloc[0]['exposures']*100:.0f}%，但访问量仅变化 {visit_growth:.1f}%，增长主要由存量坐席重复使用标注任务拉动，拉新/留存是核心隐患。", kind="warning" if abs(visit_growth) < 5 else "info")

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    col_a, col_b = st.columns([2, 1])
    with col_a:
        prov_total = province_f.groupby("province")["calls"].sum().reset_index().sort_values("calls", ascending=True)
        fig3 = px.bar(prov_total.tail(15), x="calls", y="province", orientation="h", color="calls", color_continuous_scale="Blues", title="省份调用量 TOP15")
        fig3 = apply_theme(fig3)
        fig3.update_layout(coloraxis_showscale=False)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig3)
        st.markdown('</div>', unsafe_allow_html=True)
    with col_b:
        st.markdown(section_h("核心洞察"), unsafe_allow_html=True)
        top_prov = prov_total.iloc[-1]["province"]
        bottom_prov = prov_total.iloc[0]["province"]
        ratio = prov_total.iloc[-1]["calls"] / max(1, prov_total.iloc[0]["calls"])
        insight_card(f"头部省份 {top_prov} 与尾部省份 {bottom_prov} 调用量差距约 {ratio:.0f} 倍，需通过分层运营和模板推广缩小差距。", kind="warning" if ratio > 50 else "info")
        insight_card("平台月活持续增长，但部分页面使用率偏低，建议优化页面布局与功能入口。", kind="info")

# ====== 智能体 ======
with tabs[1]:
    st.markdown(section_h("智能体全景 · 活跃 / 推广 / 优秀 / 沉睡"), unsafe_allow_html=True)
    a1, a2, a3, a4, a5, a6 = st.columns(6)
    active_n = len(agents[agents["status"].isin(["活跃", "推广", "优秀"])])
    dormant_n = len(agents[agents["status"].isin(["沉睡", "待淘汰"])])
    with a1:
        st.markdown(kpi_card("活跃智能体", f"{active_n}", None, icon="🟢", accent=C_TEAL), unsafe_allow_html=True)
    with a2:
        st.markdown(kpi_card("优秀案例", f"{len(agents[agents['status']=='优秀'])}", None, icon="⭐", accent=C_PRIMARY), unsafe_allow_html=True)
    with a3:
        st.markdown(kpi_card("推广中", f"{len(agents[agents['status']=='推广'])}", None, icon="📣", accent=C_PRIMARY_L), unsafe_allow_html=True)
    with a4:
        st.markdown(kpi_card("沉睡/待淘汰", f"{dormant_n}", None, good=False, icon="💤", accent=C_CORAL), unsafe_allow_html=True)
    with a5:
        st.markdown(kpi_card("累计等效人年", f"{agents['person_year'].sum():.0f} 人年", None, icon="⏱️", accent=C_TEAL), unsafe_allow_html=True)
    with a6:
        top_agent = agents.loc[agents["person_year"].idxmax()]
        st.markdown(kpi_card("标杆智能体人年", f"{top_agent['person_year']:.0f} 人年", top_agent["agent_name"][:8], icon="🏆", accent=C_PRIMARY), unsafe_allow_html=True)

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    with c1:
        type_counts = agents["type"].value_counts().reset_index()
        fig = px.pie(type_counts, names="type", values="count", color="type", color_discrete_sequence=PLOT_COLORS, hole=0.45, title="智能体类型分布")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
    with c2:
        health_counts = agents["health_score"].value_counts().reindex(["A", "B", "C", "D"]).reset_index()
        colors = [C_TEAL, C_PRIMARY_L, C_AMBER, C_CORAL]
        fig = px.bar(health_counts, x="health_score", y="count", color="health_score", color_discrete_sequence=colors, title="智能体健康度分布")
        fig = apply_theme(fig)
        fig.update_layout(showlegend=False)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)

    c3, c4 = st.columns(2)
    with c3:
        top_agents = agents.nlargest(15, "person_year")[["agent_name", "person_year", "province", "health_score"]]
        fig = px.bar(top_agents, x="person_year", y="agent_name", orientation="h", color="health_score", color_discrete_sequence=PLOT_COLORS, title="智能体等效人年 TOP15")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
        insight_card(f"重庆「数智员工·灵运联动AI助手」单智能体年节约 {top_agent['person_year']:.0f} 人年，证明高质量智能体可复制推广价值巨大。", kind="success")
    with c4:
        status_counts = agents["status"].value_counts().reset_index()
        fig = px.bar(status_counts, x="status", y="count", color="status", color_discrete_sequence=PLOT_COLORS, title="智能体状态分布")
        fig = apply_theme(fig)
        fig.update_layout(showlegend=False)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
        insight_card(f"当前 {dormant_n} 个智能体处于沉睡/待淘汰状态，建议按 A/B/C/D 四级价值评估后清理下线，释放 Token 配额。重复来电场景存在 32 个省份各自建设、功能重叠，建议建立跨省共享市场。", kind="warning" if dormant_n > 20 else "info")

# ====== 埋点分析 ======
with tabs[2]:
    st.markdown(section_h("页面埋点分析 · 流量结构与转化效率"), unsafe_allow_html=True)
    m1, m2, m3, m4, m5 = st.columns(5)
    with m1:
        st.markdown(kpi_card("总点击量", fmt_num(pages["clicks"].sum()), None, icon="👆", accent=C_PRIMARY), unsafe_allow_html=True)
    with m2:
        st.markdown(kpi_card("总曝光量", fmt_num(pages["exposures"].sum()), None, icon="👁️", accent=C_TEAL_L), unsafe_allow_html=True)
    with m3:
        st.markdown(kpi_card("总访问量", fmt_num(pages["visits"].sum()), None, icon="🚪", accent=C_PRIMARY_L), unsafe_allow_html=True)
    with m4:
        avg_conv = pages["clicks"].sum() / pages["exposures"].sum() * 100
        st.markdown(kpi_card("整体转化率", f"{avg_conv:.1f}%", None, icon="🎯", accent=C_TEAL), unsafe_allow_html=True)
    with m5:
        low_pages = len(pages[pages["clicks"] < 50])
        st.markdown(kpi_card("低使用率页面", f"{low_pages} 个", None, good=False, icon="⚠️", accent=C_CORAL), unsafe_allow_html=True)

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    with c1:
        module_traffic = pages.groupby("module").agg({"clicks": "sum", "exposures": "sum", "visits": "sum"}).reset_index()
        module_traffic["conversion_rate"] = module_traffic["clicks"] / module_traffic["exposures"] * 100
        fig = px.treemap(module_traffic, path=["module"], values="clicks", color="conversion_rate", color_continuous_scale="Blues", title="菜单/模块点击量分布（面积=点击量，颜色=转化率）")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
    with c2:
        fig = px.bar(module_traffic.sort_values("conversion_rate"), x="conversion_rate", y="module", orientation="h", color="conversion_rate", color_continuous_scale="Teal", title="模块转化率对比")
        fig = apply_theme(fig)
        fig.update_layout(coloraxis_showscale=False)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)

    c3, c4 = st.columns(2)
    with c3:
        top_pages = pages.nlargest(12, "clicks")[["page_name", "module", "clicks", "conversion_rate"]]
        fig = px.bar(top_pages, x="clicks", y="page_name", orientation="h", color="module", color_discrete_sequence=PLOT_COLORS, title="高点击页面 TOP12")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
    with c4:
        low_pages_df = pages.nsmallest(12, "conversion_rate")[["page_name", "module", "conversion_rate", "exposures"]]
        fig = px.bar(low_pages_df, x="conversion_rate", y="page_name", orientation="h", color="module", color_discrete_sequence=PLOT_COLORS, title="低转化率页面 BOT12")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(section_h("埋点洞察"), unsafe_allow_html=True)
    lingxi_low = pages[(pages["module"] == "灵犀") & (pages["conversion_rate"] < 25)]
    if len(lingxi_low):
        insight_card(f"灵犀模块中「{lingxi_low.iloc[0]['page_name']}」转化率仅 {lingxi_low.iloc[0]['conversion_rate']:.1f}%，存在曝光浪费，建议精简配置链路并增加前端引导。", kind="warning")
    ai_qa = pages[pages["module"] == "AI问答"]
    if not ai_qa.empty:
        insight_card(f"AI 问答曝光 {ai_qa.iloc[0]['exposures']:,} 次但转化率 {ai_qa.iloc[0]['conversion_rate']:.1f}% 偏低，建议收敛曝光入口并加强坐席引导。", kind="warning")
    insight_card(f"全平台 {low_pages} 个页面近零使用（点击量<50），已识别并建议下线或合并，聚焦 40% 核心页面。", kind="info")

# ====== 省份分析 ======
with tabs[3]:
    st.markdown(section_h("省份分析 · 分层运营与对标"), unsafe_allow_html=True)
    prov_total = province_f.groupby(["province", "tier"]).agg({
        "calls": "sum", "tokens": "sum", "active_agents": "sum",
        "person_year_saved": "sum", "clicks": "sum", "visits": "sum"
    }).reset_index()
    prov_total["token_per_call"] = prov_total["tokens"] / prov_total["calls"]

    p1, p2, p3, p4 = st.columns(4)
    with p1:
        st.markdown(kpi_card("引领层省份", f"{len(prov_total[prov_total['tier']=='引领层'])}", None, icon="🥇", accent=C_PRIMARY), unsafe_allow_html=True)
    with p2:
        st.markdown(kpi_card("成长层省份", f"{len(prov_total[prov_total['tier']=='成长层'])}", None, icon="🥈", accent=C_TEAL_L), unsafe_allow_html=True)
    with p3:
        st.markdown(kpi_card("潜力层省份", f"{len(prov_total[prov_total['tier']=='潜力层'])}", None, icon="🥉", accent=C_AMBER), unsafe_allow_html=True)
    with p4:
        ratio = prov_total["calls"].max() / max(1, prov_total["calls"].min())
        st.markdown(kpi_card("头尾调用量差距", f"{ratio:.0f} 倍", None, good=False, icon="📐", accent=C_CORAL), unsafe_allow_html=True)

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    with c1:
        fig = px.bar(prov_total.sort_values("calls", ascending=True).tail(20), x="calls", y="province", orientation="h", color="tier", color_discrete_sequence=PLOT_COLORS, title="省份调用量排名 TOP20")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)
    with c2:
        tier_counts = prov_total["tier"].value_counts().reindex(["引领层", "成长层", "潜力层"]).reset_index()
        fig = px.pie(tier_counts, names="tier", values="count", color="tier", color_discrete_sequence=[C_PRIMARY, C_TEAL_L, C_AMBER], hole=0.5, title="省份分层结构")
        fig = apply_theme(fig)
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        chart_card(fig)
        st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(section_h("省份趋势对比（选择省份）"), unsafe_allow_html=True)
    default_trend = prov_total.nlargest(5, "calls")["province"].tolist()
    trend_provinces = st.multiselect("选择对比省份", sorted(province_f["province"].unique()), default=default_trend, key="trend_prov")
    trend_df = province_f[province_f["province"].isin(trend_provinces)]
    fig = px.line(trend_df, x="week_start", y="calls", color="province", color_discrete_sequence=PLOT_COLORS, title="省份调用量趋势对比", markers=True)
    fig = apply_theme(fig)
    st.markdown('<div class="chart-card">', unsafe_allow_html=True)
    chart_card(fig)
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(section_h("省份明细表"), unsafe_allow_html=True)
    st.dataframe(prov_total.sort_values("calls", ascending=False).reset_index(drop=True), use_container_width=True)
    insight_card("头部省份（广东、北京、浙江、江苏）应开放高级能力、输出标杆案例；成长层省份加速模板复制；潜力层省份需 1 对 1 运营对接与 Token 配额倾斜。", kind="info")

# ====== 质效分析 ======
with tabs[4]:
    st.markdown(section_h("质效分析 · 智能质检 / 教练 / 工单 / RPA"), unsafe_allow_html=True)
    domains = sorted(quality_f["domain"].unique())
    selected_domain = st.selectbox("选择业务域", domains)
    domain_df = quality_f[quality_f["domain"] == selected_domain]

    metrics = sorted(domain_df["metric_name"].unique())
    cols = st.columns(len(metrics)) if len(metrics) <= 4 else st.columns(4)
    for idx, metric in enumerate(metrics[:4]):
        sub = domain_df[domain_df["metric_name"] == metric]
        if sub.empty:
            continue
        cur = sub.iloc[-1]["value"]
        prev = sub.iloc[-2]["value"] if len(sub) > 1 else cur
        unit = sub.iloc[-1]["unit"]
        delta = f"{((cur-prev)/prev*100):+.1f}%" if prev else None
        with cols[idx]:
            st.markdown(kpi_card(metric, f"{cur:.1f}{unit}", delta, icon="📈", accent=C_TEAL), unsafe_allow_html=True)

    fig = px.line(domain_df, x="week_start", y="value", color="metric_name", color_discrete_sequence=PLOT_COLORS, title=f"{selected_domain} 关键指标趋势", markers=True)
    fig = apply_theme(fig)
    st.markdown('<div class="chart-card">', unsafe_allow_html=True)
    chart_card(fig)
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown(section_h("质效洞察"), unsafe_allow_html=True)
    if selected_domain == "智能质检":
        insight_card("质检合格率稳中有升，但部分省份违规点集中度仍高，建议推动问题整改闭环。")
    elif selected_domain == "智能教练":
        insight_card("教练覆盖率提升明显，但跟练完成率存在波动，建议按岗位分层推送课程并跟踪能力达标周期。")
    elif selected_domain == "智能工单":
        insight_card("工单自动解决率持续提升，高转人工业务需重点优化意图识别与知识库覆盖。")
    elif selected_domain == "RPA平台":
        insight_card("RPA 执行成功率保持在高位，失败重跑率下降说明流程稳定性改善，可继续扩大高价值流程覆盖。")

# ====== 告警中心 ======
with tabs[5]:
    st.markdown(section_h("告警中心 · 异常监控与行动建议"), unsafe_allow_html=True)
    sev_counts = alerts["severity"].value_counts().reindex(["高", "中", "低"]).fillna(0).astype(int)
    c1, c2, c3 = st.columns(3)
    with c1:
        st.markdown(kpi_card("🔴 高危告警", f"{sev_counts.get('高', 0)}", None, good=False, icon="⛔", accent=C_CORAL), unsafe_allow_html=True)
    with c2:
        st.markdown(kpi_card("🟡 中危告警", f"{sev_counts.get('中', 0)}", None, icon="⚠️", accent=C_AMBER), unsafe_allow_html=True)
    with c3:
        st.markdown(kpi_card("🟢 低危告警", f"{sev_counts.get('低', 0)}", None, icon="ℹ️", accent=C_TEAL), unsafe_allow_html=True)

    st.markdown('<div class="divider"></div>', unsafe_allow_html=True)
    severity_filter = st.multiselect("告警级别", ["高", "中", "低"], default=["高", "中", "低"])
    type_filter = st.multiselect("告警类型", sorted(alerts["alert_type"].unique()), default=sorted(alerts["alert_type"].unique()))
    filtered = alerts[(alerts["severity"].isin(severity_filter)) & (alerts["alert_type"].isin(type_filter))]
    st.dataframe(filtered[["alert_date", "severity", "alert_type", "province", "metric_name", "metric_value", "threshold", "suggestion"]], use_container_width=True)

# ====== 报告生成 ======
with tabs[6]:
    st.markdown(section_h("一键生成报告"), unsafe_allow_html=True)
    template = st.selectbox("报告模板", ["月度经营报告", "领导汇报精简版", "分中心下发通报"])

    if st.button("生成报告预览", type="primary"):
        calls_total = latest_week["calls"]
        tokens_total = latest_week["tokens"]
        agents_total = latest_week["active_agents"]
        py_total = latest_week["person_year_saved_cum"]
        conversion = latest_week["conversion_rate"]
        top3_prov = prov_total.nlargest(3, "calls")["province"].tolist()
        bottom3_prov = prov_total.nsmallest(3, "calls")["province"].tolist()

        if template == "月度经营报告":
            report = f"""# 灵运平台月度经营报告（{latest_date}）

## 一、平台总体表现
- 本周总调用量 **{fmt_num(calls_total)}**，Token 消耗 **{fmt_num(tokens_total)}**，活跃智能体 **{agents_total}** 个。
- 累计等效人年 **{py_total:.0f} 人年**，页面点击转化率 **{conversion:.1f}%**。

## 二、核心趋势
- Token 增速高于调用量增速，单次调用成本持续上升，需推进 Prompt 优化与模型路由。
- 点击量/曝光量增长主要由标注任务拉动，访问量增长停滞，拉新留存是下阶段重点。

## 三、省份运营
- 头部省份：{', '.join(top3_prov)}；尾部省份：{', '.join(bottom3_prov)}。
- 建议对潜力层省份派驻运营专员，优先部署高频场景模板。

## 四、下一步行动
1. 开展 Token 成本治理专项，目标单次调用 Token 降低 20%。
2. 上线人年监控大屏，对 D 级智能体评估后下线。
3. 推广重庆等高价值智能体标杆案例，形成跨省共享机制。
"""
        elif template == "领导汇报精简版":
            report = f"""# 灵运平台领导汇报（{latest_date}）

**整体健康度**：平台调用量与智能体数持续增长，但成本效率与拉新需关注。

| 指标 | 最新值 | 状态 |
|---|---|---|
| 调用量 | {fmt_num(calls_total)} | ✅ 增长 |
| Token 消耗 | {fmt_num(tokens_total)} | ⚠️ 增速过快 |
| 活跃智能体 | {agents_total} | ✅ 增长 |
| 点击转化率 | {conversion:.1f}% | ✅ 回升 |
| 访问量 | {fmt_num(latest_week['visits'])} | ⚠️ 停滞 |

**核心亮点**：重庆「数智员工·灵运联动AI助手」单智能体年节约 **148 人年**。

**需决策事项**：批准 Token 成本治理与沉睡智能体清理专项预算。
"""
        else:
            report = f"""# 分中心数据下发通报（{latest_date}）

各分中心：

本月灵运平台运营数据已生成，请结合本通报对标改进：

- 全国平均调用量：{fmt_num(prov_total['calls'].mean())}
- 全国平均活跃智能体：{prov_total['active_agents'].mean():.0f} 个
- 全国平均点击转化率：{prov_total['clicks'].sum()/prov_total['exposures'].sum()*100:.1f}%

**TOP3 分中心**：{', '.join(top3_prov)}
**待提升分中心**：{', '.join(bottom3_prov)}

请各分中心于下月 5 日前反馈改进计划，总部将组织优秀案例跨省推广。
"""
        st.markdown(report)
        st.download_button("下载 Markdown", report, file_name=f"灵运平台报告_{template}.md", mime="text/markdown")

# ---------- 页脚 ----------
st.markdown('<div class="foot">灵运平台 BI 数据看板 · 数据仅供演示，上传真实数据后可替换样例</div>', unsafe_allow_html=True)
