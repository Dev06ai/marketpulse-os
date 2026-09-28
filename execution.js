const crypto=require("crypto");
let WebSocket=null;try{WebSocket=require("ws")}catch{}
const storage=require("./storage");
const phase6=require("./phase6");

const VERSION=1;
const MODE_VALUES=["SIMULATION","TESTNET","LIVE"];
const MAX_ORDERS=300;
const MAX_POSITIONS=50;
const MAX_EVENTS=500;
const MAX_JOURNAL=500;
const BOT_STRATEGY_VALUES=["SCALP","INTRADAY","SWING","POSITION"];
const BOT_MODE_VALUES=["OFF","PAPER","TESTNET","LIVE"];
const AUTOTRADER_STATUS_CACHE={ts:0,payload:null,ttl:3000};

const DEFAULT_CONFIG={
  mode:"SIMULATION",
  category:"linear",
  account:100000,
  riskPct:1,
  maxOpenRiskPct:2.5,
  maxDailyLossPct:3,
  maxPositions:3,
  maxSymbolExposurePct:2,
  maxOrdersPerMinute:10,
  maxSlippageBps:20,
  maxIntentAgeMs:15000,
  allowMarketOrders:false,
  requireReconciliation:true
};

let wsState={ws:null,connected:false,retryMs:1000,reconnectTimer:null,lastMessageAt:null,lastError:null,started:false};

function finite(x,fallback=null){return Number.isFinite(Number(x))?Number(x):fallback}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function now(){return Date.now()}
function clone(x){return JSON.parse(JSON.stringify(x))}
function todayKey(ts=now()){return new Date(ts).toISOString().slice(0,10)}
function orderId(){return "MP5O-"+now().toString(36)+"-"+Math.random().toString(36).slice(2,8)}
function intentId(){return "MP5I-"+now().toString(36)+"-"+Math.random().toString(36).slice(2,7)}
function eventId(){return "MP5E-"+now().toString(36)+"-"+Math.random().toString(36).slice(2,7)}
function linkId(id){return String(id).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,36)}

function defaultState(){
  return {
    version:VERSION,
    config:Object.assign({},DEFAULT_CONFIG),
    control:{
      armed:false,
      killSwitch:false,
      reconciliation:{ok:true,checkedAt:null,detail:"Simulation mode has no external reconciliation requirement."}
    },
    orders:[],
    positions:[],
    events:[],
    journal:[],
    fills:[],
    metrics:{
      startingEquity:DEFAULT_CONFIG.account,
      realizedPnl:0,
      realizedR:0,
      dayKey:todayKey(),
      dayStartPnl:0
    },
    health:{lastError:null,lastActionAt:null},
    bot:{
      enabled:false,
      mode:"PAPER",
      symbols:["BTCUSDT"],
      strategies:{SCALP:true,INTRADAY:true,SWING:true,POSITION:false},
      riskByStrategy:{SCALP:0.25,INTRADAY:0.5,SWING:0.75,POSITION:1},
      maxPositions:1,
      maxDailyTrades:4,
      cooldownMs:900000,
      easyMode:true,
      weekdayOnly:true,
      autoManage:true,
      minScore:72,
      minRR:1.2,
      minDataScore:80,
      requireConfirmed:false,
      lastTradeAt:null,
      tradesToday:0,
      dayKey:todayKey(),
      lastSignalKey:null,
      lastDecisionAt:null,
      lastAction:"IDLE",
      lastError:null,
      learning:{
        resolved:0,wins:0,losses:0,netR:0,lastOutcomeAt:null,lastOutcome:null,
        byStrategy:{},bySetup:{},byRegime:{},recent:[],model:{bias:0,updates:0,learningRate:0.08}
      }
    }
  };
}

function ensureState(raw){
  const s=raw&&typeof raw==="object"?raw:defaultState(),d=defaultState();
  s.version=VERSION;
  s.config=Object.assign({},d.config,s.config||{});
  s.config.mode=MODE_VALUES.includes(s.config.mode)?s.config.mode:"SIMULATION";
  s.config.category="linear";
  s.config.account=Math.max(0,finite(s.config.account,d.config.account));
  s.config.riskPct=clamp(finite(s.config.riskPct,1),0.05,5);
  s.config.maxOpenRiskPct=clamp(finite(s.config.maxOpenRiskPct,2.5),0.5,10);
  s.config.maxDailyLossPct=clamp(finite(s.config.maxDailyLossPct,3),0.5,20);
  s.config.maxPositions=Math.round(clamp(finite(s.config.maxPositions,3),1,20));
  s.config.maxSymbolExposurePct=clamp(finite(s.config.maxSymbolExposurePct,2),0.25,20);
  s.config.maxOrdersPerMinute=Math.round(clamp(finite(s.config.maxOrdersPerMinute,10),1,60));
  s.config.maxSlippageBps=clamp(finite(s.config.maxSlippageBps,20),0,200);
  s.config.maxIntentAgeMs=Math.round(clamp(finite(s.config.maxIntentAgeMs,15000),2000,120000));
  s.config.allowMarketOrders=Boolean(s.config.allowMarketOrders);
  s.config.requireReconciliation=s.config.requireReconciliation!==false;
  s.control=Object.assign({},d.control,s.control||{});
  s.control.armed=Boolean(s.control.armed);
  s.control.killSwitch=s.control.killSwitch!==false;
  s.control.reconciliation=Object.assign({},d.control.reconciliation,s.control.reconciliation||{});
  s.orders=Array.isArray(s.orders)?s.orders.slice(-MAX_ORDERS):[];
  s.positions=Array.isArray(s.positions)?s.positions.slice(-MAX_POSITIONS):[];
  s.events=Array.isArray(s.events)?s.events.slice(-MAX_EVENTS):[];
  s.journal=Array.isArray(s.journal)?s.journal.slice(-MAX_JOURNAL):[];
  s.fills=Array.isArray(s.fills)?s.fills.slice(-MAX_ORDERS*3):[];
  s.metrics=Object.assign({},d.metrics,s.metrics||{});
  s.metrics.startingEquity=Math.max(0,finite(s.metrics.startingEquity,s.config.account));
  s.metrics.realizedPnl=finite(s.metrics.realizedPnl,0);
  s.metrics.realizedR=finite(s.metrics.realizedR,0);
  if(s.metrics.dayKey!==todayKey()){
    s.metrics.dayKey=todayKey();
    s.metrics.dayStartPnl=s.metrics.realizedPnl;
  }
  s.metrics.dayStartPnl=finite(s.metrics.dayStartPnl,s.metrics.realizedPnl);
  s.health=Object.assign({},d.health,s.health||{});
  s.bot=Object.assign({},d.bot,s.bot||{});
  s.bot.enabled=Boolean(s.bot.enabled);
  s.bot.mode=BOT_MODE_VALUES.includes(s.bot.mode)?s.bot.mode:"PAPER";
  s.bot.symbols=Array.isArray(s.bot.symbols)?Array.from(new Set(s.bot.symbols.map(x=>String(x).toUpperCase()).filter(Boolean))).slice(0,20):["BTCUSDT"];
  s.bot.strategies=Object.assign({},d.bot.strategies,s.bot.strategies||{});
  BOT_STRATEGY_VALUES.forEach(k=>{s.bot.strategies[k]=Boolean(s.bot.strategies[k])});
  s.bot.riskByStrategy=Object.assign({},d.bot.riskByStrategy,s.bot.riskByStrategy||{});
  BOT_STRATEGY_VALUES.forEach(k=>{s.bot.riskByStrategy[k]=clamp(finite(s.bot.riskByStrategy[k],d.bot.riskByStrategy[k]),0.05,2)});
  s.bot.maxPositions=Math.round(clamp(finite(s.bot.maxPositions,1),1,10));
  s.bot.maxDailyTrades=Math.round(clamp(finite(s.bot.maxDailyTrades,4),1,50));
  s.bot.cooldownMs=Math.round(clamp(finite(s.bot.cooldownMs,900000),60000,86400000));
  const hadLegacyBotThresholds=(!Object.prototype.hasOwnProperty.call(s.bot,"easyMode")||s.bot.easyMode===true)&&Number(s.bot.minScore)===78&&Number(s.bot.minRR)===1.5;
  s.bot.easyMode=s.bot.easyMode!==false;
  s.bot.weekdayOnly=s.bot.weekdayOnly!==false;
  s.bot.autoManage=s.bot.autoManage!==false;
  s.bot.minScore=clamp(finite(s.bot.minScore,72),70,100);
  s.bot.minRR=clamp(finite(s.bot.minRR,1.2),1.1,5);
  s.bot.minDataScore=clamp(finite(s.bot.minDataScore,80),70,100);
  s.bot.requireConfirmed=Boolean(s.bot.requireConfirmed);
  if(hadLegacyBotThresholds&&s.bot.easyMode){
    s.bot.minScore=72;
    s.bot.minRR=1.2;
    s.bot.requireConfirmed=false;
  }
  s.bot.learning=Object.assign({},d.bot.learning,s.bot.learning||{});
  s.bot.learning.resolved=Math.max(0,Math.round(finite(s.bot.learning.resolved,0)));
  s.bot.learning.wins=Math.max(0,Math.round(finite(s.bot.learning.wins,0)));
  s.bot.learning.losses=Math.max(0,Math.round(finite(s.bot.learning.losses,0)));
  s.bot.learning.netR=finite(s.bot.learning.netR,0);
  s.bot.learning.recent=Array.isArray(s.bot.learning.recent)?s.bot.learning.recent.slice(-50):[];
  s.bot.learning.byStrategy=Object.assign({},d.bot.learning.byStrategy,s.bot.learning.byStrategy||{});
  s.bot.learning.bySetup=Object.assign({},d.bot.learning.bySetup,s.bot.learning.bySetup||{});
  s.bot.learning.byRegime=Object.assign({},d.bot.learning.byRegime,s.bot.learning.byRegime||{});
  s.bot.learning.model=Object.assign({},d.bot.learning.model,s.bot.learning.model||{});
  if(s.bot.dayKey!==todayKey()){s.bot.dayKey=todayKey();s.bot.tradesToday=0;s.bot.lastSignalKey=null}
  s.bot.tradesToday=Math.max(0,Math.round(finite(s.bot.tradesToday,0)));
  return s;
}

