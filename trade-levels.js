/*
 * MarketPulse — Conservative Trade Level Builder
 * ----------------------------------------------
 * Builds a single, internally consistent conditional trade map.
 *
 * Invariants:
 * - Entry is the midpoint of the mapped entry zone.
 * - LONG stop is below entry; SHORT stop is above entry.
 * - TP1 must satisfy the configured minimum R:R.
 * - TP2 must be beyond TP1 and satisfy a stronger reward multiple.
 * - An excessively wide structural stop invalidates the setup instead of
 *   silently widening the target or inventing a marginal trade.
 */

const DEFAULTS=Object.freeze({
  minRR:1.5,
  tp2RR:2.4,
  minRiskAtr:0.5,
  maxRiskAtr:2.25,
  defaultRiskAtr:1.15,
  stopBufferAtr:0.15,
  setupBufferAtr:0.18,
  maxEntryWidthAtr:0.75
});

function n(x,d=null){return Number.isFinite(Number(x))?Number(x):d}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function sideOf(side){
  const s=String(side||"").toUpperCase();
  return s==="LONG"||s==="SHORT"?s:"WAIT";
}

function validLevel(x){const v=n(x);return v!==null&&v>0?v:null}

function validateTradeLevels(levels={},opts={}){
  const side=sideOf(levels.side),minRR=Math.max(0.1,n(opts.minRR,DEFAULTS.minRR));
  const entry=validLevel(levels.entry),stop=validLevel(levels.stop),tp1=validLevel(levels.tp1),tp2=validLevel(levels.tp2);
  const entryLow=validLevel(levels.entryLow),entryHigh=validLevel(levels.entryHigh);
  const risk=entry!==null&&stop!==null?Math.abs(entry-stop):null;
  const rr1=entry!==null&&tp1!==null&&risk>0?Math.abs(tp1-entry)/risk:null;
  const rr2=entry!==null&&tp2!==null&&risk>0?Math.abs(tp2-entry)/risk:null;
  const reasons=[];
  if(!["LONG","SHORT"].includes(side))reasons.push("NO_DIRECTION");
  if(entry===null||stop===null||tp1===null||tp2===null)reasons.push("LEVELS_INCOMPLETE");
  if(side==="LONG"&&stop!==null&&stop>=entry)reasons.push("LONG_STOP_NOT_BELOW_ENTRY");
  if(side==="SHORT"&&stop!==null&&stop<=entry)reasons.push("SHORT_STOP_NOT_ABOVE_ENTRY");
  if(side==="LONG"&&tp1!==null&&tp1<=entry)reasons.push("LONG_TP1_NOT_ABOVE_ENTRY");
  if(side==="SHORT"&&tp1!==null&&tp1>=entry)reasons.push("SHORT_TP1_NOT_BELOW_ENTRY");
  if(side==="LONG"&&tp2!==null&&tp1!==null&&tp2<=tp1)reasons.push("LONG_TP2_NOT_BEYOND_TP1");
  if(side==="SHORT"&&tp2!==null&&tp1!==null&&tp2>=tp1)reasons.push("SHORT_TP2_NOT_BEYOND_TP1");
  if(rr1!==null&&rr1<minRR)reasons.push("RR_BELOW_MINIMUM");
  if(rr2!==null&&rr2<=rr1)reasons.push("TP2_REWARD_NOT_GREATER_THAN_TP1");
  return {
    valid:reasons.length===0,
    reasons,
    side,entryLow,entryHigh,entry,stop,tp1,tp2,
    riskDistance:risk,target1Distance:entry!==null&&tp1!==null?Math.abs(tp1-entry):null,
    rr:rr1,rr1,rr2,minRR
  };
}

