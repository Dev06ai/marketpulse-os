const assert=require("assert");

const fakeWebPush={
  setVapidDetails(){},
  async sendNotification(){return {statusCode:201}}
};
const originalProcess=global.process;
const originalRequire=module.require.bind(module);
const fs=require("fs");
const source=fs.readFileSync(require.resolve("../signal-notifications"),"utf8");

function load(env){
  const mod={exports:{}};
  const req=(name)=>name==="web-push"?fakeWebPush:originalRequire(name);
  const fn=new Function("require","module","exports","process",source);
  fn(req,mod,mod.exports,{env:Object.assign({},env)});
  return mod.exports;
}

const notifications=load({
  MARKETPULSE_SIGNAL_ALERTS_ENABLED:"true",
  MARKETPULSE_VAPID_PUBLIC_KEY:"PUBLIC",
  MARKETPULSE_VAPID_PRIVATE_KEY:"PRIVATE",
  MARKETPULSE_ADMIN_EMAIL:"admin@example.com"
});

const alert=notifications.buildSignalAlert({
  symbol:"BTCUSDT",
  interval:"15m",
  candleTs:123,
  decision:{
    state:"READY",
    liveSignalEligible:true,
    action:"LONG",
    signalStability:{state:"CONFIRMED"},
    market:{confluenceScore:86,type:"SFP"},
    levels:{entryLow:100000,stop:98000,tp1:104000,rr:2},
    phase14:{intelligence:{setupKey:"SFP"}}
  }
});
assert(alert,"confirmed BTC signal should create an alert");
assert(alert.style==="SCALP","15m style");
assert(alert.setup==="SFP","setup classification");
assert(alert.title.includes("BTC LONG"),"long title");
assert(alert.body.includes("PAPER-ONLY"),"paper-only safety label");
assert(!notifications.buildSignalAlert({
  symbol:"ETHUSDT",interval:"15m",candleTs:1,
  decision:{state:"READY",liveSignalEligible:true,action:"LONG",signalStability:{state:"CONFIRMED"}}
}),"ETH must not create an admin BTC alert");
assert(!notifications.buildSignalAlert({
  symbol:"BTCUSDT",interval:"15m",candleTs:1,
  decision:{state:"NO_TRADE",liveSignalEligible:false,action:"LONG",signalStability:{state:"CONFIRMING"}}
}),"unconfirmed signals must not alert");
assert(notifications.config().pushEnabled,"push config should be enabled when VAPID keys exist");

console.log("Admin signal notification checks passed.");
