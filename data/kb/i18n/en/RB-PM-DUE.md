---
id: RB-PM-DUE
title: PM-DUE Preventive Maintenance Due Runbook
---

## Trigger

An info-level PM-DUE alert fires when a tool is less than 48 hours away from its scheduled preventive maintenance (PM).

## Requirements

- The production planner must schedule a downtime window within 48 hours and avoid stopping in the middle of a critical lot.
- PM can be postponed by at most 72 hours, with equipment supervisor approval; tools past the grace period are locked automatically.
- Etch chambers schedule PM by accumulated RF hours; see SPEC-ETCH-B7 for the interval.

## Litho scanner PM content

Litho Scanner PM covers lens aberration calibration, wafer stage flatness check, alignment system baseline calibration and illumination uniformity test, and usually takes 8 hours. Requalification after PM follows SOP-LITHO-004.
