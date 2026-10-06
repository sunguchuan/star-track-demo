---
id: RB-ETCH-YIELD-DROP
title: ETCH-YIELD-DROP 刻蚀良率跌破控制限处置手册
type: runbook
codes: ETCH-YIELD-DROP
tools: T-ETCH-07
updated: 2026-07-15
---

## 触发条件

刻蚀工序批次良率低于控制限 93% 时，触发 critical 级 ETCH-YIELD-DROP 告警。低于规格下限 90% 的批次必须走 MRB 评审（见 SPEC-ETCH-B7）。

## 处理流程

按良率异常处理程序 SOP-YLD-003 执行：

1. 2 小时内通知良率工程师和值班主管，暂停该腔体的后续批次。
2. 汇总该机台最近 72 小时的所有告警，特别是 ETCH-RF-DRIFT、ETCH-PARTICLE 和 ETCH-GAS-RATIO。
3. 对比同机台前后批次的良率趋势，判断是突发还是持续恶化。
4. 调取低良率批次的晶圆缺陷图，按缺陷分布判断方向：边缘环状指向颗粒或腔壁剥落，中心区域指向气体分布或温度。
5. 24 小时内给出初步根因，7 天内完成 8D 报告。

## 恢复条件

根因措施完成后，先跑 1 批验证批（qualification lot），良率不低于 95% 才能解除暂停。
