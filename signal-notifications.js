const webpush=require("web-push");
const ENABLED=String(process.env.MARKETPULSE_SIGNAL_ALERTS_ENABLED??"true").toLowerCase()!=="false";
const ENV_PUBLIC_KEY=String(process.env.MARKETPULSE_VAPID_PUBLIC_KEY||"").trim();
const ENV_PRIVATE_KEY=String(process.env.MARKETPULSE_VAPID_PRIVATE_KEY||"").trim();
const CONTACT_EMAIL=String(process.env.MARKETPULSE_ADMIN_EMAIL||"admin@marketpulse.local").trim();
const OPPORTUNITY_ALERTS_ENABLED=String(process.env.MARKETPULSE_OPPORTUNITY_ALERTS_ENABLED??"true").toLowerCase()!=="false";
const OPPORTUNITY_MIN_SCORE=Math.max(70,Math.min(90,Number(process.env.MARKETPULSE_OPPORTUNITY_MIN_SCORE||78)));
const OPPORTUNITY_MIN_RR=Math.max(1.1,Math.min(2.5,Number(process.env.MARKETPULSE_OPPORTUNITY_MIN_RR||1.2)));
const OPPORTUNITY_MIN_DATA=Math.max(65,Math.min(95,Number(process.env.MARKETPULSE_OPPORTUNITY_MIN_DATA||80)));


let VAPID_PUBLIC_KEY="";
let VAPID_PRIVATE_KEY="";
let VAPID_READY=false;
let CONFIG_PROMISE=null;

function validVapidPublicKey(value){
  try{
    const raw=Buffer.from(String(value||"").replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-String(value||"").length%4)%4),"base64");
    return raw.length===65 && raw[0]===4;
  }catch{return false}
}
function validVapidPrivateKey(value){
  try{
    const raw=Buffer.from(String(value||"").replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-String(value||"").length%4)%4),"base64");
    return raw.length===32;
  }catch{return false}
}
function configureVapid(publicKey,privateKey){
  if(!validVapidPublicKey(publicKey)||!validVapidPrivateKey(privateKey))throw new Error("Invalid VAPID keypair");
  webpush.setVapidDetails("mailto:"+CONTACT_EMAIL,publicKey,privateKey);
  VAPID_PUBLIC_KEY=publicKey;
  VAPID_PRIVATE_KEY=privateKey;
  VAPID_READY=true;
}
function generateVapidKeypair(){
  // Generate a genuine P-256 VAPID pair using the web-push implementation.
  return webpush.generateVAPIDKeys();
}
async function ensureConfigured(storage){
  if(!ENABLED)return false;
  if(VAPID_READY)return true;
  if(CONFIG_PROMISE)return CONFIG_PROMISE;
  CONFIG_PROMISE=(async()=>{
    let saved=null;
    try{saved=await storage.getAdminPushConfig()}catch{}
    if(saved?.enabled!==false && validVapidPublicKey(saved?.publicKey)&&validVapidPrivateKey(saved?.privateKey)){
      configureVapid(saved.publicKey,saved.privateKey);
      return true;
    }

    // Ignore malformed environment keys rather than making the browser unusable.
    if(validVapidPublicKey(ENV_PUBLIC_KEY)&&validVapidPrivateKey(ENV_PRIVATE_KEY)){
      try{
        configureVapid(ENV_PUBLIC_KEY,ENV_PRIVATE_KEY);
        await storage.saveAdminPushConfig({publicKey:ENV_PUBLIC_KEY,privateKey:ENV_PRIVATE_KEY,contactEmail:CONTACT_EMAIL,enabled:true}).catch(()=>{});
        return true;
      }catch(e){console.error("MarketPulse VAPID environment configuration rejected:",e.message)}
    }

    const pair=generateVapidKeypair();
    configureVapid(pair.publicKey,pair.privateKey);
    await storage.saveAdminPushConfig({publicKey:pair.publicKey,privateKey:pair.privateKey,contactEmail:CONTACT_EMAIL,enabled:true});
    console.log("MarketPulse generated and persisted a new VAPID keypair.");
    return true;
  })().catch(error=>{
    VAPID_READY=false;
    CONFIG_PROMISE=null;
    console.error("MarketPulse push configuration failed:",error?.message||error);
    return false;
  });
  const ok=await CONFIG_PROMISE;
  CONFIG_PROMISE=null;
  return ok;
}

