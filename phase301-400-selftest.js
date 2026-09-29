const engine=require("./phase301-400-adaptive-intelligence");
const assert=(x,m)=>{if(!x)throw new Error(m)};
const r=engine.selfTest();assert(r.ok,"engine self-test failed");assert(r.moduleCount===100,"expected 100 modules");
const x=engine.evaluate({symbol:"BTCUSDT",interval:"15m",price:100,candles:Array.from({length:30},(_,i)=>({o:100+i,h:101+i,l:99+i,c:100+i,v:100})),decision:{action:"WAIT"},phase201to300:{gate:{status:"WAIT",action:"WAIT"}}});
assert(x.automaticExecutionEnabled===false,"automatic execution must remain disabled");
assert(x.modules.length===100,"module coverage mismatch");
assert(x.learning.challenger.status==="SHADOW_ONLY","challenger must remain shadow-only");
assert(x.userExperience.replay.available===true,"replay contract missing");
console.log(JSON.stringify({ok:true,version:engine.VERSION,moduleCount:x.modules.length,automaticExecutionEnabled:x.automaticExecutionEnabled}));
