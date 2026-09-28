/**
 * Shared helpers for the Phase 51–100 public-signal stack.
 * Deterministic, bounded and intentionally conservative.
 */
const VERSION="51-100.0.0";
const n=(x,d=null)=>Number.isFinite(Number(x))?Number(x):d;
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,n(x,a)));
const side=x=>{const s=String(x||"").toUpperCase();return s==="LONG"||s==="SHORT"?s:"WAIT"};
const finite=x=>Number.isFinite(Number(x));
function directionalScore(rows=[]){
  let long=0,short=0,total=0;
  for(const r of Array.isArray(rows)?rows:[]){
    const w=Math.max(-20,Math.min(20,n(r.weight,0)));
    const s=side(r.side);
    if(s==="LONG")long+=Math.abs(w);
    else if(s==="SHORT")short+=Math.abs(w);
    total+=Math.abs(w);
  }
  const denom=total||1;
  return {long:+(long/denom*100).toFixed(2),short:+(short/denom*100).toFixed(2),agreement:+(Math.abs(long-short)/denom*100).toFixed(2),total};
}
function evidenceCoverage(items=[]){
  const xs=(Array.isArray(items)?items:[]).filter(Boolean);
  const present=xs.filter(x=>x.present!==false).length;
  return {present,total:xs.length,coverage:xs.length?Math.round(present/xs.length*100):0};
}
function weightedMean(rows=[]){
  let s=0,w=0;
  for(const r of Array.isArray(rows)?rows:[]){const v=n(r.value),wt=Math.max(0,n(r.weight,1));if(finite(v)){s+=v*wt;w+=wt}}
  return w?s/w:null;
}
function probability(p){return finite(p)?+clamp(Number(p),0,100).toFixed(2):null}
function zone(low,high,price){
  if(!finite(price))return "UNKNOWN";
  const lo=n(low),hi=n(high);
  if(!finite(lo)||!finite(hi))return "UNDEFINED";
  if(price<lo)return "BELOW";
  if(price>hi)return "ABOVE";
  return "INSIDE";
}
function unique(xs=[]){return [...new Set((Array.isArray(xs)?xs:[]).filter(Boolean).map(String))]}
function reason(code,text){return {code:String(code),text:String(text)}}
module.exports={VERSION,n,clamp,side,finite,directionalScore,evidenceCoverage,weightedMean,probability,zone,unique,reason};