function pushConfigured(){
  return Boolean(ENABLED&&VAPID_READY&&VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY);
}

const SETUP_LABELS={
  SFP:"SFP",
  NPOC:"NPOC reaction",
  D_LINE_BREAKOUT:"D-Line breakout",
  BREAKOUT_RETEST:"Breakout retest",
  ORDER_BLOCK:"Order block",
  ELLIOTT:"Elliott structure",
  TREND_CONTINUATION:"Trend continuation",
  RANGE_REVERSION:"Range reversion",
  GENERIC:"Market structure"
};

function normaliseSetup(decision){
  const raw=String(
    decision?.phase14?.intelligence?.setupKey||
    decision?.analysis?.phase14?.intelligence?.setupKey||
    decision?.analysis?.setupKey||
    decision?.market?.type||
    decision?.analysis?.type||
    decision?.strategyFamily||
    "GENERIC"
  ).trim().toUpperCase().replace(/[ -]+/g,"_");
  return SETUP_LABELS[raw]||raw.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function signalStyle(interval){
  return interval==="15m"?"SCALP":(interval==="1h"||interval==="4h"?"SWING":"WATCH");
}

function price(v){
  const n=Number(v);
  if(!Number.isFinite(n))return "—";
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:n>=1000?0:4}).format(n);
}

function buildSignalAlert({decision,symbol,interval,candleTs}){
  const side=String(decision?.action||"").toUpperCase();
  if(symbol!=="BTCUSDT"||!["15m","1h","4h"].includes(interval)||!["LONG","SHORT"].includes(side))return null;
  if(decision?.state!=="READY"||decision?.liveSignalEligible!==true)return null;
  if(String(decision?.signalStability?.state||"").toUpperCase()!=="CONFIRMED")return null;

  const setup=normaliseSetup(decision);
  const style=signalStyle(interval);
  const levels=decision?.levels||{};
  const score=Number(decision?.market?.confluenceScore??decision?.analysis?.score??0);
  const rr=Number(levels?.rr);
  const gate=String(decision?.deploymentGate?.state||"PAPER_ONLY").toUpperCase();
  const setupKey=String(decision?.phase14?.intelligence?.setupKey||"GENERIC").toUpperCase();
  const key=[symbol,interval,candleTs||"na",side,setupKey].join("|");
  const title="BTC "+side+" · "+interval+" "+style;
  const scoreText=Number.isFinite(score)?Math.round(score)+"/100":"—";
  const rrText=Number.isFinite(rr)?rr.toFixed(2):"—";
  const gateText=gate==="PAPER_ONLY"?"PAPER-ONLY":"READY";
  const entryText=levels.entryLow!=null&&levels.entryHigh!=null
    ?price(levels.entryLow)+" – "+price(levels.entryHigh)
    :price(levels.entryLow??levels.entry);
  const snapshotText=candleTs?new Date(Number(candleTs)).toISOString():"unknown";
  const body=[
    "SIGNAL SNAPSHOT • "+interval+" "+style,
    "BTC "+side+" • Score "+scoreText+" • R:R "+rrText,
    "Entry "+entryText+" • SL "+price(levels.stop),
    "TP1 "+price(levels.tp1)+" • TP2 "+price(levels.tp2),
    "Confirmed at candle "+snapshotText+" • "+gateText,
    "Revalidate on MarketPulse before acting."
  ].join("\n");
  return {
    signalKey:key,symbol:"BTC",symbolCode:symbol,interval,style,side,setup,
    title:"MARKETPULSE • BTC "+side+" • SIGNAL SNAPSHOT",
    body,score:Number.isFinite(score)?score:null,
    status:"CONFIRMED",
    gate:gateText,
    details:{
      timeframe:interval,
      style,
      setup,
      side,
      score:Number.isFinite(score)?score:null,
      rr:Number.isFinite(rr)?rr:null,
      entryLow:levels.entryLow??null,
      entryHigh:levels.entryHigh??null,
      stop:levels.stop??null,
      tp1:levels.tp1??null,
      tp2:levels.tp2??null,
      gate:gateText
    },
    levels:{entryLow:levels.entryLow??null,entryHigh:levels.entryHigh??null,entry:levels.entry??null,stop:levels.stop??null,tp1:levels.tp1??null,tp2:levels.tp2??null,rr:Number.isFinite(rr)?rr:null},
    candleTs:candleTs||null,createdAt:new Date().toISOString(),
    url:"/?view=overview&symbol=BTCUSDT&interval="+encodeURIComponent(interval)
  };
}

