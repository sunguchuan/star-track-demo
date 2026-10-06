---
id: RB-CD-OUTLIER
title: CD-OUTLIER 关键尺寸异常告警处置手册
type: runbook
codes: CD-OUTLIER
tools: T-MET-03, T-ETCH-07
updated: 2026-05-20
---

## 触发条件

CD-SEM 量测的关键尺寸（CD）超出目标值 ±3σ，或单片偏离目标超过 2 nm，触发 CD-OUTLIER 告警。

## 第一步：排除量测问题

CD 告警约有三成是量测假警报（见 INC-2603-01）。先确认 CD-SEM 当天的标准片（golden wafer）校准记录，再用同一量测 recipe 对异常晶圆重测；重测偏差小于 0.5 nm 视为量测正常。

## 第二步：追溯上游工艺

量测确认无误后，按晶圆的工艺路径追溯：

- 刻蚀：检查刻蚀时间、终点检测（endpoint）曲线和工艺气体比例。ETCH-GAS-RATIO 偏高会使侧壁变斜、CD 变小。
- 光刻：检查曝光剂量和焦距（focus）记录。

如果异常晶圆都来自同一个刻蚀腔体，优先按刻蚀问题处理。

## 处置

异常晶圆暂停流转，由工艺工程师判定返工或报废。同一腔体连续 2 批出现 CD-OUTLIER，需要通知刻蚀设备工程师停机检查。
