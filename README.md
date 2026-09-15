# 灵运平台 BI 数据看板

基于 Streamlit + Plotly 的灵运平台数据综合管理看板，支持样例数据演示与自定义数据上传。

## 功能模块

| Tab | 内容 |
|---|---|
| **总览** | 平台核心 KPI（调用量、Token、活跃智能体、人年、访问量、转化率）、趋势对比、省份 TOP15、核心洞察 |
| **智能体** | 智能体类型/状态/健康度分布、人年 TOP15、活跃/推广/优秀/沉睡智能体、标杆案例 |
| **埋点分析** | 页面点击量/曝光量/访问量/转化率、模块流量树图、页面排名、低使用率页面识别 |
| **省份分析** | 省份排名、分层结构、趋势对比、明细表，支持自定义省份筛选 |
| **质效分析** | 智能质检 / 智能教练 / 智能工单 / RPA 平台关键指标趋势 |
| **告警中心** | 自动识别 Token 成本异常、访问量停滞、智能体活跃度低、低使用率页面、省份发展不均 |
| **报告生成** | 一键生成月度经营报告、领导汇报精简版、分中心下发通报，支持 Markdown 下载 |

## 数据说明

- `data/*.csv` 为样例数据，量级与结构参考《灵运平台综合分析报告》及《页面埋点数据分析报告》。
- 侧边栏可切换为「上传自己的数据」，支持上传同字段结构的 CSV/Excel 文件，系统将自动识别数据集类型。

## 本地运行

```bash
# 安装依赖
pip install -r requirements.txt

# 启动
streamlit run app.py
```

启动后访问 http://localhost:8501。

## 生成新的样例数据

```bash
python data/generate_sample_data.py
```

## 上传数据字段说明

| 数据集 | 关键字段 |
|---|---|
| `weekly_overview.csv` | `week_start`, `calls`, `tokens`, `active_agents`, `person_year_saved_cum`, `clicks`, `visits`, `exposures`, `conversion_rate` |
| `province_weekly.csv` | `week_start`, `province`, `tier`, `calls`, `tokens`, `active_agents`, `person_year_saved`, `clicks`, `visits`, `exposures`, `conversion_rate` |
| `agents.csv` | `agent_id`, `agent_name`, `province`, `type`, `status`, `health_score`, `calls`, `tokens`, `person_year`, `satisfaction` |
| `pages.csv` | `page_name`, `module`, `clicks`, `exposures`, `visits`, `conversion_rate` |
| `alerts.csv` | `alert_date`, `alert_type`, `province`, `metric_name`, `metric_value`, `threshold`, `severity`, `suggestion` |
| `quality_efficiency.csv` | `week_start`, `domain`, `metric_name`, `value`, `unit`, `target` |
