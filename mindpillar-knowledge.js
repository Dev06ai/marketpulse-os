/*
  MarketPulse Knowledge Core — MindPillar public learning synthesis
  ---------------------------------------------------------------
  This module stores concise, original rule summaries derived from publicly
  accessible MindPillar curriculum/articles and the user's supplied Playbooks
  library screenshots.

  It is intentionally NOT a verbatim copy of course text.
  Knowledge is contextual/diagnostic by default. Existing live-data,
  confirmation, validation and risk gates remain authoritative.
*/

const VERSION="1.0.0";
const CATALOG_SOURCE="https://mindpillar.com/learn/playbooks";

const DOMAINS={
  marketStructure:{
    id:"market-structure",
    label:"Market Structure",
    concepts:[
      "swing highs/lows and structural trend",
      "break of structure and change of character",
      "impulse versus correction",
      "liquidity around obvious structural extremes"
    ],
    rules:[
      "Define the relevant swing points before interpreting a break.",
      "A lower-timeframe break must be interpreted inside the higher-timeframe structure.",
      "Structural invalidation should be tied to the swing/zone that the thesis depends on."
    ]
  },
  supportResistance:{
    id:"support-resistance",
    label:"Support & Resistance",
    concepts:["reaction zones","previous extremes","key boundaries","invalidation edges"],
    rules:[
      "Use a zone when repeated reactions span a band rather than forcing one exact price.",
      "Treat the far edge of the relevant zone as the structural invalidation boundary.",
      "A level should be defined before the break so post-break redrawing does not bias the test."
    ]
  },
  multiTimeframe:{
    id:"multi-timeframe",
    label:"Multi-Timeframe Analysis",
    concepts:["top-down alignment","macro context","directional bias","setup timeframe","execution timeframe"],
    rules:[
      "Read macro context before lower-timeframe execution.",
      "Use Daily/8H for macro context, 4H for directional bias, 15M for setup location and 1M/5M for execution when those feeds are available.",
      "A lower-timeframe pattern does not override higher-timeframe structure without an explicit reversal/exception condition."
    ]
  },
  fibonacci:{
    id:"fibonacci",
    label:"Fibonacci Tools",
    concepts:["retracement","extension","confluence","reaction zones"],
    rules:[
      "Use Fibonacci as a measurement and confluence tool rather than a standalone directional signal.",
      "Give more weight to Fib levels that overlap structural or profile-based evidence.",
      "Treat extensions as checkpoints/targets, not automatic reversal points."
    ]
  },
  liquidity:{
    id:"liquidity",
    label:"Liquidity & Order Blocks",
    concepts:["sweeps","resting liquidity","order blocks","retests","acceptance"],
    rules:[
      "A move through a level is not enough to call a sweep; the market must fail to hold beyond it and reclaim.",
      "A real breakout is supported by acceptance outside prior structure or a successful retest.",
      "A setup should distinguish initial impulse, rejection/sweep, and confirmed retest."
    ]
  },
  cvd:{
    id:"cvd",
    label:"Cumulative Volume Delta",
    concepts:["aggressive execution","delta","CVD","divergence","absorption"],
    rules:[
      "CVD describes classified aggressive execution; it is context rather than a standalone predictor.",
      "Compare price response with CVD rather than treating rising/falling CVD as an automatic trade direction.",
      "CVD divergence is evidence of disagreement, not proof of a reversal.",
      "Always preserve the venue, instrument, timeframe and reset/anchor context of a CVD series."
    ]
  },
  orderFlow:{
    id:"order-flow",
    label:"Order Flow / Footprint",
    concepts:["aggression","absorption","imbalance","price response"],
    rules:[
      "Judge aggressive flow by its result in price, not by the size of an isolated print.",
      "An imbalance followed by acceptance and continuation differs from an imbalance that stalls or rejects.",
      "Absorption is a price-response interpretation and should be evaluated at a defined level."
    ]
  },
  orderBook:{
    id:"order-book",
    label:"Order Book / Market Microstructure",
    concepts:["displayed depth","bid/ask imbalance","spread","icebergs","spoofing"],
    rules:[
      "Displayed liquidity can be cancelled or modified and is not the complete supply/demand picture.",
      "A large disappearing order is not automatically spoofing.",
      "Use order-book imbalance together with actual price response, executed flow and spread quality."
    ]
  },
  liquidation:{
    id:"liquidation",
    label:"Liquidation Heatmaps",
    concepts:["forced closures","liquidation clusters","cascade risk","liquidation direction"],
    rules:[
      "Liquidation heatmaps represent estimated forced-closure areas, not resting voluntary orders.",
      "Clusters can act as magnets/fuel for acceleration rather than guaranteed support/resistance.",
      "Interpret long-liquidation versus short-liquidation clusters by the direction of forced market flow."
    ]
  },
  derivatives:{
    id:"derivatives",
    label:"Funding & Open Interest",
    concepts:["OI change","funding","positioning","price/OI regimes"],
    rules:[
      "Separate price direction from OI change when classifying participation.",
      "Use OI and funding as positioning context; do not let either alone generate a live signal.",
      "Cross-check derivatives context with price structure and aggressive flow."
    ]
  },
  wyckoffAvwap:{
    id:"wyckoff-avwap",
    label:"Wyckoff + Anchored VWAP",
    concepts:["accumulation","distribution","Spring","UTAD","anchored cost basis"],
    rules:[
      "Identify the higher-timeframe Wyckoff hypothesis before using lower-timeframe events for entry.",
      "Anchor VWAP to structurally meaningful events such as Selling Climax, Spring, Buying Climax or UTAD.",
      "Use price/AVWAP interaction to validate or weaken the phase hypothesis rather than treating Wyckoff labels as certain."
    ]
  },
  chartPatterns:{
    id:"chart-patterns",
    label:"Chart Patterns",
    concepts:["continuation","reversal","compression","breakout"],
    rules:[
      "Pattern names are hypotheses; require location, structure and confirmation.",
      "Prefer measured reactions and retests over blind first-touch entries."
    ]
  },
  elliott:{
    id:"elliott",
    label:"Elliott Wave Context",
    concepts:["degree","impulse","correction","count validation"],
    rules:[
      "A wave count must be interpreted relative to the higher-timeframe wave degree.",
      "Use hard structural rules to invalidate counts rather than relying on visual similarity.",
      "Treat alternate counts explicitly when ambiguity is high."
    ]
  },
  sfp:{
    id:"sfp",
    label:"Swing Failure Pattern",
    concepts:["liquidity sweep","close-back","reversal","invalidation"],
    rules:[
      "Require a sweep beyond a defined swing/level and a close back inside the prior structure.",
      "A wick through the level without a failure/reclaim is not a confirmed SFP.",
      "Place invalidation beyond the structural extreme that defines the setup."
    ]
  },
  dLine:{
    id:"d-line",
    label:"D-Line / Breakout Execution",
    concepts:["breakout","acceptance","retest","execution"],
    rules:[
      "Classify breakout quality using structure, body close, participation and retest behavior.",
      "Do not equate the first candle outside a level with confirmed continuation.",
      "Execution criteria should remain subordinate to higher-timeframe context and risk limits."
    ]
  },
  risk:{
    id:"risk",
    label:"Position Sizing & Risk",
    concepts:["fixed percentage risk","structural stop","ATR","drawdown ladder","R"],
    rules:[
      "Stop placement comes before position sizing.",
      "Position size is derived from account risk divided by entry-to-stop distance.",
      "Use a volatility/structural buffer so normal noise does not define invalidation.",
      "Reduce risk as drawdown increases; do not increase size to recover losses."
    ]
  },
  psychologyProcess:{
    id:"process",
    label:"Trading Process",
    concepts:["plan","execute","review","checklists","journaling"],
    rules:[
      "Predefine the setup, invalidation, target and risk before execution.",
      "Separate process quality from trade outcome.",
      "Use post-trade review as data for future process adjustments rather than as a reason to revenge trade."
    ]
  },
  backtesting:{
    id:"backtesting",
    label:"Backtesting & Validation",
    concepts:["defined rules","walk-forward","out-of-sample","no lookahead"],
    rules:[
      "A strategy test must use explicit entry, stop, target and invalidation rules.",
      "Separate training/tuning samples from out-of-sample validation.",
      "Do not use future candles or future derivatives data to define an earlier signal.",
      "Treat sample size, coverage and unresolved trades as part of the evidence."
    ]
  }
};

