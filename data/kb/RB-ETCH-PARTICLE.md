---
id: RB-ETCH-PARTICLE
title: ETCH-PARTICLE 颗粒超标告警处置手册
type: runbook
codes: ETCH-PARTICLE
tools: T-ETCH-07
updated: 2026-07-15
---

## 触发条件

在线颗粒检测发现单片晶圆上尺寸 ≥ 0.09 µm 的新增颗粒超过 30 颗时，触发 critical 级 ETCH-PARTICLE 告警。

## 立即动作

1. 立即暂停（hold）当前批次以及该腔体排队中的批次，防止缺陷扩散。
2. 对受影响批次做 100% 晶圆缺陷扫描，评估是否需要提交 MRB 报废评审。
3. 腔体停机，按 SOP-ETCH-012 执行湿法清洁（wet clean）。

## 常见根因

- 腔壁聚合物剥落（polymer flaking）：最常见，通常发生在 RF 功率漂移或 PM 逾期之后。
- 上电极或聚焦环（focus ring）磨损超过寿命。
- 腔盖 O 形圈老化导致微漏，引入外部颗粒。
- 晶圆传送机械手末端沾污。

晶圆缺陷图（wafer map）呈边缘环状分布时，优先怀疑腔壁剥落；呈随机散点时，优先检查传送系统。

## 放行标准

湿法清洁和腔体陈化（seasoning）完成后，颗粒测试片新增颗粒少于 10 颗且连续 2 片合格，才可恢复量产。