function isWeekday(ts){
  const day=new Date(Number(ts||Date.now())).getUTCDay();
  return day>=1&&day<=5;
}

function buildOpportunityAlert({decision,symbol,interval,candleTs}){
  if(!OPPORTUNITY_ALERTS_ENABLED)return null;
  if(symbol!=="BTCUSDT"||!["15m","1h","4h"].includes(interval))return null;
  if(!isWeekday(candleTs||Date.now()))return null;
  const side=String(decision?.action||"").toUpperCase();
  if(!["LONG","SHORT"].includes(side))return null;
  if(decision?.stale===true)return null;
  const score=Number(decision?.market?.confluenceScore??0);
  const rr=Number(decision?.levels?.rr??0);
  const dataScore=Number(decision?.dataQuality?.score??decision?.dataQualityScore??decision?.analysis?.dataQualityScore??0);
  const derivatives=decision?.derivatives||decision?.liveFlow||{};
  if(Number.isFinite(score)===false||score<OPPORTUNITY_MIN_SCORE)return null;
  if(Number.isFinite(rr)===false||rr<OPPORTUNITY_MIN_RR)return null;
  if(Number.isFinite(dataScore)===false||dataScore<OPPORTUNITY_MIN_DATA)return null;
  if(derivatives.available===false)return null;
  const gate=String(decision?.deploymentGate?.state||"PAPER_ONLY").toUpperCase();
  if(gate==="BLOCKED")return null;

  const setup=normaliseSetup(decision);
  const style=signalStyle(interval);
  const levels=decision?.levels||{};
  const candle=Number(candleTs||decision?.candleTs||Date.now());
  const setupKey=String(decision?.phase14?.intelligence?.setupKey||"GENERIC").toUpperCase();
  const key=["OPPORTUNITY",symbol,interval,candle,side,setupKey].join("|");
  const scoreText=Math.round(score)+"/100";
  const rrText=rr.toFixed(2);
  const entryText=levels.entryLow!=null&&levels.entryHigh!=null
    ?price(levels.entryLow)+" – "+price(levels.entryHigh)
    :price(levels.entryLow??levels.entry);
  const confirmed=decision?.state==="READY"&&decision?.liveSignalEligible===true&&String(decision?.signalStability?.state||"").toUpperCase()==="CONFIRMED";
  const body=[
    "WEEKDAY OPPORTUNITY • "+interval+" "+style,
    "BTC "+side+" • Score "+scoreText+" • R:R "+rrText,
    "Setup "+setup+" • Entry "+entryText,
    "SL "+price(levels.stop)+" • TP1 "+price(levels.tp1),
    confirmed?"Confirmed setup • revalidate now.":"Early directional setup • wait for final confirmation.",
  ].join("\n");
  return {
    signalKey:key,symbol:"BTC",symbolCode:symbol,interval,style,side,setup,
    title:"MARKETPULSE • BTC "+side+" • OPPORTUNITY",
    body,score,rr,status:confirmed?"CONFIRMED":"EARLY",gate:gate==="PAPER_ONLY"?"PAPER-ONLY":"READY",
    details:{timeframe:interval,style,setup,side,score,rr,dataScore,entry:levels.entry,stop:levels.stop,tp1:levels.tp1,tp2:levels.tp2,status:confirmed?"CONFIRMED":"EARLY",weekdayOnly:true},
    candleTs:candle,createdAt:new Date().toISOString(),
    url:"/?view=overview&symbol=BTCUSDT&interval="+encodeURIComponent(interval)
  };
}

