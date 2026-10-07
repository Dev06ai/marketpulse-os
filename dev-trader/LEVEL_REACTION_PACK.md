# KYVORIQ Reaction Map — Dewald 2026-10-07

This map is a single source of truth for the Android chart and the backend reaction tracker.

## Exact horizontal levels transcribed from the supplied chart

- nPOC 89,409.5
- Daily 89,261.7
- nPOC 87,996.6
- Weekly nPOC 87,783.9
- Daily 86,482.8
- nPOC 85,563.9
- Daily - Tapped 84,482.8
- Support 84,193.3
- Daily 83,576.9
- Weekly nPOC 83,389.9
- Range POC 81,242.8
- Daily 81,143.9
- nPOC 80,463.9

## Order-block / supply zones

The screenshot does not expose precise top/bottom coordinates for the shaded rectangles, so these four bounds are stored as explicit estimates until original TradingView values are supplied:

- Supply Zone: 88,020–88,880
- 12H OB: 85,620–86,180
- 1H OB: 83,020–83,390
- Daily OB: 80,460–81,260

Every estimated zone is marked `estimated=true` in the data pack so it cannot be mistaken for an exact source value.

## Reaction policy

A mapped level or zone follows WATCH → ARMED → CONFIRMING → READY/TRIGGERED.

A raw touch never creates a trade candidate. The tracker requires a fresh directional reclaim/rejection after the level was already mapped and a minimum confirmation score of 3. Confirmation evidence can include wick rejection, market structure, CVD agreement, order-book imbalance, OI expansion, and SFP confluence.

Only after that does the normal KYVORIQ strategy pipeline evaluate the candidate through its existing quality, freshness, playbook, risk and demo-execution gates.

## Chart semantics

- nPOC / Range POC: red dotted lines
- Daily: green dotted lines
- Weekly nPOC / SFP: gold-yellow dotted lines
- Bullish demand / OB zones: translucent green
- Bearish supply / OB zones: translucent red
- OB zone borders and labels: white
- Manual level price tags are anchored on the right side of the chart.
