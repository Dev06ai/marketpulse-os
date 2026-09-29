/**
 * Phase 42 — Observability & SLOs
 */
const VERSION="42.0.0";
class Metrics{
  constructor(){this.counters={};this.samples={}}
  inc(key,n=1){this.counters[key]=(this.counters[key]||0)+n}
  observe(key,v){const n=Number(v);if(!Number.isFinite(n))return;const a=this.samples[key]||(this.samples[key]=[]);a.push(n);if(a.length>5000)a.splice(0,a.length-5000)}
  snapshot(){const avg={};for(const [k,a] of Object.entries(this.samples))avg[k]=a.length?a.reduce((x,y)=>x+y,0)/a.length:null;return {version:VERSION,counters:{...this.counters},averages:avg}}
}
function selfTest(){const m=new Metrics();m.inc("decision");m.observe("latency",10);m.observe("latency",20);return {ok:m.snapshot().counters.decision===1&&m.snapshot().averages.latency===15,version:VERSION};}
module.exports={VERSION,Metrics,selfTest};
