---
id: RB-ETCH-GAS-RATIO
title: ETCH-GAS-RATIO Process Gas Ratio Alert Runbook
---

## Trigger

A warn-level ETCH-GAS-RATIO alert fires when the CF4/O2 flow ratio of the main etch step exceeds 1.65 (the warning line below the 1.7 spec limit).

## Impact

A high gas ratio raises the polymer generation rate: stronger sidewall passivation makes CD smaller, and faster chamber wall deposition shortens the clean interval and increases particle risk.

## Troubleshooting steps

1. Compare the recipe setpoints with the mass flow controller (MFC) readbacks; a deviation above 2% requires MFC calibration.
2. Check for recent recipe changes; recipe edits without engineering change (ECN) approval must be rolled back.
3. Check gas line pressure and the gas cylinder lot.
4. If needed, verify etch rate and CD with monitor wafers.

## Owners

Process engineers own the recipe check; equipment engineers own MFC calibration.