function buildTradeLevels(input={}){
  const side=sideOf(input.side),price=validLevel(input.price);
  const atr=validLevel(input.atr);
  const minRR=Math.max(0.1,n(input.minRR,DEFAULTS.minRR));
  const tp2RR=Math.max(minRR+0.25,n(input.tp2RR,DEFAULTS.tp2RR));
  const minRiskAtr=Math.max(0.1,n(input.minRiskAtr,DEFAULTS.minRiskAtr));
  const maxRiskAtr=Math.max(minRiskAtr,n(input.maxRiskAtr,DEFAULTS.maxRiskAtr));
  const defaultRiskAtr=clamp(n(input.defaultRiskAtr,DEFAULTS.defaultRiskAtr),minRiskAtr,maxRiskAtr);
  const stopBufferAtr=Math.max(0,n(input.stopBufferAtr,DEFAULTS.stopBufferAtr));
  const setupBufferAtr=Math.max(0,n(input.setupBufferAtr,DEFAULTS.setupBufferAtr));
  const maxEntryWidthAtr=Math.max(0.1,n(input.maxEntryWidthAtr,DEFAULTS.maxEntryWidthAtr));

  if(side==="WAIT"||price===null||atr===null||atr<=0){
    return {valid:false,side,reason:"INSUFFICIENT_LEVEL_INPUTS",reasons:["INSUFFICIENT_LEVEL_INPUTS"]};
  }

  const reaction=input.reaction&&typeof input.reaction==="object"?input.reaction:null;
  const reactionSide=sideOf(reaction?.action);
  const rangeLow=validLevel(input.rangeLow),rangeHigh=validLevel(input.rangeHigh);
  const support=validLevel(input.nearestSupport),resistance=validLevel(input.nearestResistance);

  let entryLow,entryHigh,stop=null,source="ENGINE";
  if(reaction&&reactionSide===side){
    const rlo=validLevel(reaction.low),rhi=validLevel(reaction.high);
    if(rlo!==null&&rhi!==null){
      entryLow=Math.min(rlo,rhi);
      entryHigh=Math.max(rlo,rhi);
      stop=validLevel(reaction.invalidation);
      source="REACTION MAP";
    }
  }

  if(entryLow===undefined||entryHigh===undefined){
    entryLow=side==="LONG"?price-0.08*atr:price-0.04*atr;
    entryHigh=side==="LONG"?price+0.04*atr:price+0.08*atr;
  }

  // Prevent an accidental oversized reaction zone from turning the entry
  // midpoint into a very different price than the live market.
  const center=(entryLow+entryHigh)/2;
  const maxWidth=maxEntryWidthAtr*atr;
  if(entryHigh-entryLow>maxWidth){
    entryLow=center-maxWidth/2;
    entryHigh=center+maxWidth/2;
    source+=" · ENTRY WIDTH CAPPED";
  }

  const entry=(entryLow+entryHigh)/2;
  const fallbackStop=side==="LONG"?entry-defaultRiskAtr*atr:entry+defaultRiskAtr*atr;
  if(stop===null){
    const structural=side==="LONG"
      ?(rangeLow!==null?rangeLow-stopBufferAtr*atr:null)
      :(rangeHigh!==null?rangeHigh+stopBufferAtr*atr:null);
    stop=structural!==null&&((side==="LONG"&&structural<entry)||(side==="SHORT"&&structural>entry))
      ?structural
      :fallbackStop;
    source+=" · STRUCTURE";
  }

  // A structural invalidation that is too close is unsafe for a noisy market;
  // widen only up to the minimum risk buffer. A structural invalidation that is
  // too far is not repaired by moving the target — the setup is rejected.
  let risk=Math.abs(entry-stop);
  if(!(risk>0)||!Number.isFinite(risk)){
    stop=fallbackStop;
    risk=Math.abs(entry-stop);
    source+=" · FALLBACK STOP";
  }

  const minRisk=minRiskAtr*atr;
  if(risk<minRisk){
    stop=side==="LONG"?entry-minRisk:entry+minRisk;
    risk=minRisk;
    source+=" · MIN RISK";
  }

  const riskAtr=risk/atr;
  if(riskAtr>maxRiskAtr){
    return {
      valid:false,side,source,
      entryLow,entryHigh,entry,stop,
      riskDistance:risk,riskAtr,
      tp1:null,tp2:null,rr:null,
      reason:"STRUCTURAL STOP TOO FAR",
      reasons:["STRUCTURAL_STOP_TOO_FAR"]
    };
  }

  const requiredReward=minRR*risk;
  let tp1;
  const levelTarget=side==="LONG"
    ?(resistance!==null&&resistance>entry?resistance:null)
    :(support!==null&&support<entry?support:null);
  if(levelTarget!==null&&Math.abs(levelTarget-entry)>=requiredReward){
    tp1=levelTarget;
    source+=" · STRUCTURAL TARGET";
  }else{
    tp1=side==="LONG"?entry+requiredReward:entry-requiredReward;
    source+=" · MIN-RR TARGET";
  }

  let tp2=side==="LONG"?entry+tp2RR*risk:entry-tp2RR*risk;
  if(side==="LONG")tp2=Math.max(tp2,tp1+0.25*risk);
  else tp2=Math.min(tp2,tp1-0.25*risk);

  const result=validateTradeLevels({
    side,entryLow,entryHigh,entry,stop,tp1,tp2,
    riskDistance:risk,target1Distance:Math.abs(tp1-entry),
    rr:Math.abs(tp1-entry)/Math.max(risk,1e-12),
    source
  },{minRR});

  return {
    ...result,
    source,
    riskAtr,
    tp2RR,
    maxRiskAtr
  };
}

function selfTest(){
  const long=buildTradeLevels({
    side:"LONG",price:100,atr:2,rangeLow:96,rangeHigh:104,
    nearestResistance:106,nearestSupport:94
  });
  const short=buildTradeLevels({
    side:"SHORT",price:100,atr:2,rangeLow:96,rangeHigh:104,
    nearestResistance:106,nearestSupport:94
  });
  const bad=validateTradeLevels({side:"LONG",entry:100,stop:97,tp1:101,tp2:102},{minRR:1.5});
  return {
    ok:long.valid&&short.valid&&Number(long.rr)>=1.5&&Number(short.rr)>=1.5&&!bad.valid,
    long,short,bad
  };
}

module.exports={VERSION:"1.0.0",DEFAULTS,buildTradeLevels,validateTradeLevels,selfTest};
