---
id: RB-ETCH-PARTICLE
title: ETCH-PARTICLE Particle Excursion Alert Runbook
---

## Trigger

A critical ETCH-PARTICLE alert fires when inline particle inspection finds more than 30 added particles ≥ 0.09 µm on a single wafer.

## Immediate actions

1. Immediately hold the current lot and the lots queued for this chamber to stop the defects from spreading.
2. Run a 100% wafer defect scan on the affected lots and assess whether an MRB scrap review is needed.
3. Take the chamber down and perform a wet clean per SOP-ETCH-012.

## Common root causes

- Chamber wall polymer flaking: the most common cause, usually after RF power drift or an overdue PM.
- Upper electrode or focus ring worn beyond its lifetime.
- An aged chamber lid O-ring causing a micro-leak that lets in external particles.
- Contamination on the wafer transfer robot end effector.

When the wafer map shows an edge-ring pattern, suspect chamber wall flaking first; when it shows random scatter, check the transfer system first.

## Release criteria

After the wet clean and chamber seasoning, volume production may resume only when particle test wafers show fewer than 10 added particles on 2 consecutive wafers.
