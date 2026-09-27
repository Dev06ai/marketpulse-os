const webpush=require("web-push");

const ENABLED=String(process.env.MARKETPULSE_SIGNAL_ALERTS_ENABLED??"true").toLowerCase()!=="false";
const PUBLIC_KEY=String(process.env.MARKETPULSE_VAPID_PUBLIC_KEY||"").trim();
const PRIVATE_KEY=String(process.env.MARKETPULSE_VAPID_PRIVATE_KEY||"").trim();
const CONTACT_EMAIL=String(process.env.MARKETPULSE_ADMIN_EMAIL||"admin@marketpulse.local").trim();
let VAPID_READY=false;
if(ENABLED&&PUBLIC_KEY&&PRIVATE_KEY){
  try{
    webpush.setVapidDetails("mailto:"+CONTACT_EMAIL,PUBLIC_KEY,PRIVATE_KEY);
    VAPID_READY=true;
  }catch(e){
    console.error("MarketPulse push configuration error:",e.message);
  }
}
function pushConfigured(){
  return Boolean(ENABLED&&PUBLIC_KEY&&PRIVATE_KEY&&VAPID_READY);
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
  const body=[
    setup,
    "Score "+(Number.isFinite(score)?Math.round(score):"—")+"/100",
    "Entry "+price(levels.entryLow??levels.entry),
    "SL "+price(levels.stop),
    "TP1 "+price(levels.tp1),
    Number.isFinite(rr)?"R:R "+rr.toFixed(2):null,
    gate==="PAPER_ONLY"?"PAPER-ONLY":"READY"
  ].filter(Boolean).join(" · ");
  return {
    signalKey:key,symbol:"BTC",symbolCode:symbol,interval,style,side,setup,
    title,body,score:Number.isFinite(score)?score:null,
    levels:{entryLow:levels.entryLow??null,entryHigh:levels.entryHigh??null,entry:levels.entry??null,stop:levels.stop??null,tp1:levels.tp1??null,tp2:levels.tp2??null,rr:Number.isFinite(rr)?rr:null},
    candleTs:candleTs||null,createdAt:new Date().toISOString(),
    url:"/?view=overview&symbol=BTCUSDT&interval="+encodeURIComponent(interval)
  };
}

async function notifyAdminSignal(storage,context){
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
            icon:"/manifest-icon-192.png",
            badge:"/manifest-icon-192.png",
            tag:"marketpulse-"+alert.signalKey,
            renotify:true,
            data:{url:alert.url,signalKey:alert.signalKey}
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

function config(){
  return {
    enabled:ENABLED,
    pushEnabled:pushConfigured(),
    publicKey:pushConfigured()?PUBLIC_KEY:null,
    symbol:"BTCUSDT",
    intervals:["15m","1h","4h"],
    note:"Admin-only confirmed BTC signal notifications."
  };
}

module.exports={buildSignalAlert,notifyAdminSignal,config,pushConfigured,normaliseSetup,signalStyle};
