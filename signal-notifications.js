const webpush=require("web-push");
const ENABLED=String(process.env.MARKETPULSE_SIGNAL_ALERTS_ENABLED??"true").toLowerCase()!=="false";
const ENV_PUBLIC_KEY=String(process.env.MARKETPULSE_VAPID_PUBLIC_KEY||"").trim();
const ENV_PRIVATE_KEY=String(process.env.MARKETPULSE_VAPID_PRIVATE_KEY||"").trim();
const CONTACT_EMAIL=String(process.env.MARKETPULSE_ADMIN_EMAIL||"admin@marketpulse.local").trim();

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

module.exports={buildSignalAlert,notifyAdminSignal,sendAdminTest,config,pushConfigured,normaliseSetup,signalStyle};