async function load(){
  const r=await storage.getExecutionState();
  return {state:ensureState(r.payload||defaultState()),storage:r.storage};
}
async function save(state){
  state=ensureState(state);
  state.health.lastActionAt=now();
  return storage.saveExecutionState(state);
}

function pushEvent(state,type,message,meta={}){
  const row={id:eventId(),ts:now(),type,message,meta};
  state.events.push(row);state.events=state.events.slice(-MAX_EVENTS);
  return row;
}

function credentials(mode="TESTNET"){
  const live=mode==="LIVE";
  const apiKey=String(process.env[live?"BYBIT_LIVE_API_KEY":"BYBIT_API_KEY"]||"");
  const apiSecret=String(process.env[live?"BYBIT_LIVE_API_SECRET":"BYBIT_API_SECRET"]||"");
  return {
    mode,
    apiKey,apiSecret,
    configured:Boolean(apiKey&&apiSecret),
    host:String(process.env[live?"BYBIT_LIVE_API_HOST":"BYBIT_API_HOST"]||(live?"https://api.bybit.com":"https://api-testnet.bybit.com")),
    ws:String(process.env[live?"BYBIT_LIVE_API_WS":"BYBIT_API_WS"]||(live?"wss://stream.bybit.com/v5/private":"wss://stream-testnet.bybit.com/v5/private"))
  };
}

async function fetchJson(url,opts={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(opts.timeout||7000));
  try{
    const res=await fetch(url,{method:opts.method||"GET",headers:opts.headers||{},body:opts.body,signal:controller.signal});
    const raw=await res.text();let body={};try{body=JSON.parse(raw)}catch{}
    if(!res.ok)throw new Error("HTTP "+res.status+(body?.retMsg?": "+body.retMsg:""));
    return body;
  }finally{clearTimeout(timer)}
}

class BybitTestnetAdapter{
  constructor(mode="TESTNET"){this.mode=mode;this.c=credentials(mode);this.recvWindow="5000"}
  configured(){return this.c.configured}
  sign(timestamp,payload){return crypto.createHmac("sha256",this.c.apiSecret).update(String(timestamp)+this.c.apiKey+this.recvWindow+payload).digest("hex")}
  async privateRequest(method,path,params={}){
    if(!this.configured())throw new Error("BYBIT_API_KEY/BYBIT_API_SECRET not configured on server");
    const timestamp=String(now());
    let payload="";
    const headers={"X-BAPI-API-KEY":this.c.apiKey,"X-BAPI-TIMESTAMP":timestamp,"X-BAPI-RECV-WINDOW":this.recvWindow};
    let url=this.c.host+path;
    if(method==="GET"){
      const qs=new URLSearchParams();
      Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).forEach(([k,v])=>{if(v!==undefined&&v!==null)qs.set(k,String(v))});
      payload=qs.toString();if(payload)url+="?"+payload;
    }else{
      payload=JSON.stringify(params);
      headers["Content-Type"]="application/json";
    }
    headers["X-BAPI-SIGN"]=this.sign(timestamp,payload);
    const j=await fetchJson(url,{method,headers,body:method==="GET"?undefined:payload,timeout:7000});
    if(Number(j.retCode)!==0)throw new Error(j.retMsg||("Bybit retCode "+j.retCode));
    return j.result||{};
  }
  async publicRequest(path,params={}){
    const qs=new URLSearchParams();
    Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null)qs.set(k,String(v))});
    const j=await fetchJson(this.c.host+path+"?"+qs.toString(),{timeout:5000});
    if(Number(j.retCode)!==0)throw new Error(j.retMsg||("Bybit retCode "+j.retCode));
    return j.result||{};
  }
  async instrument(symbol){
    const r=await this.publicRequest("/v5/market/instruments-info",{category:"linear",symbol});
    const x=r?.list?.[0];
    if(!x)throw new Error("Bybit instrument not found for "+symbol);
    return x;
  }
  async ticker(symbol){
    const r=await this.publicRequest("/v5/market/tickers",{category:"linear",symbol});
    return r?.list?.[0]||null;
  }
  async placeLimit({symbol,side,qty,price,stop,target,orderLinkId}){
    const params={
      category:"linear",symbol,side,orderType:"Limit",qty:String(qty),price:String(price),
      timeInForce:"GTC",positionIdx:0,orderLinkId:linkId(orderLinkId||intentId()),
      reduceOnly:false,takeProfit:String(target),stopLoss:String(stop),
      tpTriggerBy:"MarkPrice",slTriggerBy:"MarkPrice"
    };
    const r=await this.privateRequest("POST","/v5/order/create",params);
    return {orderId:r.orderId,orderLinkId:r.orderLinkId||params.orderLinkId,raw:r};
  }
  async cancel({symbol,orderId:externalOrderId}){
    return this.privateRequest("POST","/v5/order/cancel",{category:"linear",symbol,orderId:externalOrderId});
  }
  async openOrders(symbol){
    const params={category:"linear",openOnly:0,limit:50};
    if(symbol)params.symbol=symbol;
    const r=await this.privateRequest("GET","/v5/order/realtime",params);
    return Array.isArray(r.list)?r.list:[];
  }
  async positions(symbol){
    const params={category:"linear"};
    if(symbol)params.symbol=symbol;
    const r=await this.privateRequest("GET","/v5/position/list",params);
    return Array.isArray(r.list)?r.list:[];
  }
}

const testnetAdapter=new BybitTestnetAdapter("TESTNET");
const liveAdapter=new BybitTestnetAdapter("LIVE");
function adapterFor(state){return state?.config?.mode==="LIVE"?liveAdapter:testnetAdapter}


