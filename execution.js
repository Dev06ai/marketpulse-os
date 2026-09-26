const crypto=require("crypto");
let WebSocket=null;try{WebSocket=require("ws")}catch{}
const storage=require("./storage");
const phase6=require("./phase6");

const VERSION=1;
const MODE_VALUES=["SIMULATION","TESTNET"];
const MAX_ORDERS=300;
const MAX_POSITIONS=50;
const MAX_EVENTS=500;
const MAX_JOURNAL=500;

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
    health:{lastError:null,lastActionAt:null}
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

function credentials(){
  return {
    apiKey:String(process.env.BYBIT_API_KEY||""),
    apiSecret:String(process.env.BYBIT_API_SECRET||""),
    configured:Boolean(process.env.BYBIT_API_KEY&&process.env.BYBIT_API_SECRET),
    host:String(process.env.BYBIT_API_HOST||"https://api-testnet.bybit.com"),
    ws:String(process.env.BYBIT_API_WS||"wss://stream-testnet.bybit.com/v5/private")
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
  constructor(){this.c=credentials();this.recvWindow="5000"}
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
    const r=await this.privateRequest("GET","/v5/order/realtime",{category:"linear",symbol,openOnly:0,limit:50});
    return Array.isArray(r.list)?r.list:[];
  }
  async positions(symbol){
    const r=await this.privateRequest("GET","/v5/position/list",{category:"linear",symbol});
    return Array.isArray(r.list)?r.list:[];
  }
}

const adapter=new BybitTestnetAdapter();

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
  const riskCash=Math.max(0,finite(state.config.account,0)||0)*state.config.riskPct/100;
  const qtyRaw=finite(p.qty)||(riskDistance>0?riskCash/riskDistance:NaN);
  let qty=qtyRaw,price=entry;
  const symbol=String(p.symbol||"").toUpperCase();
  if(!symbol)return {allowed:false,reason:"SYMBOL REQUIRED"};
  if(entry===null||stop===null||target===null||riskDistance<=0)return {allowed:false,reason:"INVALID LEVELS"};
  if(rr<1.5)return {allowed:false,reason:"R:R BELOW 1.50"};
  if(!Number.isFinite(qty)||qty<=0)return {allowed:false,reason:"INVALID POSITION SIZE"};
  if(state.config.mode==="TESTNET"&&!adapter.configured())return {allowed:false,reason:"TESTNET API CREDENTIALS NOT CONFIGURED"};
  if(state.control.killSwitch)return {allowed:false,reason:"KILL SWITCH ACTIVE"};
  if(state.config.mode==="TESTNET"&&!state.control.armed)return {allowed:false,reason:"TESTNET EXECUTION NOT ARMED"};
  if(state.config.requireReconciliation&&!state.control.reconciliation.ok)return {allowed:false,reason:"RECONCILIATION BLOCK"};
  if(activePositions(state).length>=state.config.maxPositions)return {allowed:false,reason:"MAX POSITIONS"};
  if(openRiskPct(state)+state.config.riskPct>state.config.maxOpenRiskPct+1e-9)return {allowed:false,reason:"MAX OPEN RISK"};
  if(symbolExposurePct(state,symbol)+(Math.abs(entry*qty)/Math.max(1,state.config.account)*100)>state.config.maxSymbolExposurePct+1e-9)return {allowed:false,reason:"MAX SYMBOL EXPOSURE"};
  if(dailyLossPct(state)>=state.config.maxDailyLossPct-1e-9)return {allowed:false,reason:"MAX DAILY LOSS"};
  if(ordersLastMinute(state)>=state.config.maxOrdersPerMinute)return {allowed:false,reason:"ORDER RATE LIMIT"};
  if(p.type==="MARKET"&&!state.config.allowMarketOrders)return {allowed:false,reason:"MARKET ORDERS DISABLED"};
  if(p.createdAt&&now()-Number(p.createdAt)>state.config.maxIntentAgeMs)return {allowed:false,reason:"INTENT EXPIRED"};

  if(state.config.mode==="TESTNET"){
    try{
      const [inst,t]=await Promise.all([adapter.instrument(symbol),adapter.ticker(symbol)]);
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
      return {allowed:true,reason:"PASS",entry:price,stop:Number(formatPrice(stop,tick)),target:Number(formatPrice(target,tick)),qty,riskCash,rr,markPrice:mark,driftBps:mark?Math.abs(price-mark)/mark*10000:null,instrument:inst,portfolio:portfolioGate};
    }catch(e){return {allowed:false,reason:"MARKET VALIDATION FAILED: "+e.message}}
  }
  const portfolioGate=await phase6.executionGate({symbol,side:p.side,entry,stop,target,qty,riskCash,intentId:p.id},state);
  if(!portfolioGate.allowed)return Object.assign({allowed:false},portfolioGate);
  return {allowed:true,reason:"PASS",entry,stop,target,qty,riskCash,rr,markPrice:null,driftBps:null,portfolio:portfolioGate};
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
  p.side=side;p.qty=qty;p.entry=finite(row.avgPrice??row.entryPrice,p.entry);p.markPrice=finite(row.markPrice,p.markPrice);p.leverage=finite(row.leverage,p.leverage);p.unrealisedPnl=finite(row.unrealisedPnl,p.unrealisedPnl);p.updatedAt=now();
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
      appendFill(state,{id:x.execId,orderId:x.orderId,orderLinkId:x.orderLinkId,symbol:x.symbol,side:x.side,qty:finite(x.execQty,0),price:finite(x.execPrice,0),fee:finite(x.execFee,0),execPnl:finite(x.execPnl,0),ts:finite(x.execTime,now())});
      const o=findOrder(state,x.orderId||x.orderLinkId);if(o){o.avgPrice=finite(x.execPrice,o.avgPrice);o.cumExecQty=(finite(o.cumExecQty,0)||0)+(finite(x.execQty,0)||0);o.updatedAt=now();}
    }
  }else if(msg.topic==="position"||msg.topic.startsWith("position.")){
    msg.data.forEach(x=>upsertPosition(state,x));
  }
  await save(state);
}

