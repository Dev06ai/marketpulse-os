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

const CURRENT_VISUAL_PACK={
  id:"dewald-thiart-btc-visual-scenarios-2026-09-27",
  source:"Dewald Thiart — supplied BTC chart screenshots",
  symbol:"BTCUSDT",
  asOf:"2026-09-27T17:09:00Z",
  validHours:24,
  timeframeContext:["8h","1h"],
  higherTimeframe:{
    thesis:"Bullish alternative shows BTC continuing the rising-channel wave sequence toward a possible wave-5 extension; bearish alternative shows a corrective/WXY decline into the marked Fibonacci/support ladder.",
    wave5Target:100000,
    channelRetest:"Watch the rising channel for a wave-4 style reaction before a possible wave-5 continuation."
  },
  zones:[
    {
      id:"VISUAL_R1_85224",
      label:"1H WXY 85,224 resistance anchor",
      low:85150,
      high:85275,
      kind:"RESISTANCE",
      sources:["1H WXY 0 level","B-wave high / structural resistance"],
      primaryAction:"SHORT",
      primaryTrigger:"Price rejects/sweeps the 85,224 area and closes back below with bearish confirmation.",
      alternateAction:"LONG",
      alternateTrigger:"Clean acceptance above 85,224 followed by a bullish retest with participation.",
      invalidationText:"Sustained acceptance above the resistance anchor."
    },
    {
      id:"VISUAL_S1_82792",
      label:"1H WXY 0.618 reaction level",
      low:82750,
      high:82835,
      kind:"SUPPORT",
      sources:["0.618 Fibonacci"],
      primaryAction:"LONG",
      primaryTrigger:"Downside leg reaches the level and produces a confirmed bullish reaction/reclaim.",
      alternateAction:"SHORT",
      alternateTrigger:"Decisive breakdown and failed reclaim.",
      invalidationText:"Acceptance below the level after failed reclaim."
    },
    {
      id:"VISUAL_S2_82131",
      label:"1H WXY 0.786 reaction level",
      low:82090,
      high:82170,
      kind:"SUPPORT",
      sources:["0.786 Fibonacci"],
      primaryAction:"LONG",
      primaryTrigger:"Confirmed slowdown/sweep and bullish reclaim.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown with failed retest.",
      invalidationText:"Acceptance below the level."
    },
    {
      id:"VISUAL_S3_81289",
      label:"1H WXY 1.0 structural level",
      low:81245,
      high:81335,
      kind:"SUPPORT",
      sources:["1.0 Fibonacci / structural target"],
      primaryAction:"LONG",
      primaryTrigger:"Strong reaction and reclaim at the structural target.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown and failed reclaim, opening the next extension targets.",
      invalidationText:"Sustained acceptance below the structural level."
    },
    {
      id:"VISUAL_S4_80360",
      label:"1H WXY 1.236 extension",
      low:80320,
      high:80410,
      kind:"SUPPORT",
      sources:["1.236 Fibonacci extension"],
      primaryAction:"LONG",
      primaryTrigger:"Confirmed bullish reaction.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown/retest failure.",
      invalidationText:"Acceptance below the extension level."
    },
    {
      id:"VISUAL_S5_79796",
      label:"1H WXY 1.382 extension",
      low:79755,
      high:79835,
      kind:"SUPPORT",
      sources:["1.382 Fibonacci extension"],
      primaryAction:"LONG",
      primaryTrigger:"Confirmed bullish reaction.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown/retest failure.",
      invalidationText:"Acceptance below the extension level."
    },
    {
      id:"VISUAL_S6_78857",
      label:"1H WXY 1.618 extension",
      low:78810,
      high:78905,
      kind:"SUPPORT",
      sources:["1.618 Fibonacci extension"],
      primaryAction:"LONG",
      primaryTrigger:"Confirmed bullish reaction.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown/retest failure.",
      invalidationText:"Acceptance below the extension level."
    },
    {
      id:"VISUAL_S7_77354",
      label:"1H WXY 2.0 extension",
      low:77305,
      high:77405,
      kind:"SUPPORT",
      sources:["2.0 Fibonacci extension"],
      primaryAction:"LONG",
      primaryTrigger:"Confirmed bullish reaction.",
      alternateAction:"SHORT",
      alternateTrigger:"Breakdown/retest failure.",
      invalidationText:"Acceptance below the extension level."
    },
    {
      id:"VISUAL_CHANNEL_4",
      label:"Rising-channel wave-4 reaction area",
      low:79000,
      high:82000,
      kind:"SUPPORT",
      sources:["8H/HTF rising channel","bullish wave-4 projection"],
      primaryAction:"LONG",
      primaryTrigger:"Price reaches the rising channel, slows, and confirms a bullish wave-4 style reaction/reclaim.",
      alternateAction:"SHORT",
      alternateTrigger:"Channel breakdown with failed reclaim invalidates the bullish continuation idea and supports the bearish corrective path.",
      invalidationText:"Clean breakdown and failed reclaim of the rising channel."
    },
    {
      id:"VISUAL_BEAR_75K",
      label:"Bearish-option major support",
      low:74450,
      high:75350,
      kind:"SUPPORT",
      sources:["Bearish chart green support zone","projected corrective destination"],
      primaryAction:"LONG",
      primaryTrigger:"Price reaches the marked support zone and gives a confirmed reversal reaction.",
      alternateAction:"SHORT",
      alternateTrigger:"Support breaks and the retest fails, extending the bearish structure.",
      invalidationText:"Sustained acceptance below the zone."
    }
  ],
  scenarios:[
    {
      id:"VISUAL_HTF_BULL_WAVE5",
      bias:"BULLISH",
      thesis:"The most bullish chart scenario is a rising-channel hold/wave-4 reaction followed by a wave-5 continuation toward roughly 100K.",
      confirmation:["channel support holds","wave-4 style corrective reaction resolves upward","breakout/impulse confirmation","volume/flow supports continuation"],
      invalidation:["channel breakdown and failed reclaim"],
      preferredZones:["VISUAL_CHANNEL_4"]
    },
    {
      id:"VISUAL_1H_WXY_BEARISH",
      bias:"BEARISH",
      thesis:"The 1H chart shows a WXY-style corrective alternative from the 85,224 area, with the C/Y leg potentially progressing down the marked Fibonacci ladder.",
      confirmation:["85,224 area rejects","lower-timeframe bearish structure confirms","downside levels are reached with continuation/retest failure"],
      invalidation:["clean acceptance above 85,224 with bullish continuation"],
      preferredZones:["VISUAL_R1_85224","VISUAL_S1_82792","VISUAL_S2_82131","VISUAL_S3_81289"]
    },
    {
      id:"VISUAL_BEARISH_SUPPORT_LADDER",
      bias:"BEARISH",
      thesis:"If the WXY downside develops, use the marked Fib ladder as sequential reaction/continuation checkpoints rather than assuming every level must break.",
      confirmation:["level breaks with body-close and participation","failed reclaim at the broken level"],
      invalidation:["strong bullish reaction that reclaims the prior level and changes structure"],
      preferredZones:["VISUAL_S4_80360","VISUAL_S5_79796","VISUAL_S6_78857","VISUAL_S7_77354","VISUAL_BEAR_75K"]
    }
  ],
  chartNotes:[
    "First supplied chart shows a rising HTF channel with waves 1–4 and a projected wave 5 near the 100K area.",
    "Second supplied chart shows a bearish alternative with projected chop/downside into the green support zone around 75K.",
    "Third supplied chart is labeled 1 Hour - WXY and marks 85,224 as the upper reference plus the visible Fibonacci targets."
  ],
  rule:"These chart annotations are conditional scenario context. MarketPulse must still require live reaction, market structure, order flow, data quality and risk gates before a directional signal."
};