function activeOrders(state){return state.orders.filter(o=>!["FILLED","CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(o.status))}
function activePositions(state){return state.positions.filter(p=>Math.abs(finite(p.qty,0)||0)>0)}
function openRiskPct(state){
  const account=Math.max(1,finite(state.config.account,1));
  const cash=activePositions(state).reduce((a,p)=>a+(finite(p.riskCash,0)||0),0);
  return cash/account*100;
}
function symbolExposurePct(state,symbol){
  const account=Math.max(1,finite(state.config.account,1));
  const notional=activePositions(state).filter(p=>p.symbol===symbol).reduce((a,p)=>a+Math.abs((finite(p.entry,0)||0)*(finite(p.qty,0)||0)),0);
  return notional/account*100;
}
function ordersLastMinute(state){
  const cutoff=now()-60000;
  return state.orders.filter(o=>Number(o.createdAt||0)>=cutoff).length;
}
function dailyLossPct(state){
  const loss=state.metrics.realizedPnl-state.metrics.dayStartPnl;
  return loss<0?Math.abs(loss)/Math.max(1,state.config.account)*100:0;
}
function formatQty(n,step){
  n=finite(n,0)||0;step=finite(step,0.000001)||0.000001;
  const decimals=Math.max(0,Math.min(10,(String(step).split(".")[1]||"").length));
  return (Math.floor(n/step)*step).toFixed(decimals).replace(/\.?0+$/,"");
}
function formatPrice(n,tick){
  n=finite(n,0)||0;tick=finite(tick,0.01)||0.01;
  const decimals=Math.max(0,Math.min(10,(String(tick).split(".")[1]||"").length));
  return (Math.round(n/tick)*tick).toFixed(decimals).replace(/\.?0+$/,"");
}

async function marketGate(plan,state){
  const p=plan||{};
  const entry=finite(p.entry),stop=finite(p.stop),target=finite(p.target);
  const riskDistance=entry!==null&&stop!==null?Math.abs(entry-stop):NaN;
  const reward=entry!==null&&target!==null?Math.abs(target-entry):NaN;
  const rr=entry!==null&&stop!==null&&target!==null&&riskDistance>0?reward/riskDistance:NaN;
  const riskPct=clamp(finite(p.riskPct,state.config.riskPct),0.05,5);
  const riskCash=Math.max(0,finite(state.config.account,0)||0)*riskPct/100;
  const qtyRaw=finite(p.qty)||(riskDistance>0?riskCash/riskDistance:NaN);
  let qty=qtyRaw,price=entry;
  const symbol=String(p.symbol||"").toUpperCase();
  if(!symbol)return {allowed:false,reason:"SYMBOL REQUIRED"};
  if(entry===null||stop===null||target===null||riskDistance<=0)return {allowed:false,reason:"INVALID LEVELS"};
  const minRR=p.easyMode?1.2:1.5;
  if(rr<minRR)return {allowed:false,reason:"R:R BELOW "+minRR.toFixed(2)};
  if(!Number.isFinite(qty)||qty<=0)return {allowed:false,reason:"INVALID POSITION SIZE"};
  const tradeRiskCash=Math.abs(entry-stop)*qty;
  const tradeRiskPct=tradeRiskCash/Math.max(1,state.config.account)*100;
  if(tradeRiskCash>riskCash+1e-9)return {allowed:false,reason:"PER-TRADE RISK EXCEEDED",riskCash,tradeRiskCash,tradeRiskPct,allowedQty:riskDistance>0?riskCash/riskDistance:null};
  const exchangeAdapter=adapterFor(state);
  if((state.config.mode==="TESTNET"||state.config.mode==="LIVE")&&!exchangeAdapter.configured())return {allowed:false,reason:state.config.mode+" API CREDENTIALS NOT CONFIGURED"};
  if(state.config.mode==="LIVE"&&String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()!=="true")return {allowed:false,reason:"LIVE TRADING FEATURE FLAG IS OFF"};
  if(state.control.killSwitch)return {allowed:false,reason:"KILL SWITCH ACTIVE"};
  if((state.config.mode==="TESTNET"||state.config.mode==="LIVE")&&!state.control.armed)return {allowed:false,reason:state.config.mode+" EXECUTION NOT ARMED"};
  if(state.config.requireReconciliation&&!state.control.reconciliation.ok)return {allowed:false,reason:"RECONCILIATION BLOCK"};
  if(activePositions(state).length>=state.config.maxPositions)return {allowed:false,reason:"MAX POSITIONS"};
  const proposedRiskPct=tradeRiskPct;
  if(openRiskPct(state)+proposedRiskPct>state.config.maxOpenRiskPct+1e-9)return {allowed:false,reason:"MAX OPEN RISK"};
  if(symbolExposurePct(state,symbol)+(Math.abs(entry*qty)/Math.max(1,state.config.account)*100)>state.config.maxSymbolExposurePct+1e-9)return {allowed:false,reason:"MAX SYMBOL EXPOSURE"};
  if(dailyLossPct(state)>=state.config.maxDailyLossPct-1e-9)return {allowed:false,reason:"MAX DAILY LOSS"};
  if(ordersLastMinute(state)>=state.config.maxOrdersPerMinute)return {allowed:false,reason:"ORDER RATE LIMIT"};
  if(p.type==="MARKET"&&!state.config.allowMarketOrders)return {allowed:false,reason:"MARKET ORDERS DISABLED"};
  if(p.createdAt&&now()-Number(p.createdAt)>state.config.maxIntentAgeMs)return {allowed:false,reason:"INTENT EXPIRED"};

  if(state.config.mode==="TESTNET"||state.config.mode==="LIVE"){
    try{
      const [inst,t]=await Promise.all([exchangeAdapter.instrument(symbol),exchangeAdapter.ticker(symbol)]);
      const tick=inst.priceFilter?.tickSize||"0.01";
      const step=inst.lotSizeFilter?.qtyStep||"0.001";
      price=Number(formatPrice(entry,tick));qty=Number(formatQty(qty,step));
      if(!Number.isFinite(qty)||qty<=0)return {allowed:false,reason:"QTY BELOW EXCHANGE STEP"};
      const mark=finite(t?.markPrice??t?.lastPrice);
      if(mark!==null){
        const drift=Math.abs(price-mark)/mark*10000;
        if(drift>state.config.maxSlippageBps)return {allowed:false,reason:"ENTRY TOO FAR FROM MARK",markPrice:mark,driftBps:drift};
      }
      const portfolioGate=await phase6.executionGate({symbol,side:p.side,entry:price,stop:Number(formatPrice(stop,tick)),target:Number(formatPrice(target,tick)),qty,riskCash},state);
      if(!portfolioGate.allowed)return Object.assign({allowed:false},portfolioGate);
      const finalRiskCash=Math.abs(Number(formatPrice(entry,tick))-Number(formatPrice(stop,tick)))*qty;
      if(finalRiskCash>riskCash+1e-9)return {allowed:false,reason:"PER-TRADE RISK EXCEEDED AFTER EXCHANGE ROUNDING",riskCash,tradeRiskCash:finalRiskCash,tradeRiskPct:finalRiskCash/Math.max(1,state.config.account)*100,allowedQty:riskDistance>0?riskCash/riskDistance:null};
      return {allowed:true,reason:"PASS",entry:price,stop:Number(formatPrice(stop,tick)),target:Number(formatPrice(target,tick)),qty,riskCash,tradeRiskCash:finalRiskCash,tradeRiskPct:finalRiskCash/Math.max(1,state.config.account)*100,rr,markPrice:mark,driftBps:mark?Math.abs(price-mark)/mark*10000:null,instrument:inst,portfolio:portfolioGate};
    }catch(e){return {allowed:false,reason:"MARKET VALIDATION FAILED: "+e.message}}
  }
  const portfolioGate=await phase6.executionGate({symbol,side:p.side,entry,stop,target,qty,riskCash,intentId:p.id},state);
  if(!portfolioGate.allowed)return Object.assign({allowed:false},portfolioGate);
  return {allowed:true,reason:"PASS",entry,stop,target,qty,riskCash,riskPct,tradeRiskCash:Math.abs(entry-stop)*qty,tradeRiskPct:Math.abs(entry-stop)*qty/Math.max(1,state.config.account)*100,rr,markPrice:null,driftBps:null,portfolio:portfolioGate};
}

function findOrder(state,id){
  return state.orders.find(o=>o.id===id||o.orderLinkId===id||o.externalOrderId===id)||null;
}
function findPosition(state,key){
  return state.positions.find(p=>p.id===key||p.symbol===key||p.externalKey===key)||null;
}
function addJournal(state,row){state.journal.push(row);state.journal=state.journal.slice(-MAX_JOURNAL)}
function appendFill(state,fill){
  state.fills.push(fill);state.fills=state.fills.slice(-(MAX_ORDERS*3));
  if(finite(fill.execPnl)!==null)state.metrics.realizedPnl+=(finite(fill.execPnl,0)||0);
}

function updateOrderFromExchange(state,row){
  const o=findOrder(state,row.orderId||row.orderLinkId);
  if(!o)return;
  const statusMap={New:"OPEN",Created:"OPEN",PartiallyFilled:"PARTIALLY_FILLED",Filled:"FILLED",Cancelled:"CANCELLED",Rejected:"REJECTED",Deactivated:"EXPIRED",Triggered:"OPEN"};
  const previous=o.status;o.status=statusMap[row.orderStatus]||row.orderStatus||o.status;
  o.exchangeStatus=row.orderStatus||o.exchangeStatus;
  o.updatedAt=now();
  o.avgPrice=finite(row.avgPrice,o.avgPrice);
  o.cumExecQty=finite(row.cumExecQty,o.cumExecQty);
  o.leavesQty=finite(row.leavesQty,o.leavesQty);
  o.rejectReason=row.rejectReason||o.rejectReason||null;
  if(previous!==o.status)pushEvent(state,"ORDER_STATUS",o.symbol+" "+o.side+" · "+o.status,{orderId:o.id,externalOrderId:o.externalOrderId});
}
function upsertPosition(state,row){
  const symbol=String(row.symbol||"").toUpperCase(),qty=finite(row.size,0)||0;
  const side=row.side||"";
  const key=symbol+":"+String(row.positionIdx??0);
  let p=state.positions.find(x=>x.externalKey===key);
  if(!p){
    p={id:"MP5P-"+now().toString(36),externalKey:key,symbol,side,qty:0,entry:0,markPrice:0,riskCash:0,updatedAt:now(),source:"BYBIT"};
    state.positions.push(p);
  }
  p.side=side;p.positionIdx=finite(row.positionIdx,0);p.qty=qty;p.entry=finite(row.avgPrice??row.entryPrice,p.entry);p.markPrice=finite(row.markPrice,p.markPrice);p.leverage=finite(row.leverage,p.leverage);p.unrealisedPnl=finite(row.unrealisedPnl,p.unrealisedPnl);p.updatedAt=now();
  if(qty===0)p.riskCash=0;
  else if(!p.riskCash)p.riskCash=Math.abs(p.entry*qty)*state.config.riskPct/100;
  state.positions=state.positions.slice(-MAX_POSITIONS);
}

async function processWsMessage(state,msg){
  if(!msg||!msg.topic||!Array.isArray(msg.data))return;
  wsState.lastMessageAt=now();
  if(msg.topic==="order"||msg.topic.startsWith("order.")){
    msg.data.forEach(x=>updateOrderFromExchange(state,x));
  }else if(msg.topic==="execution"||msg.topic.startsWith("execution.")){
    for(const x of msg.data){
      const execPnl=finite(x.execPnl,0)||0;
      appendFill(state,{id:x.execId,orderId:x.orderId,orderLinkId:x.orderLinkId,symbol:x.symbol,side:x.side,qty:finite(x.execQty,0),price:finite(x.execPrice,0),fee:finite(x.execFee,0),execPnl,ts:finite(x.execTime,now())});
      const o=findOrder(state,x.orderId||x.orderLinkId);
      if(o){
        o.avgPrice=finite(x.execPrice,o.avgPrice);o.cumExecQty=(finite(o.cumExecQty,0)||0)+(finite(x.execQty,0)||0);o.updatedAt=now();
        if(o.source==="PHASE17_EASY_AUTOTRADER"||o.source==="PHASE17_AUTOTRADER"){
          const risk=Math.max(0.000001,Number(o.riskCash||0));
          const resultR=execPnl/risk;
          if(Math.abs(resultR)>=0.05){
            state.bot=ensureState(state).bot;
            const l=state.bot.learning;
            const outcome=resultR>0?"WIN":"LOSS";
            l.resolved+=1;if(outcome==="WIN")l.wins+=1;if(outcome==="LOSS")l.losses+=1;l.netR+=resultR;
            l.lastOutcomeAt=now();l.lastOutcome={outcome,resultR,strategy:o.strategy||null,setup:o.setup||null,regime:o.regime||null,symbol:o.symbol,side:o.side};
            updateBotBucket(l.byStrategy,o.strategy||"UNKNOWN",outcome,resultR);
            updateBotBucket(l.bySetup,o.setup||o.type||"UNKNOWN",outcome,resultR);
            updateBotBucket(l.byRegime,o.regime||"UNKNOWN",outcome,resultR);
            l.recent.push({ts:now(),outcome,resultR,strategy:o.strategy||null,setup:o.setup||o.type||null,regime:o.regime||null,symbol:o.symbol,side:o.side,score:Number(o.score)||0});
            l.recent=l.recent.slice(-50);
            pushEvent(state,"BOT_LEARNING_UPDATE","AutoTrader learned from exchange execution outcome",{outcome,resultR,strategy:o.strategy||null,setup:o.setup||null,regime:o.regime||null,score:Number(o.score)||0});
          }
        }
      }
    }
  }else if(msg.topic==="position"||msg.topic.startsWith("position.")){
    msg.data.forEach(x=>upsertPosition(state,x));
  }
  await save(state);
}

function connectPrivateWs(adapterInstance=testnetAdapter){
  if(wsState.started)return;
  if(!WebSocket){wsState.lastError="ws dependency unavailable";wsState.started=false;return}
  wsState.started=true;
  const loop=()=>{
    if(!adapterInstance.configured()){wsState.connected=false;wsState.lastError="BYBIT credentials not configured";wsState.started=false;return}
    const ws=new WebSocket(adapterInstance.c.ws);
    wsState.ws=ws;
    let pingTimer=null;
    ws.on("open",()=>{
      wsState.connected=false;
      const expires=now()+10000;
      const signature=crypto.createHmac("sha256",adapterInstance.c.apiSecret).update("GET/realtime"+expires).digest("hex");
      ws.send(JSON.stringify({op:"auth",args:[adapterInstance.c.apiKey,expires,signature]}));
      ws.send(JSON.stringify({op:"subscribe",args:["order","execution","position"]}));
      pingTimer=setInterval(()=>{try{ws.send(JSON.stringify({op:"ping"}))}catch{}},20000);
    });
    ws.on("message",async raw=>{
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.op==="auth"){wsState.connected=Boolean(msg.success);if(!msg.success)wsState.lastError=msg.ret_msg||"Private WS auth failed";return}
        const loaded=await load();await processWsMessage(loaded.state,msg);
      }catch(e){wsState.lastError=e.message}
    });
    ws.on("close",()=>{clearInterval(pingTimer);wsState.connected=false;wsState.ws=null;clearTimeout(wsState.reconnectTimer);wsState.reconnectTimer=setTimeout(loop,wsState.retryMs);wsState.retryMs=Math.min(wsState.retryMs*2,30000)});
    ws.on("error",e=>{wsState.lastError=e.message;try{ws.close()}catch{}});
    wsState.retryMs=1000;
  };
  loop();
}
if(testnetAdapter.configured())setTimeout(()=>connectPrivateWs(testnetAdapter),1000);

async function createIntent(plan){
  const loaded=await load(),state=loaded.state,p=plan||{};
  const symbol=String(p.symbol||"").toUpperCase(),side=String(p.side||"").toUpperCase();
  if(!["LONG","SHORT"].includes(side))throw new Error("Side must be LONG or SHORT");
  const entry=finite(p.entry),stop=finite(p.stop),target=finite(p.target);
  if(!symbol||entry===null||stop===null||target===null)throw new Error("Symbol, entry, stop and target are required");
  const riskDistance=Math.abs(entry-stop),reward=Math.abs(target-entry);
  if(riskDistance<=0)throw new Error("Stop must be different from entry");
  const minRR=p.easyMode?1.2:1.5;
  if(reward/riskDistance<minRR)throw new Error("Intent blocked: minimum R:R is "+minRR.toFixed(2));
  const duplicate=state.orders.find(o=>o.intentKey===[symbol,side,entry,stop,target,p.signalId||""].join("|")&&["INTENT","VALIDATING","APPROVED","SUBMITTED","ACKNOWLEDGED","OPEN","PARTIALLY_FILLED"].includes(o.status));
  if(duplicate)return clone(duplicate);
  const id=intentId();
  const riskPct=clamp(finite(p.riskPct,state.config.riskPct),0.05,5);
  const order={id,orderLinkId:linkId(id),intentKey:[symbol,side,entry,stop,target,p.signalId||""].join("|"),signalId:p.signalId||null,symbol,interval:p.interval||"1h",side,type:"LIMIT",status:"INTENT",entry,stop,target,tp2:finite(p.tp2),qty:finite(p.qty),rr:reward/riskDistance,riskPct,riskCash:state.config.account*riskPct/100,createdAt:now(),updatedAt:now(),externalOrderId:null,avgPrice:null,cumExecQty:0,leavesQty:null,source:p.source||"PHASE4",note:p.note||"",easyMode:Boolean(p.easyMode),strategy:p.strategy||null,setup:p.setup||null,regime:p.regime||null,score:Number(p.score)||0,maxHoldMs:Number(p.maxHoldMs)||0};
  state.orders.push(order);state.orders=state.orders.slice(-MAX_ORDERS);pushEvent(state,"INTENT_CREATED",symbol+" "+side+" execution intent created",{orderId:order.id,signalId:order.signalId});
  await save(state);return clone(order);
}

async function submitIntent(id){
  const loaded=await load(),state=loaded.state,o=findOrder(state,id),exchangeAdapter=adapterFor(state);
  if(!o)throw new Error("Execution intent not found");
  if(["SUBMITTED","ACKNOWLEDGED","OPEN","PARTIALLY_FILLED","FILLED"].includes(o.status))return clone(o);
  const plan={symbol:o.symbol,side:o.side,entry:o.entry,stop:o.stop,target:o.target,qty:o.qty,type:o.type,riskPct:o.riskPct,easyMode:o.easyMode,strategy:o.strategy,setup:o.setup,regime:o.regime,score:o.score,createdAt:o.createdAt};
  o.status="VALIDATING";o.updatedAt=now();
  let gate;
  try{gate=await marketGate(plan,state)}catch(e){gate={allowed:false,reason:e.message}}
  o.gate=gate;
  if(!gate.allowed){
    o.status="REJECTED";o.rejectReason=gate.reason;o.updatedAt=now();state.health.lastError=gate.reason;pushEvent(state,"EXECUTION_BLOCKED",o.symbol+" "+o.side+" blocked · "+gate.reason,{orderId:o.id});
    await save(state);return clone(o);
  }
  o.entry=gate.entry;o.stop=gate.stop;o.target=gate.target;o.qty=gate.qty;o.riskCash=gate.riskCash;o.rr=gate.rr;o.status="APPROVED";o.approvedAt=now();
  if(state.config.mode==="SIMULATION"){
    o.status="SUBMITTED";o.externalOrderId="SIM-"+o.id;o.exchangeStatus="Simulated";
    o.status="ACKNOWLEDGED";o.status="FILLED";o.avgPrice=o.entry;o.cumExecQty=o.qty;o.leavesQty=0;o.filledAt=now();o.updatedAt=now();
    const position={id:"MP5P-"+o.id,orderId:o.id,externalKey:"SIM:"+o.id,symbol:o.symbol,interval:o.interval,side:o.side,qty:o.qty,entry:o.entry,stop:o.stop,target:o.target,tp2:o.tp2??null,riskCash:o.riskCash,openedAt:now(),markPrice:o.entry,source:"SIMULATION",strategy:o.strategy||null,setup:o.setup||o.type||null,regime:o.regime||null,score:Number(o.score)||0,rr:Number(o.rr)||0,easyMode:Boolean(o.easyMode),maxHoldMs:Number(o.maxHoldMs||0)};
    state.positions.push(position);state.positions=state.positions.slice(-MAX_POSITIONS);
    state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode"};
    addJournal(state,{id:"MP5J-"+o.id,ts:now(),type:"SIMULATION_FILLED",orderId:o.id,symbol:o.symbol,side:o.side,qty:o.qty,price:o.entry,resultR:0,pnl:0,message:"Simulation fill created; position remains open until explicitly closed."});
    pushEvent(state,"SIMULATION_FILLED",o.symbol+" "+o.side+" · "+o.qty+" @ "+o.entry,{orderId:o.id});
  }else{
    const placed=await exchangeAdapter.placeLimit({symbol:o.symbol,side:o.side==="LONG"?"Buy":"Sell",qty:o.qty,price:o.entry,stop:o.stop,target:o.target,orderLinkId:o.orderLinkId});
    o.externalOrderId=placed.orderId;o.orderLinkId=placed.orderLinkId;o.status="ACKNOWLEDGED";o.exchangeStatus="Created";o.updatedAt=now();
    state.control.reconciliation={ok:false,checkedAt:now(),detail:"Awaiting exchange websocket/reconciliation after order acknowledgement."};
    pushEvent(state,"ORDER_ACKNOWLEDGED",o.symbol+" "+o.side+" accepted by Bybit "+String(state.config.mode).toLowerCase()+" · waiting for private stream confirmation",{orderId:o.id,externalOrderId:o.externalOrderId});
  }
  await save(state);return clone(o);
}

async function cancelOrder(id){
  const loaded=await load(),state=loaded.state,o=findOrder(state,id);
  if(!o)throw new Error("Order not found");
  if(state.config.mode==="SIMULATION"){
    if(["FILLED","CLOSED","CANCELLED"].includes(o.status))return clone(o);
    o.status="CANCELLED";o.updatedAt=now();pushEvent(state,"CANCELLED",o.symbol+" "+o.side+" simulation order cancelled",{orderId:o.id});await save(state);return clone(o);
  }
  if(!o.externalOrderId)throw new Error("Order has no exchange order id");
  await adapterFor(state).cancel({symbol:o.symbol,orderId:o.externalOrderId});
  o.status="CANCEL_REQUESTED";o.updatedAt=now();state.control.reconciliation={ok:false,checkedAt:now(),detail:"Cancel requested; waiting for websocket confirmation."};
  pushEvent(state,"CANCEL_REQUESTED",o.symbol+" "+o.side+" cancel sent",{orderId:o.id,externalOrderId:o.externalOrderId});
  await save(state);return clone(o);
}

async function manageSimulationPositions(markPrices={},opts={}){
  const loaded=await load(),state=loaded.state;
  if(state.config.mode!=="SIMULATION")return {ok:true,closed:0,mode:state.config.mode};
  let closed=0,results=[];
  const nowTs=now();
  for(const p of [...activePositions(state)]){
    if(p.source!=="SIMULATION")continue;
    const mark=finite(markPrices[p.symbol],p.markPrice);
    if(mark===null)continue;
    const age=nowTs-Number(p.openedAt||nowTs);
    const maxHoldMs=Number(p.maxHoldMs||opts.maxHoldMs||0);
    let exitReason=null,exitPrice=mark;
    if(p.side==="LONG"&&mark<=Number(p.stop))exitReason="STOP";
    else if(p.side==="LONG"&&mark>=Number(p.target))exitReason="TARGET";
    else if(p.side==="SHORT"&&mark>=Number(p.stop))exitReason="STOP";
    else if(p.side==="SHORT"&&mark<=Number(p.target))exitReason="TARGET";
    else if(maxHoldMs>0&&age>=maxHoldMs)exitReason="TIMEOUT";
    if(!exitReason)continue;
    const result=await closeSimulationPosition(p.id,exitPrice,{reason:exitReason,markPrice:mark});
    closed+=1;results.push({positionId:p.id,reason:exitReason,snapshot:result});
  }
  return {ok:true,closed,results};
}

async function closeSimulationPosition(positionId,exitPrice,meta={}){
  const loaded=await load(),state=loaded.state,p=state.positions.find(x=>x.id===positionId);
  if(!p)throw new Error("Position not found");
  if(state.config.mode!=="SIMULATION")throw new Error("Manual close is only available for simulation positions");
  const exit=finite(exitPrice);if(exit===null)throw new Error("Exit price required");
  const pnl=p.side==="LONG"?(exit-p.entry)*p.qty:(p.entry-exit)*p.qty;
  const r=p.riskCash?((pnl)/p.riskCash):0;
  const reason=String(meta.reason||"MANUAL").toUpperCase();
  state.metrics.realizedPnl+=pnl;state.metrics.realizedR+=r;state.positions=state.positions.filter(x=>x.id!==positionId);
  const o=p.orderId?findOrder(state,p.orderId):state.orders.find(x=>x.externalOrderId==="SIM-"+String(p.id).replace("MP5P-",""));
  if(o){
    o.status="CLOSED";
    o.closedAt=now();
    o.updatedAt=now();
    o.exitPrice=exit;
    o.exitReason=reason;
    o.pnl=pnl;
    o.resultR=r;
    o.durationMs=Math.max(0,Number(o.closedAt)-Number(o.filledAt||o.createdAt||o.closedAt));
  }
  addJournal(state,{id:"MP5J-C-"+positionId,ts:now(),type:"SIMULATION_CLOSED",positionId,orderId:p.orderId||o?.id||null,symbol:p.symbol,interval:p.interval||null,side:p.side,qty:p.qty,entry:p.entry,stop:p.stop,target:p.target,tp2:p.tp2??null,exit,resultR:r,pnl,openedAt:p.openedAt,closedAt:now(),durationMs:Math.max(0,now()-Number(p.openedAt||now())),strategy:p.strategy||null,setup:p.setup||null,regime:p.regime||null,score:Number(p.score)||0,rr:Number(p.rr)||0,easyMode:Boolean(p.easyMode),message:"Simulation trade closed · "+reason});
  pushEvent(state,"POSITION_CLOSED",p.symbol+" "+p.side+" closed · "+r.toFixed(2)+"R",{positionId,pnl,r,reason});
  if(String(p.source||"")==="SIMULATION"&&p.strategy){
    const outcome=r>0.05?"WIN":r<-0.05?"LOSS":"TIMEOUT";
    state.bot=ensureState(state).bot;
    // update learning atomically with the same persisted state
    const l=state.bot.learning;
    if(outcome!=="TIMEOUT"){l.resolved+=1;if(outcome==="WIN")l.wins+=1;if(outcome==="LOSS")l.losses+=1}
    l.netR+=r;l.lastOutcomeAt=now();l.lastOutcome={outcome,resultR:r,strategy:p.strategy,setup:p.setup||p.type,regime:p.regime,symbol:p.symbol,side:p.side};
    updateBotBucket(l.byStrategy,p.strategy,outcome,r);updateBotBucket(l.bySetup,p.setup||p.type||"UNKNOWN",outcome,r);updateBotBucket(l.byRegime,p.regime||"UNKNOWN",outcome,r);
    l.recent.push({ts:now(),outcome,resultR:r,strategy:p.strategy,setup:p.setup||p.type||"UNKNOWN",regime:p.regime||"UNKNOWN",symbol:p.symbol,side:p.side,score:Number(p.score)||0});
    l.recent=l.recent.slice(-50);
  }
  await save(state);return snapshot();
}

async function getBotTradeHistory(limit=100){
  const loaded=await load(),state=loaded.state,rows=[],seen=new Set();
  const push=row=>{
    const id=String(row.id||row.orderId||row.positionId||"");
    if(!id||seen.has(id))return;
    seen.add(id);rows.push(row);
  };
  // Closed paper/testnet/live orders
  for(const o of state.orders.slice().reverse()){
    const botOrder=String(o.source||"").startsWith("PHASE17_")||Boolean(o.strategy&&o.signalId);
    if(!botOrder)continue;
    const closed=String(o.status||"").toUpperCase()==="CLOSED"||Number.isFinite(Number(o.exitPrice))||Number.isFinite(Number(o.resultR));
    if(!closed)continue;
    push({
      id:o.id,orderId:o.id,externalOrderId:o.externalOrderId||null,symbol:o.symbol,interval:o.interval,side:o.side,
      strategy:o.strategy||null,setup:o.setup||o.type||null,regime:o.regime||null,score:Number(o.score)||0,
      rr:Number(o.rr)||0,riskPct:Number(o.riskPct)||0,riskCash:Number(o.riskCash)||0,qty:Number(o.qty)||0,
      entry:Number(o.avgPrice??o.entry)||null,plannedEntry:Number(o.entry)||null,stop:Number(o.stop)||null,
      target:Number(o.target)||null,tp2:Number(o.tp2)||null,exitPrice:Number(o.exitPrice)||null,
      pnl:Number(o.pnl)||0,resultR:Number(o.resultR)||0,outcome:o.resultR>0?"WIN":o.resultR<0?"LOSS":"FLAT",
      openedAt:Number(o.filledAt??o.createdAt)||null,closedAt:Number(o.closedAt??o.updatedAt)||null,
      durationMs:Number(o.durationMs)||null,exitReason:o.exitReason||null,status:o.status,
      source:o.source||null,note:o.note||null
    });
  }
  // Closed paper trades recorded in the journal.
  for(const j of state.journal.slice().reverse()){
    if(j.type!=="SIMULATION_CLOSED")continue;
    push({
      id:j.id,orderId:j.orderId||null,externalOrderId:null,symbol:j.symbol,interval:j.interval||null,side:j.side,
      strategy:j.strategy||null,setup:j.setup||null,regime:j.regime||null,score:Number(j.score)||0,rr:Number(j.rr)||0,
      riskPct:null,riskCash:null,qty:Number(j.qty)||0,entry:Number(j.entry)||null,plannedEntry:Number(j.entry)||null,
      stop:Number(j.stop)||null,target:Number(j.target)||null,tp2:Number(j.tp2)||null,exitPrice:Number(j.exit)||null,
      pnl:Number(j.pnl)||0,resultR:Number(j.resultR)||0,outcome:j.resultR>0?"WIN":j.resultR<0?"LOSS":"FLAT",
      openedAt:Number(j.openedAt)||null,closedAt:Number(j.closedAt||j.ts)||null,durationMs:Number(j.durationMs)||null,
      exitReason:String(j.message||"").split("·").pop().trim()||"UNKNOWN",status:"CLOSED",source:"JOURNAL",note:null
    });
  }
  rows.sort((a,b)=>Number(b.closedAt||b.openedAt||0)-Number(a.closedAt||a.openedAt||0));
  return {ok:true,version:VERSION,count:rows.length,trades:rows.slice(0,Math.max(1,Math.min(Number(limit)||100,500))),updatedAt:now()};
}
async function killSwitch(enable=true){
  const loaded=await load(),state=loaded.state;
  state.control.killSwitch=Boolean(enable);
  if(enable)state.control.armed=false;
  if(enable&&(state.config.mode==="TESTNET"||state.config.mode==="LIVE")){
    for(const o of activeOrders(state)){
      if(o.externalOrderId&&["ACKNOWLEDGED","OPEN","PARTIALLY_FILLED","SUBMITTED"].includes(o.status)){try{await adapter.cancel({symbol:o.symbol,orderId:o.externalOrderId});o.status="CANCEL_REQUESTED"}catch(e){state.health.lastError=e.message}}
    }
    state.control.reconciliation={ok:false,checkedAt:now(),detail:"Kill switch engaged; pending cancels require websocket/reconciliation confirmation."};
  }
  pushEvent(state,enable?"KILL_SWITCH_ON":"KILL_SWITCH_OFF",enable?"Execution halted. New orders blocked.":"Execution gate reopened; testnet still requires an explicit arm.",{});
  await save(state);return snapshot();
}

async function armTestnet(){
  const loaded=await load(),state=loaded.state;
  if(state.config.mode!=="TESTNET")throw new Error("Set execution mode to TESTNET before arming");
  if(!testnetAdapter.configured())throw new Error("BYBIT_API_KEY/BYBIT_API_SECRET are not configured on the server");
  state.control.armed=true;state.control.killSwitch=false;
  state.control.reconciliation={ok:false,checkedAt:null,detail:"Reconciliation required before the first order."};
  pushEvent(state,"TESTNET_ARMED","Bybit testnet execution armed; reconciliation is still required.",{});
  await save(state);return snapshot();
}
async function armLive(){
  const loaded=await load(),state=loaded.state;
  if(state.config.mode!=="LIVE")throw new Error("Set execution mode to LIVE before arming");
  if(String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()!=="true")throw new Error("LIVE_TRADING_ENABLED is not enabled");
  if(!liveAdapter.configured())throw new Error("BYBIT_LIVE_API_KEY/BYBIT_LIVE_API_SECRET are not configured on the server");
  state.control.armed=true;state.control.killSwitch=false;
  state.control.reconciliation={ok:false,checkedAt:null,detail:"LIVE reconciliation required before the first real order."};
  pushEvent(state,"LIVE_ARMED","Bybit live execution armed; reconciliation is still required before any real order.",{});
  connectPrivateWs(liveAdapter);
  await save(state);return snapshot();
}

async function setConfig(patch){
  const loaded=await load(),state=loaded.state,next=Object.assign({},state.config,patch||{});
  next.mode=MODE_VALUES.includes(next.mode)?next.mode:state.config.mode;
  if(next.mode==="LIVE"&&!String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase().includes("true")){
    throw new Error("LIVE_TRADING_ENABLED is OFF");
  }
  if(next.mode!=="TESTNET"&&next.mode!=="LIVE"){state.control.armed=false;state.control.killSwitch=false;state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode."}}
  state.config=Object.assign({},state.config,next);
  if(state.config.account>0&&state.metrics.startingEquity<=0)state.metrics.startingEquity=state.config.account;
  pushEvent(state,"CONFIG_UPDATED","Execution risk controls updated",{mode:state.config.mode});
  await save(state);return snapshot();
}

async function reconcile(){
  const loaded=await load(),state=loaded.state,exchangeAdapter=adapterFor(state);
  if(state.config.mode==="SIMULATION"){
    state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode has no exchange state to reconcile."};
    await save(state);return snapshot();
  }
  if(!exchangeAdapter.configured())throw new Error("Bybit "+String(state.config.mode).toLowerCase()+" credentials not configured");
  const symbols=Array.from(new Set(activeOrders(state).concat(activePositions(state)).map(x=>x.symbol).filter(Boolean)));
  const externalOrders=await exchangeAdapter.openOrders();
  const localOpen=activeOrders(state).filter(x=>x.externalOrderId);
  const openMismatch=localOpen.some(x=>!externalOrders.some(e=>e.orderId===x.externalOrderId)) || externalOrders.some(e=>!localOpen.some(x=>x.externalOrderId===e.orderId));
  const externalPositions=await exchangeAdapter.positions();
  const extPosMap=new Map(externalPositions.map(p=>[String(p.symbol)+":"+String(p.positionIdx??0),Math.abs(finite(p.size,0)||0)]));
  const localPosMap=new Map(activePositions(state).map(p=>[String(p.symbol)+":"+String(p.positionIdx??0),Math.abs(finite(p.qty,0)||0)]));
  let positionMismatch=false;
  for(const [k,v] of extPosMap)if((v>0)!==(localPosMap.get(k)>0))positionMismatch=true;
  for(const [k,v] of localPosMap)if((v>0)!==(extPosMap.get(k)>0))positionMismatch=true;
  const ok=!openMismatch&&!positionMismatch;
  state.control.reconciliation={ok,checkedAt:now(),detail:ok?"Local execution state matches "+String(state.config.mode).toLowerCase()+" open orders/positions.":"Mismatch detected; new execution is blocked until state is reconciled.",openMismatch,positionMismatch,externalOrders:externalOrders.map(x=>({orderId:x.orderId,symbol:x.symbol,status:x.orderStatus})),externalPositions:externalPositions.map(x=>({symbol:x.symbol,positionIdx:x.positionIdx,size:x.size,side:x.side}))};
  if(!ok)state.health.lastError="RECONCILIATION_MISMATCH";
  pushEvent(state,"RECONCILIATION",ok?String(state.config.mode)+" state reconciled":"Reconciliation mismatch — execution blocked",{ok,openMismatch,positionMismatch});
  await save(state);return snapshot();
}

async function setBotConfig(patch={}){
  const loaded=await load(),state=loaded.state;
  const next=Object.assign({},state.bot||{},patch||{});
  if(String(next.mode||"PAPER").toUpperCase()==="PAPER"){
    next.mode="PAPER";
    state.config.mode="SIMULATION";
    state.control.armed=false;
    state.control.killSwitch=false;
    state.control.reconciliation={ok:true,checkedAt:now(),detail:"Paper mode auto-simulation."};
  }
  if(next.mode==="LIVE"&&String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()!=="true"){
    throw new Error("LIVE_TRADING_ENABLED is OFF");
  }
  state.bot=ensureState(Object.assign({},state,{bot:next})).bot;
  pushEvent(state,"BOT_CONFIG_UPDATED","AutoTrader configuration updated",{
    mode:state.bot.mode,enabled:state.bot.enabled,strategies:state.bot.strategies,easyMode:state.bot.easyMode
  });
  await save(state);
  const out=botSnapshot(state);
  AUTOTRADER_STATUS_CACHE.ts=now();
  AUTOTRADER_STATUS_CACHE.payload=out;
  return out;
}

function updateBotBucket(map,key,outcome,resultR){
  const k=String(key||"UNKNOWN"),b=map[k]||{n:0,wins:0,losses:0,netR:0};
  b.n+=1;if(outcome==="WIN")b.wins+=1;if(outcome==="LOSS")b.losses+=1;b.netR+=Number(resultR)||0;map[k]=b;
}
function recordBotOutcome(meta={}){
  return load().then(async({state})=>{
    state.bot=ensureState(Object.assign({},state)).bot;
    const outcome=String(meta.outcome||"").toUpperCase(),resultR=Number(meta.resultR)||0;
    if(!["WIN","LOSS","TIMEOUT"].includes(outcome))return botSnapshot(state);
    const l=state.bot.learning;
    if(outcome!=="TIMEOUT"){l.resolved+=1;if(outcome==="WIN")l.wins+=1;if(outcome==="LOSS")l.losses+=1}
    l.netR+=resultR;
    l.lastOutcomeAt=now();l.lastOutcome={outcome,resultR,strategy:meta.strategy||null,setup:meta.setup||null,regime:meta.regime||null,symbol:meta.symbol||null,side:meta.side||null};
    updateBotBucket(l.byStrategy,meta.strategy||"UNKNOWN",outcome,resultR);
    updateBotBucket(l.bySetup,meta.setup||"UNKNOWN",outcome,resultR);
    updateBotBucket(l.byRegime,meta.regime||"UNKNOWN",outcome,resultR);
    const rate=l.resolved?l.wins/l.resolved:0;
    const model=l.model||{bias:0,updates:0,learningRate:.08};
    if(outcome==="WIN")model.bias=Math.min(2,(Number(model.bias)||0)+model.learningRate);
    if(outcome==="LOSS")model.bias=Math.max(-2,(Number(model.bias)||0)-model.learningRate);
    model.updates=Number(model.updates||0)+(outcome==="TIMEOUT"?0:1);l.model=model;
    l.recent.push({ts:now(),outcome,resultR,strategy:meta.strategy||null,setup:meta.setup||null,regime:meta.regime||null,symbol:meta.symbol||null,side:meta.side||null,score:Number(meta.score)||0});
    l.recent=l.recent.slice(-50);
    state.bot.lastAction=outcome==="WIN"?"AUTO_TRADE_WIN":outcome==="LOSS"?"AUTO_TRADE_LOSS":"AUTO_TRADE_TIMEOUT";
    state.bot.lastError=null;
    pushEvent(state,"BOT_LEARNING_UPDATE","AutoTrader learned from a resolved simulation outcome",{outcome,resultR,strategy:meta.strategy||null,setup:meta.setup||null,regime:meta.regime||null,score:Number(meta.score)||0,winRate:rate});
    await save(state);
    const out=botSnapshot(state);AUTOTRADER_STATUS_CACHE.ts=now();AUTOTRADER_STATUS_CACHE.payload=out;return out;
  });
}
function botSnapshot(rawState){
  const state=rawState&&rawState.config?ensureState(rawState):rawState;
  return {
    ok:true,
    bot:clone(state.bot),
    execution:{
      mode:state.config.mode,
      armed:state.control.armed,
      killSwitch:state.control.killSwitch,
      reconciliation:state.control.reconciliation,
      metrics:{dailyLossPct:dailyLossPct(state),openRiskPct:openRiskPct(state),activePositions:activePositions(state).length,ordersLastMinute:ordersLastMinute(state)}
    },
    learning:{
      resolved:state.bot.learning?.resolved||0,
      wins:state.bot.learning?.wins||0,
      losses:state.bot.learning?.losses||0,
      winRate:state.bot.learning?.resolved?Number(((state.bot.learning.wins/state.bot.learning.resolved)*100).toFixed(1)):null,
      netR:Number(state.bot.learning?.netR||0),
      model:state.bot.learning?.model||{},
      lastOutcome:state.bot.learning?.lastOutcome||null,
      byStrategy:state.bot.learning?.byStrategy||{},
      bySetup:state.bot.learning?.bySetup||{},
      byRegime:state.bot.learning?.byRegime||{}
    },
    health:{lastError:state.health.lastError,privateWsConnected:wsState.connected}
  };
}
async function getBotSnapshot(){
  const nowTs=now();
  if(AUTOTRADER_STATUS_CACHE.payload&&nowTs-AUTOTRADER_STATUS_CACHE.ts<AUTOTRADER_STATUS_CACHE.ttl){
    return clone(AUTOTRADER_STATUS_CACHE.payload);
  }
  const loaded=await load();
  const payload=botSnapshot(loaded.state);
  AUTOTRADER_STATUS_CACHE.ts=nowTs;
  AUTOTRADER_STATUS_CACHE.payload=payload;
  return clone(payload);
}
function recordBotTradeMeta(meta={}){
  return load().then(async({state})=>{
    state.bot=ensureState(Object.assign({},state)).bot;
    state.bot.lastTradeAt=now();
    state.bot.tradesToday=(Number(state.bot.tradesToday)||0)+1;
    state.bot.lastSignalKey=meta.signalKey||state.bot.lastSignalKey;
    state.bot.lastDecisionAt=meta.decisionAt||state.bot.lastDecisionAt;
    state.bot.lastAction=meta.action||"TRADE_SUBMITTED";
    state.bot.lastError=null;
    pushEvent(state,"BOT_TRADE_SUBMITTED","AutoTrader submitted a controlled execution intent",{signalKey:state.bot.lastSignalKey,strategy:meta.strategy||null,symbol:meta.symbol||null,interval:meta.interval||null});
    await save(state);
    const out=botSnapshot(state);
    AUTOTRADER_STATUS_CACHE.ts=now();AUTOTRADER_STATUS_CACHE.payload=out;
    return out;
  });
}
function recordBotError(message){
  return load().then(async({state})=>{
    state.bot.lastError=String(message||"Unknown AutoTrader error");
    state.bot.lastAction="ERROR";
    await save(state);
    const out=botSnapshot(state);
    AUTOTRADER_STATUS_CACHE.ts=now();AUTOTRADER_STATUS_CACHE.payload=out;
    return out;
  });
}
async function prepareFromSignal(signal){
  if(!signal)throw new Error("No Phase 4 signal available");
  if(!["LONG","SHORT"].includes(signal.side)||signal.lifecycle==="CLOSED")throw new Error("Phase 4 has no executable open signal");
  const entry=finite(signal.entry);
  const stop=finite(signal.stop);
  const target=finite(signal.target);
  if(entry===null||stop===null||target===null)throw new Error("Signal is missing executable levels");
  return createIntent({symbol:signal.symbol,interval:signal.interval,side:signal.side,entry,stop,target,tp2:signal.tp2,qty:null,riskPct:signal.riskPct,rr:signal.rr,signalId:signal.id,source:signal.source||"PHASE4_SIGNAL",note:signal.note||"Prepared from tracked signal.",easyMode:Boolean(signal.easyMode),strategy:signal.strategy||null,setup:signal.setup||signal.type||null,regime:signal.regime||null,score:Number(signal.score)||0,maxHoldMs:Number(signal.maxHoldMs)||0});
}

async function autoSubmitFinalDecision(signal){
  const loaded=await load(),state=loaded.state;
  if(state.config.mode!=="LIVE")return {ok:false,enabled:false,reason:"LIVE_MODE_REQUIRED"};
  if(String(process.env.LIVE_AUTO_EXECUTION_ENABLED||"false").toLowerCase()!=="true")return {ok:false,enabled:false,reason:"LIVE_AUTO_EXECUTION_ENABLED_OFF"};
  if(!state.control.armed)return {ok:false,enabled:true,reason:"LIVE_EXECUTION_NOT_ARMED"};
  if(state.config.requireReconciliation&&!state.control.reconciliation.ok)return {ok:false,enabled:true,reason:"LIVE_RECONCILIATION_REQUIRED"};
  const intent=await prepareFromSignal(signal);
  const order=await submitIntent(intent.id);
  return {ok:true,enabled:true,intent,order};
}

function snapshot(){
  return load().then(({state,storage:storageMode})=>{
    const active=activePositions(state),orders=state.orders.slice().reverse(),pnl=state.metrics.realizedPnl;
    return {
      version:5,storage:storageMode,mode:state.config.mode,config:state.config,control:state.control,
      orders:orders.slice(0,80),positions:active,fills:state.fills.slice(-40).reverse(),events:state.events.slice(-80).reverse(),
      journal:state.journal.slice(-40).reverse(),metrics:Object.assign({},state.metrics,{equity:state.config.account+pnl,dailyLossPct:dailyLossPct(state),openRiskPct:openRiskPct(state),activePositions:active.length,ordersLastMinute:ordersLastMinute(state)}),
      health:{
        adapter:adapterFor(state).mode==="LIVE"?"Bybit Live adapter":"Bybit Testnet adapter",
        credentialsConfigured:adapterFor(state).configured(),
        privateWsConnected:wsState.connected,
        privateWsLastMessageAt:wsState.lastMessageAt,
        privateWsLastError:wsState.lastError,
        lastError:state.health.lastError,
        reconciliation:state.control.reconciliation,
        liveModeAvailable:Boolean(liveAdapter.configured()&&String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true"),
        liveModeConfigured:Boolean(liveAdapter.configured()),
        liveTradingEnabled:String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()==="true",
        note:"LIVE remains fail-closed until production credentials, LIVE_TRADING_ENABLED=true, reconciliation and explicit live arm are all present."
      },
      updatedAt:now()
    };
  });
}

module.exports={
  version:5,
  createState:defaultState,
  ensureState,
  snapshot,
  setConfig,
  armTestnet,
  armLive,
  killSwitch,
  createIntent,
  submitIntent,
  cancelOrder,
  closeSimulationPosition,
  reconcile,
  prepareFromSignal,
  autoSubmitFinalDecision,
  manageSimulationPositions,
  getBotTradeHistory,
  recordBotOutcome,
  setBotConfig,
  getBotSnapshot,
  recordBotTradeMeta,
  recordBotError,
  marketGate
};