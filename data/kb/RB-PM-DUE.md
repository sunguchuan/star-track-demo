---
id: RB-PM-DUE
title: PM-DUE 预防性维护到期处置手册
type: runbook
codes: PM-DUE
tools: T-LITHO-01, T-ETCH-07
updated: 2026-02-11
---

## 触发条件

设备距离预防性维护（PM）计划时间不足 48 小时时，触发 info 级 PM-DUE 告警。

## 处理要求

- 生产计划员需在 48 小时内安排停机窗口，避免在关键批次中途停机。
- PM 最多可延期 72 小时，延期需设备主管审批；超过宽限期的设备自动锁机。
- 刻蚀腔体按 RF 累计时数安排 PM，周期见 SPEC-ETCH-B7。

## 光刻扫描仪 PM 内容

Litho Scanner 的 PM 包括镜头像差校准、工件台（wafer stage）平整度检查、对准系统基线校准和照明均匀性测试，通常需要 8 小时。PM 后的重新验证按 SOP-LITHO-004 执行。