function getActiveAnalystPack(now=Date.now()){
  const packs=[PACK,CURRENT_VISUAL_PACK];
  const activePacks=packs.map(p=>{
    const asOf=Date.parse(p.asOf);
    const expiresAt=asOf+p.validHours*3600000;
    return {...p,active:Number.isFinite(asOf)&&now<=expiresAt,expiresAt,status:Number.isFinite(asOf)&&now<=expiresAt?"ACTIVE":"EXPIRED"};
  });
  const active=activePacks.filter(p=>p.active);
  return {
    id:active.map(p=>p.id).join("+")||"none",
    source:active.map(p=>p.source).join(" + ")||"none",
    sources:active.map(p=>p.source),
    symbol:"BTCUSDT",
    active:active.length>0,
    status:active.length?"ACTIVE":"EXPIRED",
    asOf:active.map(p=>p.asOf).sort().at(-1)||null,
    expiresAt:active.length?Math.max(...active.map(p=>p.expiresAt)):null,
    timeframeContext:[...new Set(active.flatMap(p=>p.timeframeContext||[]))],
    zones:active.flatMap(p=>(p.zones||[]).map(z=>({...z,sourcePackId:p.id,source:p.source,asOf:p.asOf,expiresAt:p.expiresAt}))),
    scenarios:active.flatMap(p=>(p.scenarios||[]).map(x=>({...x,sourcePackId:p.id,source:p.source,asOf:p.asOf,expiresAt:p.expiresAt}))),
    structureModifiers:active.flatMap(p=>p.structureModifiers||[]),
    higherTimeframe:active.map(p=>p.higherTimeframe).filter(Boolean),
    chartNotes:active.flatMap(p=>p.chartNotes||[])
  };
}

module.exports={getActiveAnalystPack};
