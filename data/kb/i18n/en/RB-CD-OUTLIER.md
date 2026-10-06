---
id: RB-CD-OUTLIER
title: CD-OUTLIER Critical Dimension Alert Runbook
---

## Trigger

A CD-OUTLIER alert fires when a critical dimension (CD) measured on the CD-SEM falls outside the target ±3σ, or a single wafer deviates from the target by more than 2 nm.

## Step 1: Rule out metrology

About 30% of CD alerts are metrology false alarms (see INC-2603-01). First check the CD-SEM's golden wafer calibration record for the day, then remeasure the abnormal wafers with the same metrology recipe; a remeasurement difference below 0.5 nm means metrology is fine.

## Step 2: Trace upstream processes

Once metrology is confirmed, trace back along the wafer's process route:

- Etch: check etch time, endpoint curves and the process gas ratio. A high ETCH-GAS-RATIO makes sidewalls more sloped and CD smaller.
- Lithography: check exposure dose and focus records.

If the abnormal wafers all come from the same etch chamber, treat it as an etch problem first.

## Disposition

Hold the abnormal wafers; the process engineer decides on rework or scrap. If the same chamber shows CD-OUTLIER on 2 consecutive lots, notify the etch equipment engineer to take the tool down for inspection.
