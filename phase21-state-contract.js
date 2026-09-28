/**
 * Phase 21 — Canonical State Contract
 * -----------------------------------
 * Normalizes the cross-feature market/decision state into a versioned,
 * deterministic contract. This module is intentionally pure and safe to test.
 */

const crypto=require("crypto");
const VERSION="21.0.0";

function n(x,d=null){const v=Number(x);return Number.isFinite(v)?v:d}
function s(x,d="UNKNOWN"){const v=String(x??"").trim();return v?v:d}
function side(x){const v=String(x||"").toUpperCase();return v==="LONG"||v==="SHORT"?v:"WAIT"}
function finiteObject(obj,keys){
  const out={};
  for(const k of keys)out[k]=n(obj?.[k]);
  return out;
}

function normalize(input={}){
  const d=input.decision||input.finalDecision||{};
  const m=d.market||input.market||{};
  const deriv=d.derivatives||input.derivatives||{};
  const risk=d.risk||input.risk||{};
  const validation=d.validation||input.validation||{};
  const structure=input.structure||d.structure||{};
  const liquidity=input.liquidity||deriv.liquidity||{};
  const canonical={
    version:VERSION,
    symbol:s(input.symbol||d.symbol,"UNKNOWN"),
    interval:s(input.interval||d.interval,"UNKNOWN"),
    sequence:n(input.sequence),
    generatedAt:n(input.generatedAt||input.ts),
    price:n(m.price||input.price),
    action:side(d.action||input.action),
    state:s(d.state||input.state,"WAIT"),
    executable:Boolean(d.executable||d.liveSignal==="READY"),
    market:{
      regime:s(m.regime||input.regime),
      htf:s(m.htf||input.htf),
      ltf:s(m.ltf||input.ltf),
      volatility:s(m.volatility||input.volatility),
      trend:s(m.trend||input.trend)
    },
    structure:{
      setup:s(structure?.setup?.kind||structure?.setupKind||input.setupKind),
      side:side(structure?.setup?.side||structure?.side),
      score:n(structure?.setup?.score||structure?.score)
    },
    flow:{
      cvd:s(deriv.cvdState||deriv.cvd),
      openInterest:n(deriv.oiChangePct||deriv.openInterestChangePct),
      takerImbalance:n(deriv.takerImbalance),
      orderBookImbalance:n(deriv.orderBook?.imbalance||deriv.imbalance),
      liquidationBias:s(deriv.liquidationBias),
      fundingRate:n(deriv.fundingRate)
    },
    liquidity:{
      nearestHigh:n(liquidity.nearestHigh||liquidity.high),
      nearestLow:n(liquidity.nearestLow||liquidity.low),
      sweep:s(liquidity.sweep)
    },
    risk:{
      riskPct:n(risk.riskPct),
      rr:n(risk.rr),
      dailyDrawdownPct:n(risk.dailyDrawdownPct),
      headroomPct:n(risk.headroomPct),
      blocked:Boolean(risk.blocked)
    },
    validation:{
      gate:s(validation.gate||d.deploymentGate?.state,"UNKNOWN"),
      paperOnly:Boolean(validation.paperOnly||d.paperOnly),
      sampleCount:n(validation.sampleCount)
    }
  };
  return canonical;
}

function hash(state){
  return crypto.createHash("sha256").update(JSON.stringify(normalize(state))).digest("hex").slice(0,24).toUpperCase();
}

function compare(a,b){
  const na=normalize(a),nb=normalize(b);
  const ha=hash(na),hb=hash(nb);
  return {
    same:ha===hb,
    leftHash:ha,
    rightHash:hb,
    mismatches:Object.keys(na).filter(k=>JSON.stringify(na[k])!==JSON.stringify(nb[k]))
  };
}

function selfTest(){
  const input={symbol:"BTCUSDT",interval:"15m",price:100,decision:{action:"LONG",state:"READY",executable:true,market:{price:100},derivatives:{cvdState:"BUYERS",takerImbalance:.2}}};
  const same=compare(input,JSON.parse(JSON.stringify(input)));
  const changedInput=JSON.parse(JSON.stringify(input));
  changedInput.decision.derivatives.takerImbalance=.1;
  const changed=compare(input,changedInput);
  return {ok:same.same&&!changed.same&&changed.mismatches.includes("flow"),version:VERSION,snapshotId:hash(input)};
}
module.exports={VERSION,normalize,hash,compare,selfTest};