function connectPrivateWs(){
  if(wsState.started)return;
  if(!WebSocket){wsState.lastError="ws dependency unavailable";wsState.started=false;return}
  wsState.started=true;
  const loop=()=>{
    if(!adapter.configured()){wsState.connected=false;wsState.lastError="BYBIT credentials not configured";wsState.started=false;return}
    const ws=new WebSocket(credentials().ws);
    wsState.ws=ws;
    let pingTimer=null;
    ws.on("open",()=>{
      wsState.connected=false;
      const expires=now()+10000;
      const signature=crypto.createHmac("sha256",credentials().apiSecret).update("GET/realtime"+expires).digest("hex");
      ws.send(JSON.stringify({op:"auth",args:[credentials().apiKey,expires,signature]}));
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
if(adapter.configured())setTimeout(connectPrivateWs,1000);

async function createIntent(plan){
  const loaded=await load(),state=loaded.state,p=plan||{};
  const symbol=String(p.symbol||"").toUpperCase(),side=String(p.side||"").toUpperCase();
  if(!["LONG","SHORT"].includes(side))throw new Error("Side must be LONG or SHORT");
  const entry=finite(p.entry),stop=finite(p.stop),target=finite(p.target);
  if(!symbol||entry===null||stop===null||target===null)throw new Error("Symbol, entry, stop and target are required");
  const riskDistance=Math.abs(entry-stop),reward=Math.abs(target-entry);
  if(riskDistance<=0)throw new Error("Stop must be different from entry");
  if(reward/riskDistance<1.5)throw new Error("Intent blocked: minimum R:R is 1.50");
  const duplicate=state.orders.find(o=>o.intentKey===[symbol,side,entry,stop,target,p.signalId||""].join("|")&&["INTENT","VALIDATING","APPROVED","SUBMITTED","ACKNOWLEDGED","OPEN","PARTIALLY_FILLED"].includes(o.status));
  if(duplicate)return clone(duplicate);
  const id=intentId();
  const order={id,orderLinkId:linkId(id),intentKey:[symbol,side,entry,stop,target,p.signalId||""].join("|"),signalId:p.signalId||null,symbol,interval:p.interval||"1h",side,type:"LIMIT",status:"INTENT",entry,stop,target,qty:finite(p.qty),rr:reward/riskDistance,riskPct:state.config.riskPct,riskCash:state.config.account*state.config.riskPct/100,createdAt:now(),updatedAt:now(),externalOrderId:null,avgPrice:null,cumExecQty:0,leavesQty:null,source:p.source||"PHASE4",note:p.note||""};
  state.orders.push(order);state.orders=state.orders.slice(-MAX_ORDERS);pushEvent(state,"INTENT_CREATED",symbol+" "+side+" execution intent created",{orderId:order.id,signalId:order.signalId});
  await save(state);return clone(order);
}

async function submitIntent(id){
  const loaded=await load(),state=loaded.state,o=findOrder(state,id);
  if(!o)throw new Error("Execution intent not found");
  if(["SUBMITTED","ACKNOWLEDGED","OPEN","PARTIALLY_FILLED","FILLED"].includes(o.status))return clone(o);
  const plan={symbol:o.symbol,side:o.side,entry:o.entry,stop:o.stop,target:o.target,qty:o.qty,type:o.type,createdAt:o.createdAt};
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
    const position={id:"MP5P-"+o.id,externalKey:"SIM:"+o.id,symbol:o.symbol,interval:o.interval,side:o.side,qty:o.qty,entry:o.entry,stop:o.stop,target:o.target,riskCash:o.riskCash,openedAt:now(),markPrice:o.entry,source:"SIMULATION"};
    state.positions.push(position);state.positions=state.positions.slice(-MAX_POSITIONS);
    state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode"};
    addJournal(state,{id:"MP5J-"+o.id,ts:now(),type:"SIMULATION_FILLED",orderId:o.id,symbol:o.symbol,side:o.side,qty:o.qty,price:o.entry,resultR:0,pnl:0,message:"Simulation fill created; position remains open until explicitly closed."});
    pushEvent(state,"SIMULATION_FILLED",o.symbol+" "+o.side+" · "+o.qty+" @ "+o.entry,{orderId:o.id});
  }else{
    const placed=await adapter.placeLimit({symbol:o.symbol,side:o.side==="LONG"?"Buy":"Sell",qty:o.qty,price:o.entry,stop:o.stop,target:o.target,orderLinkId:o.orderLinkId});
    o.externalOrderId=placed.orderId;o.orderLinkId=placed.orderLinkId;o.status="ACKNOWLEDGED";o.exchangeStatus="Created";o.updatedAt=now();
    state.control.reconciliation={ok:false,checkedAt:now(),detail:"Awaiting exchange websocket/reconciliation after order acknowledgement."};
    pushEvent(state,"ORDER_ACKNOWLEDGED",o.symbol+" "+o.side+" accepted by Bybit testnet · waiting for private stream confirmation",{orderId:o.id,externalOrderId:o.externalOrderId});
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
  await adapter.cancel({symbol:o.symbol,orderId:o.externalOrderId});
  o.status="CANCEL_REQUESTED";o.updatedAt=now();state.control.reconciliation={ok:false,checkedAt:now(),detail:"Cancel requested; waiting for websocket confirmation."};
  pushEvent(state,"CANCEL_REQUESTED",o.symbol+" "+o.side+" cancel sent",{orderId:o.id,externalOrderId:o.externalOrderId});
  await save(state);return clone(o);
}

async function closeSimulationPosition(positionId,exitPrice){
  const loaded=await load(),state=loaded.state,p=state.positions.find(x=>x.id===positionId);
  if(!p)throw new Error("Position not found");
  if(state.config.mode!=="SIMULATION")throw new Error("Manual close is only available for simulation positions");
  const exit=finite(exitPrice);if(exit===null)throw new Error("Exit price required");
  const pnl=p.side==="LONG"?(exit-p.entry)*p.qty:(p.entry-exit)*p.qty;
  const r=p.riskCash?((pnl)/p.riskCash):0;
  state.metrics.realizedPnl+=pnl;state.metrics.realizedR+=r;state.positions=state.positions.filter(x=>x.id!==positionId);
  const o=p.orderId?findOrder(state,p.orderId):state.orders.find(x=>x.externalOrderId==="SIM-"+String(p.id).replace("MP5P-",""));
  if(o){o.status="CLOSED";o.closedAt=now();o.updatedAt=now()}
  addJournal(state,{id:"MP5J-C-"+positionId,ts:now(),type:"SIMULATION_CLOSED",positionId,symbol:p.symbol,side:p.side,qty:p.qty,entry:p.entry,exit,resultR:r,pnl,message:"Simulation position closed manually."});
  pushEvent(state,"POSITION_CLOSED",p.symbol+" "+p.side+" closed · "+r.toFixed(2)+"R",{positionId,pnl,r});
  await save(state);return snapshot();
}

async function killSwitch(enable=true){
  const loaded=await load(),state=loaded.state;
  state.control.killSwitch=Boolean(enable);
  if(enable)state.control.armed=false;
  if(enable&&state.config.mode==="TESTNET"){
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
  if(!adapter.configured())throw new Error("BYBIT_API_KEY/BYBIT_API_SECRET are not configured on the server");
  state.control.armed=true;state.control.killSwitch=false;
  state.control.reconciliation={ok:false,checkedAt:null,detail:"Reconciliation required before the first order."};
  pushEvent(state,"TESTNET_ARMED","Bybit testnet execution armed; reconciliation is still required.",{});
  await save(state);return snapshot();
}

async function setConfig(patch){
  const loaded=await load(),state=loaded.state,next=Object.assign({},state.config,patch||{});
  next.mode=MODE_VALUES.includes(next.mode)?next.mode:state.config.mode;
  if(next.mode!=="TESTNET"){state.control.armed=false;state.control.killSwitch=false;state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode."}}
  state.config=Object.assign({},state.config,next);
  if(state.config.account>0&&state.metrics.startingEquity<=0)state.metrics.startingEquity=state.config.account;
  pushEvent(state,"CONFIG_UPDATED","Execution risk controls updated",{mode:state.config.mode});
  await save(state);return snapshot();
}

async function reconcile(){
  const loaded=await load(),state=loaded.state;
  if(state.config.mode==="SIMULATION"){
    state.control.reconciliation={ok:true,checkedAt:now(),detail:"Simulation mode has no exchange state to reconcile."};
    await save(state);return snapshot();
  }
  if(!adapter.configured())throw new Error("Bybit testnet credentials not configured");
  const symbols=Array.from(new Set(activeOrders(state).concat(activePositions(state)).map(x=>x.symbol).filter(Boolean)));
  const externalOrders=[];
  for(const sym of symbols)externalOrders.push(...await adapter.openOrders(sym));
  const localOpen=activeOrders(state).filter(x=>x.externalOrderId);
  const openMismatch=localOpen.some(x=>!externalOrders.some(e=>e.orderId===x.externalOrderId)) || externalOrders.some(e=>!localOpen.some(x=>x.externalOrderId===e.orderId));
  const externalPositions=[];
  for(const sym of symbols)externalPositions.push(...await adapter.positions(sym));
  const extPosMap=new Map(externalPositions.map(p=>[String(p.symbol)+":"+String(p.positionIdx??0),Math.abs(finite(p.size,0)||0)]));
  const localPosMap=new Map(activePositions(state).map(p=>[p.symbol+":0",Math.abs(finite(p.qty,0)||0)]));
  let positionMismatch=false;
  for(const [k,v] of extPosMap)if((v>0)!==(localPosMap.get(k)>0))positionMismatch=true;
  for(const [k,v] of localPosMap)if((v>0)!==(extPosMap.get(k)>0))positionMismatch=true;
  const ok=!openMismatch&&!positionMismatch;
  state.control.reconciliation={ok,checkedAt:now(),detail:ok?"Local execution state matches testnet open orders/positions.":"Mismatch detected; new execution is blocked until state is reconciled.",openMismatch,positionMismatch,externalOrders:externalOrders.map(x=>({orderId:x.orderId,symbol:x.symbol,status:x.orderStatus})),externalPositions:externalPositions.map(x=>({symbol:x.symbol,positionIdx:x.positionIdx,size:x.size,side:x.side}))};
  if(!ok)state.health.lastError="RECONCILIATION_MISMATCH";
  pushEvent(state,"RECONCILIATION",ok?"Testnet state reconciled":"Reconciliation mismatch — execution blocked",{ok,openMismatch,positionMismatch});
  await save(state);return snapshot();
}

async function prepareFromSignal(signal){
  if(!signal)throw new Error("No Phase 4 signal available");
  if(!["LONG","SHORT"].includes(signal.side)||signal.lifecycle==="CLOSED")throw new Error("Phase 4 has no executable open signal");
  const entry=finite(signal.entry);
  const stop=finite(signal.stop);
  const target=finite(signal.target);
  if(entry===null||stop===null||target===null)throw new Error("Signal is missing executable levels");
  return createIntent({symbol:signal.symbol,interval:signal.interval,side:signal.side,entry,stop,target,qty:null,rr:signal.rr,signalId:signal.id,source:"PHASE4_SIGNAL",note:"Prepared from Phase 4 tracked signal."});
}

function snapshot(){
  return load().then(({state,storage:storageMode})=>{
    const active=activePositions(state),orders=state.orders.slice().reverse(),pnl=state.metrics.realizedPnl;
    return {
      version:5,storage:storageMode,mode:state.config.mode,config:state.config,control:state.control,
      orders:orders.slice(0,80),positions:active,fills:state.fills.slice(-40).reverse(),events:state.events.slice(-80).reverse(),
      journal:state.journal.slice(-40).reverse(),metrics:Object.assign({},state.metrics,{equity:state.config.account+pnl,dailyLossPct:dailyLossPct(state),openRiskPct:openRiskPct(state),activePositions:active.length,ordersLastMinute:ordersLastMinute(state)}),
      health:{
        adapter:"Bybit Testnet adapter",
        credentialsConfigured:adapter.configured(),
        privateWsConnected:wsState.connected,
        privateWsLastMessageAt:wsState.lastMessageAt,
        privateWsLastError:wsState.lastError,
        lastError:state.health.lastError,
        reconciliation:state.control.reconciliation,
        liveModeAvailable:false,
        note:"Phase 5 intentionally exposes SIMULATION and TESTNET only. Production/live order routing is not enabled in this phase."
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
  killSwitch,
  createIntent,
  submitIntent,
  cancelOrder,
  closeSimulationPosition,
  reconcile,
  prepareFromSignal,
  marketGate
};