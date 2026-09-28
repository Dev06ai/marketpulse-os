/**
 * Phase 31 — Event-driven Backtest Engine
 */
const VERSION="31.0.0";
function run(candles=[],strategy={},opts={}){
  const trades=[];let equity=Number(opts.initialEquity||1),peak=equity,maxDd=0;
  const feeBps=Number(opts.feeBps||0),slipBps=Number(opts.slippageBps||0);
  for(let i=0;i<(candles||[]).length;i++){
    const c=candles[i],sig=typeof strategy==="function"?strategy(c,i,candles):strategy?.[i];
    if(!sig||!["LONG","SHORT"].includes(String(sig.side||"").toUpperCase()))continue;
    const side=String(sig.side).toUpperCase(),entry=Number(sig.entry??c?.c),stop=Number(sig.stop),target=Number(sig.target);
    if(![entry,stop,target].every(Number.isFinite))continue;
    let outcome=null,exit=Number(c?.c);
    for(let j=i+1;j<candles.length;j++){
      const x=candles[j];
      if(side==="LONG"){
        if(Number(x?.l)<=stop){outcome="STOP";exit=stop;break}
        if(Number(x?.h)>=target){outcome="TARGET";exit=target;break}
      }else{
        if(Number(x?.h)>=stop){outcome="STOP";exit=stop;break}
        if(Number(x?.l)<=target){outcome="TARGET";exit=target;break}
      }
    }
    if(!outcome)continue;
    const gross=side==="LONG"?(exit-entry):(entry-exit),cost=(Math.abs(entry)+Math.abs(exit))*(feeBps+slipBps)/10000;
    const pnl=gross-cost;equity+=pnl;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,peak-equity);
    trades.push({index:i,side,entry,exit,outcome,pnl});
  }
  return {version:VERSION,trades,equity,maxDrawdown:maxDd};
}
function selfTest(){const c=[{o:100,h:101,l:99,c:100},{o:100,h:105,l:99,c:104},{o:104,h:106,l:103,c:105}];const x=run(c,()=>({side:"LONG",entry:100,stop:98,target:104}),{});return {ok:x.trades.length===1&&x.trades[0].outcome==="TARGET",version:VERSION};}
module.exports={VERSION,run,selfTest};
