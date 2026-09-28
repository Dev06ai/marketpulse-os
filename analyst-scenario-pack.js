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



/* Dewald Thiart BTC Visual Reference Pack — 2026-09-27
   Source: three supplied TradingView screenshots. These are time-bound analyst annotations, not guaranteed outcomes. */
const CURRENT_VISUAL_PACK_20260927={
  id:"dewald-thiart-btc-visual-levels-2026-09-27",
  source:"Dewald Thiart — supplied BTC chart screenshots",
  symbol:"BTCUSDT",
  asOf:"2026-09-27T17:26:00Z",
  validHours:24,
  timeframeContext:["1h","16m","2h","8h","1d","1w"],
  higherTimeframe:{
    thesis:"The supplied charts show two conditional paths: a 1H ABC-down/WXY-style correction with a Fibonacci downside ladder, and a local bullish nested-1,2 interpretation with a clearly marked invalidation band.",
    bearishPath:"ABC Down / corrective continuation with C projected near the 1.0 level around 80,608, followed by lower Fibonacci extension checkpoints.",
    bullishPath:"Local bullish option with nested 1,2s; the bullish interpretation is invalidated by sustained acceptance through the marked 83.99K–83.78K area.",
    weeklyReference:"Weekly nPOC is marked near 87,783.9; the higher red nPOC is near 87,996.6."
  },
  snapshotPrices:[{at:"2026-09-27T17:20:00Z",price:84401.4,sourceLabel:"16m chart snapshot"},{at:"2026-09-27T17:26:00Z",price:84717.7,sourceLabel:"16m chart snapshot"}],
  levels:[
    {id:"DT_1H_FIB_0",label:"1H Fibonacci 0",price:85151.0,kind:"RESISTANCE",source:"1H ABC-down chart"},
    {id:"DT_RANGE_POC",label:"Range POC",price:85820.7,kind:"RESISTANCE",source:"1H / 2H profile"},
    {id:"DT_WEEKLY_NPOC",label:"Weekly nPOC",price:87783.9,kind:"RESISTANCE",source:"2H/weekly profile"},
    {id:"DT_NPOC_HIGH",label:"Higher nPOC",price:87996.6,kind:"RESISTANCE",source:"1H/2H profile"},
    {id:"DT_DAILY_NPOC",label:"Daily nPOC",price:84056.0,kind:"SUPPORT",source:"Local bullish chart"},
    {id:"DT_DAILY_OB",label:"Daily OB",price:81143.9,kind:"SUPPORT",source:"2H/1H profile chart"},
    {id:"DT_NPOC_LOW",label:"Lower nPOC",price:80463.9,kind:"SUPPORT",source:"1H/2H profile"},
    {id:"DT_1H_FIB_0618",label:"1H Fibonacci 0.618",price:82343.5,kind:"SUPPORT",source:"1H ABC-down chart"},
    {id:"DT_1H_FIB_0786",label:"1H Fibonacci 0.786",price:81680.3,kind:"SUPPORT",source:"1H ABC-down chart"},
    {id:"DT_1H_FIB_1",label:"1H Fibonacci 1.0 / C projection",price:80608.0,kind:"SUPPORT",source:"1H ABC-down chart"},
    {id:"DT_1H_FIB_1236",label:"1H Fibonacci 1.236 extension",price:79536.0,kind:"SUPPORT",source:"1H ABC-down chart"},
    {id:"DT_1H_FIB_1382",label:"1H Fibonacci 1.382 extension",price:78872.8,kind:"SUPPORT",source:"1H ABC-down chart"},
    {id:"DT_1H_FIB_1618",label:"1H Fibonacci 1.618 extension",price:77800.7,kind:"SUPPORT",source:"1H ABC-down chart"}
  ],
  zones:[
    {id:"DT_R1_2H_OB",label:"2H OB / Range POC confluence",low:85600,high:85950,kind:"RESISTANCE",sources:["2H OB","Range POC 85,820.7"],primaryAction:"SHORT",primaryTrigger:"Sweep/rejection from the 2H OB with a bearish close and seller-flow confirmation.",alternateAction:"LONG",alternateTrigger:"Clean acceptance above the zone, then a high-volume retest/hold.",invalidationText:"Sustained acceptance above the zone."},
    {id:"DT_R2_WEEKLY_NPOC",label:"Weekly nPOC / higher nPOC resistance",low:87750,high:88025,kind:"RESISTANCE",sources:["Weekly nPOC 87,783.9","Higher nPOC 87,996.6"],primaryAction:"SHORT",primaryTrigger:"Bearish reaction after reaching the higher-timeframe value area.",alternateAction:"LONG",alternateTrigger:"Impulsive breakout and sustained acceptance above the higher nPOC.",invalidationText:"Sustained acceptance above the higher nPOC."},
    {id:"DT_LOCAL_BULL_PIVOT",label:"Local bullish pivot band",low:84056.0,high:84401.4,kind:"SUPPORT",sources:["Daily nPOC 84,056.0","16m snapshot reference 84,401.4","Nested 1,2 local bullish option"],primaryAction:"LONG",primaryTrigger:"Bullish reaction/reclaim from the pivot band with constructive flow.",alternateAction:"SHORT",alternateTrigger:"Acceptance below the band followed by a failed reclaim.",invalidationText:"Loss of the lower invalidation band below this pivot."},
    {id:"DT_LOCAL_BULL_INVALIDATION",label:"Local bullish invalidation band",low:83778.4,high:83986.1,kind:"SUPPORT",sources:["Chart-marked invalidation","Daily nPOC neighborhood"],primaryAction:"LONG",primaryTrigger:"Reclaim and hold after a liquidity sweep if the local bullish scenario is otherwise confirmed.",alternateAction:"SHORT",alternateTrigger:"Clean close below the band plus failed reclaim and downside-flow confirmation.",invalidationText:"Sustained acceptance below the band invalidates the local bullish scenario."},
    {id:"DT_FIB_0618",label:"ABC-down 0.618 support checkpoint",low:82295,high:82395,kind:"SUPPORT",sources:["1H Fibonacci 0.618 = 82,343.5"],primaryAction:"LONG",primaryTrigger:"Confirmed bullish reaction/reclaim.",alternateAction:"SHORT",alternateTrigger:"Breakdown and failed reclaim.",invalidationText:"Acceptance below the level."},
    {id:"DT_FIB_0786",label:"ABC-down 0.786 support checkpoint",low:81635,high:81725,kind:"SUPPORT",sources:["1H Fibonacci 0.786 = 81,680.3"],primaryAction:"LONG",primaryTrigger:"Confirmed bullish reaction/reclaim.",alternateAction:"SHORT",alternateTrigger:"Breakdown and failed reclaim.",invalidationText:"Acceptance below the level."},
    {id:"DT_DAILY_OB_ZONE",label:"Daily OB support",low:81090,high:81200,kind:"SUPPORT",sources:["Daily OB = 81,143.9"],primaryAction:"LONG",primaryTrigger:"Strong reaction and reclaim.",alternateAction:"SHORT",alternateTrigger:"Breakdown and failed retest.",invalidationText:"Sustained acceptance below the Daily OB."},
    {id:"DT_C_TARGET",label:"ABC-down C / 1.0 checkpoint",low:80550,high:80670,kind:"SUPPORT",sources:["1H Fibonacci 1.0 = 80,608.0","ABC Down C label"],primaryAction:"LONG",primaryTrigger:"Downside completes into the C checkpoint and confirms a bullish reaction.",alternateAction:"SHORT",alternateTrigger:"Breakdown with failed reclaim.",invalidationText:"Acceptance below the checkpoint."},
    {id:"DT_EXT_1236",label:"1.236 extension checkpoint",low:79490,high:79585,kind:"SUPPORT",sources:["1.236 = 79,536.0"],primaryAction:"LONG",primaryTrigger:"Confirmed reaction.",alternateAction:"SHORT",alternateTrigger:"Breakdown/retest failure.",invalidationText:"Acceptance below the extension."},
    {id:"DT_EXT_1382",label:"1.382 extension checkpoint",low:78830,high:78915,kind:"SUPPORT",sources:["1.382 = 78,872.8"],primaryAction:"LONG",primaryTrigger:"Confirmed reaction.",alternateAction:"SHORT",alternateTrigger:"Breakdown/retest failure.",invalidationText:"Acceptance below the extension."},
    {id:"DT_EXT_1618",label:"1.618 extension checkpoint",low:77755,high:77845,kind:"SUPPORT",sources:["1.618 = 77,800.7"],primaryAction:"LONG",primaryTrigger:"Confirmed reaction.",alternateAction:"SHORT",alternateTrigger:"Breakdown/retest failure.",invalidationText:"Acceptance below the extension."}
  ],
  visualKnowledge:{
    source:"2026-09-28 supplied screenshots",
    modelRole:"TIME_BOUND_REFERENCE",
    rules:[
      "Use Daily/8H/2H/1H/weekly level confluence as location context; never treat any single level as an automatic signal.",
      "The 2H OB / Range POC resistance around 85.6–86.0K is a reaction zone; bearish rejection requires current seller-side confirmation, while bullish acceptance requires a body-close and retest/hold.",
      "The local Daily nPOC / bullish pivot around 84.0–84.4K is a reaction area; a sweep below followed by reclaim is a valid long-side reversal candidate for further live confirmation.",
      "The marked 83.99–83.78K band is the local bullish invalidation region from the chart reference; sustained acceptance below it weakens that bullish scenario.",
      "The 81.1K Daily OB and the 80.5–82.0K support cluster are major lower support references. The 75.5–77.0K green support / 8H OB region is a deeper support cluster if the corrective path extends.",
      "For the ABC-down model, 0.618 and 0.786 are reaction checkpoints rather than assumed terminal targets; the chart marks the 1.0/C area near 80.6K as the common completion checkpoint, with 1.236/1.382/1.618 as sequential extension checkpoints if support fails.",
      "A confirmed sweep/reclaim at a mapped support zone should be evaluated as a reversal setup even when the immediately preceding 15M trend is bearish; the prior trend is context, not an automatic veto.",
      "A rising-channel / wave-4 support reaction can support a bullish continuation scenario, but it still requires current price structure, flow, data quality and risk confirmation."
    ],
    zones:[
      {id:"DT_VISUAL_SUPPORT_80_82",label:"80.5–82.0K major support cluster",low:80500,high:82000,kind:"SUPPORT",sources:["green support box","Daily/8H context"],primaryAction:"LONG",primaryTrigger:"Sweep/reclaim and bullish displacement with constructive flow.",alternateAction:"SHORT",alternateTrigger:"Decisive breakdown and failed reclaim.",invalidationText:"Sustained acceptance below the cluster."},
      {id:"DT_VISUAL_SUPPORT_75_77",label:"75.5–77.0K deeper support / 8H OB cluster",low:75500,high:77000,kind:"SUPPORT",sources:["green support box","8H OB"],primaryAction:"LONG",primaryTrigger:"Confirmed reaction at the cluster.",alternateAction:"SHORT",alternateTrigger:"Breakdown with failed retest.",invalidationText:"Sustained acceptance below the cluster."},
      {id:"DT_VISUAL_2H_OB",label:"85.6–86.0K 2H OB / Range POC reaction zone",low:85600,high:86000,kind:"RESISTANCE",sources:["2H OB","Range POC"],primaryAction:"SHORT",primaryTrigger:"Sweep/rejection and bearish close with seller confirmation.",alternateAction:"LONG",alternateTrigger:"Acceptance above and bullish retest.",invalidationText:"Sustained acceptance above the zone."}
    ]
  },
  scenarios:[
    {id:"DT_ABC_DOWN",bias:"BEARISH",thesis:"The 1H chart explicitly labels an ABC Down structure with B near the 85.15K region and C projected toward 80.608K; the lower Fibonacci extensions are continuation checkpoints, not assumptions that every level must break.",confirmation:["rejection from the upper resistance/POC area","failure of the local bullish pivot","bearish body-close / failed retest","seller-side CVD/OI/order-flow confirmation"],invalidation:["clean acceptance back above the resistance confluence","local bullish structure reclaims and holds the marked invalidation band"],preferredZones:["DT_R1_2H_OB","DT_FIB_0618","DT_FIB_0786","DT_C_TARGET","DT_EXT_1236","DT_EXT_1382","DT_EXT_1618"]},
    {id:"DT_LOCAL_BULL_NESTED_12",bias:"BULLISH",thesis:"The 16m chart marks a local bullish option with nested 1,2s and a clear invalidation; the bullish interpretation requires the local pivot to hold and must be confirmed by current structure and flow.",confirmation:["support holds around the local pivot band","nested 1,2 structure remains intact","acceptance above 85,151 followed by the 85,820.7 Range POC","positive CVD/OI/order-book confirmation"],invalidation:["sustained acceptance below the 83,986.1–83,778.4 invalidation band"],preferredZones:["DT_LOCAL_BULL_PIVOT","DT_LOCAL_BULL_INVALIDATION","DT_R1_2H_OB","DT_R2_WEEKLY_NPOC"]}
  ],
  chartNotes:[
    "Screenshot 4002/4004: 1H ABC Down with 0 at 85,151.0, 0.618 at 82,343.5, 0.786 at 81,680.3, 1.0 at 80,608.0, then 1.236/1.382/1.618 at 79,536.0/78,872.8/77,800.7.",
    "Screenshot 4003/4004: local bullish option, nested 1,2s and a chart-marked invalidation band around 83.99K–83.78K; projected bullish path climbs through the Range POC and higher nPOCs.",
    "Screenshot 4004/4004: local support/resistance map with 2H OB near the Range POC, Daily OB at 81,143.9, Daily nPOC at 84,056.0 and lower nPOC at 80,463.9."
  ],
  rule:"Use these levels and scenarios as time-bound conditional reference context. Never promote them directly to a live trade signal without current MarketPulse structure, reaction, derivatives, data-quality and prop-firm safety gates."
};

function getActiveAnalystPack(now=Date.now()){
  const packs=[PACK,CURRENT_VISUAL_PACK,CURRENT_VISUAL_PACK_20260927];
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
