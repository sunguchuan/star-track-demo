---
id: RB-ETCH-RF-DRIFT
title: ETCH-RF-DRIFT RF Power Drift Alert Runbook
---

## Trigger

A warn-level ETCH-RF-DRIFT alert fires when the etch chamber's RF forward or reflected power deviates from the recipe baseline by more than ±3%. A deviation beyond ±5%, or reflected power above 50 W for 3 consecutive wafers, escalates to critical and requires an immediate tool-down.

## Risks and related symptoms

Unstable RF power changes the plasma density, so etch rate and uniformity fluctuate. Power drift also accelerates polymer deposition and flaking on the chamber walls; historically it has often triggered ETCH-PARTICLE particle alerts 1–3 days later, which then pull yield down (see INC-2506-02). An acknowledged alert does not mean the root cause has been ruled out.

## Troubleshooting steps

1. Pull the RF forward / reflected power trends for the last 72 hours and tell whether the drift is a step change or a slow climb.
2. Check the tuning capacitor positions of the match network: a capacitor parked near the end of its travel means capacitor aging or matching failure.
3. Check RF cable connectors and grounding straps for looseness, heating or oxidation.
4. Calibrate the RF system per SOP-ETCH-021; after calibration the power deviation should be within ±1.5%.
5. After calibration, verify the etch rate with 3 monitor wafers; the deviation must be below 2%.

## Release criteria

The alert may be closed and volume production resumed only after 25 consecutive wafers stay within ±1.5% RF power deviation with no new particle alert in the same period. RF calibration must be completed within 24 hours of the alert; acknowledging it without acting is not allowed.

## Owners

Equipment engineers own troubleshooting and calibration; process engineers confirm the monitor wafer results.