const PLAYBOOK_CATALOG=[
  {track:"Foundation",session:"Trading vs Investing"},
  {track:"Foundation",session:"Understanding the Chart"},
  {track:"Foundation",session:"TradingView"},
  {track:"Foundation",session:"Exchanges"},
  {track:"Foundation",session:"Support Resistance Trends and Volume"},
  {track:"Foundation",session:"Risk Management Psychology"},
  {track:"Structure & Technicals",session:"Market Structure"},
  {track:"Structure & Technicals",session:"Support & Resistance"},
  {track:"Structure & Technicals",session:"Multi-Timeframe Analysis"},
  {track:"Structure & Technicals",session:"Fibonacci Tools"},
  {track:"Structure & Technicals",session:"Divergences"},
  {track:"Structure & Technicals",session:"Wyckoff Method"},
  {track:"Structure & Technicals",session:"Price Action"},
  {track:"Structure & Technicals",session:"VWAP & Anchored VWAP"},
  {track:"Structure & Technicals",session:"Ichimoku Cloud"},
  {track:"Structure & Technicals",session:"Harmonic Patterns"},
  {track:"Flow & Liquidity",session:"Liquidity & Order Blocks"},
  {track:"Flow & Liquidity",session:"Volume Profile"},
  {track:"Flow & Liquidity",session:"Cumulative Volume Delta"},
  {track:"Flow & Liquidity",session:"Market Microstructure"},
  {track:"Flow & Liquidity",session:"Footprint & Delta"},
  {track:"Flow & Liquidity",session:"Market Profile / TPO"},
  {track:"Flow & Liquidity",session:"Session Killzones"},
  {track:"Flow & Liquidity",session:"Order Book Heatmap"},
  {track:"Derivatives & On-Chain",session:"Liquidation Heatmaps"},
  {track:"Derivatives & On-Chain",session:"Funding & Open Interest"},
  {track:"Derivatives & On-Chain",session:"Spot-Perp Basis"},
  {track:"Derivatives & On-Chain",session:"On-Chain Fundamentals"},
  {track:"Derivatives & On-Chain",session:"Macro Correlation"},
  {track:"Derivatives & On-Chain",session:"Options Greeks & Flow"},
  {track:"Derivatives & On-Chain",session:"Correlation Trading"},
  {track:"Risk & Execution",session:"Position Sizing"},
  {track:"Risk & Execution",session:"Trade Management"},
  {track:"Risk & Execution",session:"Risk of Ruin & Kelly"}
];