async function notifyAdminOpportunity(storage,context){
  await ensureConfigured(storage);
  const alert=buildOpportunityAlert(context);
  if(!alert)return {sent:false,reason:"not_opportunity_eligible"};
  try{
    const claimed=await storage.claimAdminSignalAlert(alert.signalKey,alert);
    if(claimed?.delivered)return {sent:false,duplicate:true,alreadyDelivered:true,alert};
    let delivered=0,expired=0;
    if(pushConfigured()){
      const subs=await storage.listAdminPushSubscriptions(50);
      for(const row of subs){
        try{
          await webpush.sendNotification(row.subscription,JSON.stringify({
            type:"MARKETPULSE_OPPORTUNITY",
            title:alert.title,
            body:alert.body,
            icon:"/marketpulse-icon.svg",
            badge:"/marketpulse-icon.svg",
            tag:"marketpulse-opportunity-"+alert.signalKey,
            renotify:true,
            requireInteraction:false,
            data:{url:alert.url,signalKey:alert.signalKey,alert:alert}
          }),{TTL:120,urgency:"normal"});
          delivered++;
        }catch(error){
          const status=Number(error?.statusCode||error?.status||0);
          if(status===404||status===410){
            await storage.deleteAdminPushSubscription(row.endpoint).catch(()=>{});
            expired++;
          }
        }
      }
    }
    if(delivered>0)await storage.markAdminSignalAlertDelivered(alert.signalKey,delivered).catch(()=>{});
    return {sent:delivered>0,delivered,expired,configured:pushConfigured(),alert};
  }catch(error){
    return {sent:false,error:String(error?.message||error),alert};
  }
}

async function notifyAdminSignal(storage,context){
  await ensureConfigured(storage);
  const alert=buildSignalAlert(context);
  if(!alert)return {sent:false,reason:"not_alert_eligible"};
  try{
    const claimed=await storage.claimAdminSignalAlert(alert.signalKey,alert);
    if(claimed?.delivered)return {sent:false,duplicate:true,alreadyDelivered:true,alert};
    let delivered=0,expired=0;
    if(pushConfigured()){
      const subs=await storage.listAdminPushSubscriptions(50);
      for(const row of subs){
        try{
          await webpush.sendNotification(row.subscription,JSON.stringify({
            type:"MARKETPULSE_SIGNAL",
            title:alert.title,
            body:alert.body,
            icon:"/marketpulse-icon.svg",
            badge:"/marketpulse-icon.svg",
            tag:"marketpulse-"+alert.signalKey,
            renotify:true,
            requireInteraction:true,
            data:{url:alert.url,signalKey:alert.signalKey,alert:alert}
          }),{TTL:300,urgency:"high"});
          delivered++;
        }catch(error){
          const status=Number(error?.statusCode||error?.status||0);
          if(status===404||status===410){
            await storage.deleteAdminPushSubscription(row.endpoint).catch(()=>{});
            expired++;
          }
        }
      }
    }
    if(delivered>0){
      await storage.markAdminSignalAlertDelivered(alert.signalKey,delivered).catch(()=>{});
    }
    return {sent:delivered>0,delivered,expired,configured:pushConfigured(),alert};
  }catch(error){
    return {sent:false,error:String(error?.message||error),alert};
  }
}

async function sendAdminTest(storage){
  await ensureConfigured(storage);
  if(!pushConfigured())return {sent:false,configured:false,delivered:0,expired:0};
  const subs=await storage.listAdminPushSubscriptions(50);
  let delivered=0,expired=0;
  for(const row of subs){
    try{
      await webpush.sendNotification(row.subscription,JSON.stringify({
        type:"MARKETPULSE_TEST",
        title:"MarketPulse · Push test",
        body:"Admin BTC signal notifications are connected.",
        icon:"/marketpulse-icon-v4.svg",
        badge:"/marketpulse-icon-v4.svg",
        tag:"marketpulse-push-test",
        renotify:true,
        data:{url:"/?view=admin"}
      }),{TTL:300,urgency:"high"});
      delivered++;
    }catch(error){
      const status=Number(error?.statusCode||error?.status||0);
      if(status===404||status===410){
        await storage.deleteAdminPushSubscription(row.endpoint).catch(()=>{});
        expired++;
      }
    }
  }
  return {sent:delivered>0,configured:true,delivered,expired,subscriptions:subs.length};
}

function config(){
  return {
    enabled:ENABLED,
    pushEnabled:pushConfigured(),

    publicKey:pushConfigured()?VAPID_PUBLIC_KEY:null,
    symbol:"BTCUSDT",
    intervals:["15m","1h","4h"],
    note:"Admin-only confirmed BTC signal notifications."
  };
}

module.exports={buildSignalAlert,notifyAdminSignal,buildOpportunityAlert,notifyAdminOpportunity,sendAdminTest,ensureConfigured,config,pushConfigured,normaliseSetup,signalStyle};
