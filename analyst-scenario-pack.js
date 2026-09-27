/*
  Analyst Scenario Pack
  ----------------------
  Source: MindPillar Markets — "WARNING BITCOIN UPDATE NOW!"
  Captured from supplied transcript + chart screenshots.
  These are analyst hypotheses, not guaranteed outcomes.

  IMPORTANT:
  - This pack is intentionally time-bounded.
  - Exact levels are source-time levels and should not remain active forever.
  - It can raise a WATCH/conditional opportunity but cannot bypass MarketPulse
    data-quality, confirmation, or risk gates.
*/

const PACK={
  id:"mindpillar-btc-warning-update-2026-09-25",
  source:"MindPillar Markets",
  symbol:"BTCUSDT",
  asOf:"2026-09-25T20:30:00Z",
  validHours:72,
  timeframeContext:["4h","50m","15m","5m"],
  higherTimeframe:{
    thesis:"4H uptrend from July may be a finished or nearly-finished impulse; swing-short interest increases near major resistance and a 0.382 retracement toward the mid-70Ks is an analyst target.",
    targetLow:75000,
    targetRationale:"0.382 Fibonacci retracement / fourth-wave sweep area"
  },
  structureModifiers:[
    {
      id:"WAVE2_TIME_EXTENSION",
      condition:"bullish_wave2_or_B_more_than_5x_wave1_time",
      effect:"REDUCE_BULLISH_CONFIDENCE",
      reason:"Analyst noted the local bullish interpretation is possible but structurally less ideal because wave 2/B is more than five times wave 1 in time."
    },
    {
      id:"C_EXTENSION_WARNING",
      condition:"candidate_C_extension_above_1.618",
      effect:"REDUCE_ABC_CONFIDENCE",
      reason:"Analyst flagged an extended C beyond 1.618 as a warning rather than an invalidation."
    },
    {
      id:"WAVE2_0_88_WARNING",
      condition:"candidate_wave2_retracement_near_0.88",
      effect:"REDUCE_IMPULSE_CONFIDENCE",
      reason:"Analyst flagged an 0.88 retracement as less ideal for an impulse count."
    },
    {
      id:"WXY_X_TRIANGLE_RARE",
      condition:"WXY_wave_X_is_triangle",
      effect:"REDUCE_WXY_CONFIDENCE",
      reason:"Analyst described that construction as possible but relatively uncommon and preferred a 50% retracement of W that was not reached."
    }
  ],
  zones:[
    {
      id:"VIDEO_R1",
      label:"85.7–85.9K Resistance Confluence",
      low:85700,
      high:85900,
      kind:"RESISTANCE",
      sources:["Range POC","2H order block","lower high / SFP","1.1 extension"],
      primaryAction:"SHORT",
      primaryTrigger:"Price reaches the zone and produces a rejection/sweep back below it.",
      alternateAction:"LONG",
      alternateTrigger:"Strong breakout through the zone with increasing volume/OI and positive delta, followed by a hold/retest.",
      invalidationText:"Clean acceptance above the zone without bearish rejection."
    },
    {
      id:"VIDEO_S1",
      label:"81–82K Major Support Confluence",
      low:81000,
      high:82000,
      kind:"SUPPORT",
      sources:["Daily level","Range POC","WXY / double-zigzag completion area"],
      primaryAction:"LONG",
      primaryTrigger:"Price slows into the zone and confirms a bullish reaction/reclaim.",
      alternateAction:"SHORT",
      alternateTrigger:"Support breaks decisively and the retest rejects from below.",
      invalidationText:"Clean acceptance below the entire zone."
    },
    {
      id:"VIDEO_L1",
      label:"83.683K Local Bull Defense",
      low:83600,
      high:83750,
      kind:"SUPPORT",
      sources:["5m higher-low defense","local liquidity level"],
      primaryAction:"LONG",
      primaryTrigger:"Bullish reclaim after a local sweep with confirmation.",
      alternateAction:"SHORT",
      alternateTrigger:"Level fails and price accelerates toward the lower liquidity pocket.",
      invalidationText:"Sustained acceptance below the local structure."
    },
    {
      id:"VIDEO_L2",
      label:"~82.832K Local Liquidity / Invalidation",
      low:82800,
      high:82900,
      kind:"SUPPORT",
      sources:["5m chart local low / liquidity"],
      primaryAction:"LONG",
      primaryTrigger:"Sweep-and-reclaim if the broader support thesis remains valid.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown and failed reclaim increases downside-continuation probability.",
      invalidationText:"Clean reclaim and hold above the level."
    },
    {
      id:"VIDEO_R2",
      label:"87K+ Higher-Price Resistance",
      low:87000,
      high:87500,
      kind:"RESISTANCE",
      sources:["4H higher swing-high area","fifth-wave / reversal zone"],
      primaryAction:"SHORT",
      primaryTrigger:"Price reaches the higher zone and prints a bearish reversal structure.",
      alternateAction:"LONG",
      alternateTrigger:"Strong impulsive breakout and acceptance above the zone.",
      invalidationText:"Sustained acceptance above the higher-timeframe resistance."
    }
  ],
  scenarios:[
    {
      id:"BEARISH_IMPULSE",
      bias:"BEARISH",
      thesis:"The lower-timeframe structure may already be the start of an impulse down.",
      confirmation:["lower high forms","support breaks with participation","retests fail","seller flow confirms"],
      invalidation:["strong reclaim of major resistance","impulse structure fails"],
      preferredZones:["VIDEO_R1","VIDEO_R2"]
    },
    {
      id:"ABC_OR_FLAT_CONTINUATION",
      bias:"BEARISH",
      thesis:"A three-wave rise can complete an A/B/C or flat before continuation lower.",
      confirmation:["rally reaches resistance","rejection develops","5-wave C structure appears","seller flow confirms"],
      invalidation:["clean bullish breakout with expanding participation"],
      preferredZones:["VIDEO_R1"]
    },
    {
      id:"WXY_SIDEWAYS",
      bias:"NEUTRAL_TO_BEARISH",
      thesis:"A sideways WXY remains possible; the X-wave construction and incomplete W retracement reduce confidence.",
      confirmation:["range persists","X/Y legs remain corrective","resistance continues to reject"],
      invalidation:["clean impulsive breakout with sustained acceptance"],
      preferredZones:["VIDEO_R1","VIDEO_S1"]
    },
    {
      id:"BULLISH_BREAKOUT",
      bias:"BULLISH",
      thesis:"The lower-timeframe bullish interpretation remains possible despite structural red flags.",
      confirmation:["high-volume breakout","positive delta","OI expansion/constructive participation","retest holds"],
      invalidation:["rejection at resistance","breakdown back into the range"],
      preferredZones:["VIDEO_R1","VIDEO_R2"]
    },
    {
      id:"SUPPORT_REACTION_LONG",
      bias:"BULLISH",
      thesis:"A slowdown and confirmed reaction in the 81–82K support area can support a long scenario.",
      confirmation:["slowdown","liquidity sweep/reclaim","bullish displacement","flow confirmation"],
      invalidation:["clean breakdown and failed reclaim"],
      preferredZones:["VIDEO_S1","VIDEO_L2"]
    }
  ],
  rule:"Use analyst levels as conditional context only. Never promote directly to a live directional signal without current MarketPulse confirmation and all safety gates."
};

function getActiveAnalystPack(now=Date.now()){
  const asOf=Date.parse(PACK.asOf);
  const expiresAt=asOf+PACK.validHours*3600000;
  const active=Number.isFinite(asOf)&&now<=expiresAt;
  return {
    ...PACK,
    active,
    expiresAt,
    status:active?"ACTIVE":"EXPIRED"
  };
}

module.exports={getActiveAnalystPack};