const PUBLIC_SOURCES=[
  {topic:"curriculum",url:"https://learn.mindpillar.com/courses"},
  {topic:"multi-timeframe",url:"https://learn.mindpillar.com/blog/multi-timeframe-analysis-crypto"},
  {topic:"liquidity-sweep-breakout",url:"https://learn.mindpillar.com/blog/liquidity-sweep-or-real-breakout-an-order-flow-confirmation-framework"},
  {topic:"cvd",url:"https://learn.mindpillar.com/blog/what-is-cumulative-volume-delta-a-beginners-guide-to-cvd"},
  {topic:"price-vs-cvd",url:"https://learn.mindpillar.com/blog/price-vs-cvd-why-they-usually-align-and-why-they-sometimes-dont"},
  {topic:"order-flow",url:"https://learn.mindpillar.com/blog/what-is-order-flow"},
  {topic:"footprint",url:"https://learn.mindpillar.com/blog/footprint-imbalance-vs-absorption-how-to-read-aggression-and-response"},
  {topic:"order-book",url:"https://learn.mindpillar.com/blog/icebergs-spoofing-and-real-liquidity-what-the-order-book-can-and-cannot-tell-you"},
  {topic:"liquidations",url:"https://learn.mindpillar.com/blog/liquidation-heatmaps-how-to-spot-trapped-traders-and-avoid-getting-hunted"},
  {topic:"wyckoff-avwap",url:"https://learn.mindpillar.com/blog/wyckoff-anchored-vwap"},
  {topic:"position-sizing",url:"https://learn.mindpillar.com/blog/how-much-should-you-risk-per-trade"},
  {topic:"stop-loss",url:"https://learn.mindpillar.com/blog/stop-loss-placement-crypto"},
  {topic:"playbook",url:"https://learn.mindpillar.com/the-trader-playbook"}
];

function relevantDomains({setupKind="",side="WAIT"}={}){
  const k=String(setupKind||"").toUpperCase();
  const out=["marketStructure","supportResistance","multiTimeframe","risk","backtesting"];
  if(k.includes("SFP"))out.push("sfp","liquidity","cvd","orderFlow");
  if(k.includes("D_LINE")||k.includes("BREAKOUT"))out.push("dLine","liquidity","orderFlow","cvd");
  if(k.includes("ORDER_BLOCK"))out.push("liquidity","supportResistance");
  if(k.includes("NPOC"))out.push("liquidity","supportResistance");
  if(k.includes("ELLIOTT"))out.push("elliott","fibonacci");
  if(side!=="WAIT")out.push("derivatives","liquidation");
  return [...new Set(out)].map(id=>DOMAINS[id]).filter(Boolean);
}

function buildKnowledgeContext({setupKind="",side="WAIT",interval="1h",strict=false}={}){
  return {
    version:VERSION,
    catalogSource:CATALOG_SOURCE,
    interval,
    strict:Boolean(strict),
    domains:relevantDomains({setupKind,side}),
    sourceCount:PUBLIC_SOURCES.length,
    notes:[
      "Knowledge rules are contextual guidance, not independent signal triggers.",
      "Current market data, deterministic validation and prop-firm risk gates remain authoritative.",
      "Public-source summaries are stored as original rule abstractions rather than verbatim course text."
    ]
  };
}

module.exports={VERSION,CATALOG_SOURCE,DOMAINS,PLAYBOOK_CATALOG,PUBLIC_SOURCES,relevantDomains,buildKnowledgeContext};
