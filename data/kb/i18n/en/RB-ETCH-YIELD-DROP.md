---
id: RB-ETCH-YIELD-DROP
title: ETCH-YIELD-DROP Etch Yield Below Control Limit Runbook
---

## Trigger

A critical ETCH-YIELD-DROP alert fires when an etch lot's yield falls below the 93% control limit. Lots below the 90% lower spec limit must go to MRB review (see SPEC-ETCH-B7).

## Procedure

Follow the yield excursion procedure SOP-YLD-003:

1. Within 2 hours, notify the yield engineer and the shift supervisor, and hold the following lots on the chamber.
2. Collect every alert on the tool from the last 72 hours, especially ETCH-RF-DRIFT, ETCH-PARTICLE and ETCH-GAS-RATIO.
3. Compare the yield trend of earlier and later lots on the same tool to tell a sudden excursion from steady degradation.
4. Pull the wafer defect maps of the low-yield lots and use the defect distribution to narrow the direction: an edge ring points to particles or wall flaking, the center area points to gas distribution or temperature.
5. Give a preliminary root cause within 24 hours and complete the 8D report within 7 days.

## Recovery conditions

After the root-cause actions are done, run 1 qualification lot first; the hold is lifted only if its yield is at least 95%.
