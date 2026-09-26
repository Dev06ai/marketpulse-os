const storage=require("./storage");

const VERSION=1;
const DEFAULT_CONFIG={
  account:100000,
  maxPortfolioRiskPct:4,
  maxSymbolExposurePct:2,
  maxCorrelatedClusterRiskPct:3,
  correlationLookback:60,
  correlationBlockThreshold:0.85,
  stressMovePct:5
};
const MAX_EVENTS=250;

function finite(x,fallback=null){return Number.isFinite(Number(x))?Number(x):fallback}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function clone(x){return JSON.parse(JSON.stringify(x))}
function now(){return Date.now()}
function eventId(){return "MP6E-"+now().toString(36)+"-"+Math.random().toString(36).slice(2,7)}

function defaultState(){
  return {
    version:VERSION,
    config:Object.assign({},DEFAULT_CONFIG),
    events:[],
    lastPortfolio:null,
    updatedAt:now()
  };
}
function ensureState(raw){
  const s=raw&&typeof raw==="object"?raw:defaultState(),d=defaultState();
  s.version=VERSION;
  s.config=Object.assign({},d.config,s.config||{});
  s.config.account=Math.max(0,finite(s.config.account,d.config.account));
  s.config.maxPortfolioRiskPct=clamp(finite(s.config.maxPortfolioRiskPct,4),0.5,20);
  s.config.maxSymbolExposurePct=clamp(finite(s.config.maxSymbolExposurePct,2),0.25,20);
  s.config.maxCorrelatedClusterRiskPct=clamp(finite(s.config.maxCorrelatedClusterRiskPct,3),0.5,20);
  s.config.correlationLookback=Math.round(clamp(finite(s.config.correlationLookback,60),20,180));
  s.config.correlationBlockThreshold=clamp(finite(s.config.correlationBlockThreshold,.85),.6,.99);
  s.config.stressMovePct=clamp(finite(s.config.stressMovePct,5),1,25);
  s.events=Array.isArray(s.events)?s.events.slice(-MAX_EVENTS):[];
  s.updatedAt=now();
  return s;
}
async function load(){
  const r=await storage.getPhase6State();
  return {state:ensureState(r.payload||defaultState()),storage:r.storage};
}
async function save(state){
  state=ensureState(state);
  return storage.savePhase6State(state);
}
function pushEvent(state,type,message,meta={}){
  state.events.push({id:eventId(),ts:now(),type,message,meta});
  state.events=state.events.slice(-MAX_EVENTS);
}
function returns(closes){
  const out=[];
  for(let i=1;i<closes.length;i++){
    const a=Number(closes[i-1]),b=Number(closes[i]);
    if(a>0&&Number.isFinite(a)&&Number.isFinite(b))out.push(b/a-1);
  }
  return out;
}
function pearson(a,b){
  const n=Math.min(a.length,b.length);
  if(n<10)return null;
  const x=a.slice(-n),y=b.slice(-n);
  const mx=x.reduce((s,v)=>s+v,0)/n,my=y.reduce((s,v)=>s+v,0)/n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){const u=x[i]-mx,v=y[i]-my;num+=u*v;dx+=u*u;dy+=v*v}
  if(dx<=0||dy<=0)return null;
  return num/Math.sqrt(dx*dy);
}
function correlationMatrix(series,lookback){
  const symbols=Object.keys(series||{});
  const prepared={};
  for(const s of symbols){
    const closes=(series[s]||[]).map(x=>Number(x.c)).filter(Number.isFinite).slice(-(lookback+1));
    prepared[s]=returns(closes);
  }
  const matrix={};
  for(const a of symbols){
    matrix[a]={};
    for(const b of symbols){
      matrix[a][b]=a===b?1:pearson(prepared[a],prepared[b]);
    }
  }
  return matrix;
}
function unionFind(symbols,matrix,threshold){
  const parent=Object.fromEntries(symbols.map(s=>[s,s]));
  const find=x=>parent[x]===x?x:(parent[x]=find(parent[x]));
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
  for(let i=0;i<symbols.length;i++)for(let j=i+1;j<symbols.length;j++){
    const c=matrix[symbols[i]]?.[symbols[j]];
    if(Number.isFinite(c)&&Math.abs(c)>=threshold)join(symbols[i],symbols[j]);
  }
  const groups={};
  symbols.forEach(s=>{const r=find(s);(groups[r]||(groups[r]=[])).push(s)});
  return Object.values(groups);
}
function positionNotional(p){return Math.abs((finite(p.entry,0)||0)*(finite(p.qty,0)||0))}
function positionRisk(p){return Math.max(0,finite(p.riskCash,0)||0)}
function orderRisk(o){return Math.max(0,finite(o.riskCash,0)||0)}
function buildPortfolio(config,positions,orders,series){
  const account=Math.max(1,finite(config.account,100000));
  const matrix=correlationMatrix(series||{},config.correlationLookback);
  const symbols=Array.from(new Set([
    ...(positions||[]).map(x=>x.symbol).filter(Boolean),
    ...(orders||[]).filter(x=>!["CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(x.status)).map(x=>x.symbol).filter(Boolean),
    ...Object.keys(series||{})
  ]));
  const exposureBySymbol={};
  const riskBySymbol={};
  for(const s of symbols){
    const ps=(positions||[]).filter(x=>x.symbol===s);
    const os=(orders||[]).filter(x=>x.symbol===s&&!["CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(x.status));
    const notional=ps.reduce((a,p)=>a+positionNotional(p),0)+os.reduce((a,o)=>a+Math.abs((finite(o.entry,0)||0)*(finite(o.qty,0)||0)),0);
    const risk=ps.reduce((a,p)=>a+positionRisk(p),0)+os.reduce((a,o)=>a+orderRisk(o),0);
    exposureBySymbol[s]=notional/account*100;
    riskBySymbol[s]=risk/account*100;
  }
  const groups=unionFind(symbols,matrix,config.correlationBlockThreshold);
  const clusters=groups.map((members,i)=>{
    const riskPct=members.reduce((a,s)=>a+(riskBySymbol[s]||0),0);
    const exposurePct=members.reduce((a,s)=>a+(exposureBySymbol[s]||0),0);
    return {id:"CL-"+(i+1),members,riskPct,exposurePct};
  }).sort((a,b)=>b.riskPct-a.riskPct);
  const grossRiskPct=Object.values(riskBySymbol).reduce((a,b)=>a+b,0);
  const grossExposurePct=Object.values(exposureBySymbol).reduce((a,b)=>a+b,0);
  const concentration=Object.entries(exposureBySymbol).map(([symbol,pct])=>({symbol,pct})).sort((a,b)=>b.pct-a.pct);
  const warnings=[];
  if(grossRiskPct>config.maxPortfolioRiskPct)warnings.push("PORTFOLIO RISK LIMIT");
  concentration.filter(x=>x.pct>config.maxSymbolExposurePct).forEach(x=>warnings.push(x.symbol+" SYMBOL EXPOSURE"));
  clusters.filter(x=>x.riskPct>config.maxCorrelatedClusterRiskPct).forEach(x=>warnings.push(x.id+" CORRELATED RISK"));
  return {
    account,
    grossRiskPct,
    grossExposurePct,
    exposureBySymbol,
    riskBySymbol,
    concentration,
    clusters,
    correlation:matrix,
    warnings,
    guardState:warnings.length?"REVIEW":"WITHIN LIMITS",
    stress:stressTest(config,positions||[],orders||[]),
    updatedAt:now()
  };
}
function correlationGate(config,riskBySymbol,symbol,lastPortfolio){
  const threshold=finite(config.correlationBlockThreshold,.85);
  const limit=finite(config.maxCorrelatedClusterRiskPct,3);
  const symbols=Object.keys(riskBySymbol||{});
  const matrix=lastPortfolio?.correlation||null;
  if(!matrix||!Object.keys(matrix).length)return {available:false,clusterRiskPct:riskBySymbol[symbol]||0,clusterMembers:[symbol],limitPct:limit};
  const groups=unionFind(symbols,matrix,threshold);
  const members=groups.find(g=>g.includes(symbol))||[symbol];
  const clusterRiskPct=members.reduce((sum,s)=>sum+(riskBySymbol[s]||0),0);
  return {available:true,clusterRiskPct,clusterMembers:members,limitPct:limit,allowed:clusterRiskPct<=limit+1e-9};
}
function stressTest(config,positions,orders){
  const m=Number(config.stressMovePct)||5, rows=[];
  const add=(label,move)=>{
    let pnl=0;
    for(const p of positions){
      const entry=finite(p.entry,0)||0,qty=finite(p.qty,0)||0;
      const exit=entry*(1+move/100);
      pnl+=p.side==="LONG"?(exit-entry)*qty:(entry-exit)*qty;
    }
    for(const o of orders){
      const entry=finite(o.entry,0)||0,qty=finite(o.qty,0)||0;
      const exit=entry*(1+move/100);
      pnl+=o.side==="LONG"?(exit-entry)*qty:(entry-exit)*qty;
    }
    rows.push({label,movePct:move,pnl});
  };
  add("DOWN",-m);add("UP",m);
  return {movePct:m,rows};
}
async function setConfig(patch){
  const loaded=await load(),s=loaded.state;
  s.config=Object.assign({},s.config,patch||{});
  pushEvent(s,"CONFIG_UPDATED","Portfolio limits updated",{config:s.config});
  await save(s);return snapshot();
}
async function savePortfolio(portfolio){
  const loaded=await load(),s=loaded.state;
  s.lastPortfolio=clone(portfolio);s.updatedAt=now();await save(s);return snapshot();
}
async function snapshot(){
  const loaded=await load(),s=loaded.state;
  return {version:VERSION,storage:loaded.storage,config:s.config,portfolio:s.lastPortfolio||null,events:s.events.slice().reverse().slice(0,50),updatedAt:s.updatedAt};
}
async function executionGate(plan,executionState){
  const loaded=await load(),s=loaded.state,cfg=Object.assign({},s.config,{account:finite(executionState?.config?.account,s.config.account)});
  const existingPositions=executionState?.positions||[],existingOrders=executionState?.orders||[];
  const testPositions=existingPositions.concat([{
    symbol:String(plan.symbol||"").toUpperCase(),
    side:plan.side,entry:finite(plan.entry,0)||0,qty:finite(plan.qty,0)||0,
    riskCash:finite(plan.riskCash,0)||0
  }]);
  const testOrders=existingOrders.filter(x=>!["CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(x.status)&&String(x.id||"")!==String(plan.intentId||""));
  const pseudoSeries={};
  const p=buildPortfolio(cfg,testPositions,testOrders,pseudoSeries);
  if(p.grossRiskPct>cfg.maxPortfolioRiskPct)return {allowed:false,reason:"PORTFOLIO RISK LIMIT",portfolioRiskPct:p.grossRiskPct,limitPct:cfg.maxPortfolioRiskPct};
  const sym=String(plan.symbol||"").toUpperCase(),symExp=p.exposureBySymbol[sym]||0;
  if(symExp>cfg.maxSymbolExposurePct)return {allowed:false,reason:"SYMBOL EXPOSURE LIMIT",symbol:sym,exposurePct:symExp,limitPct:cfg.maxSymbolExposurePct};
  const savedAge=Number(s.lastPortfolio?.updatedAt||0)?now()-Number(s.lastPortfolio.updatedAt):Infinity;
  const corr=savedAge<=15*60*1000?correlationGate(cfg,p.riskBySymbol,sym,s.lastPortfolio):{available:false,clusterRiskPct:p.riskBySymbol[sym]||0,clusterMembers:[sym],limitPct:cfg.maxCorrelatedClusterRiskPct};
  if(corr.available&&corr.clusterRiskPct>corr.limitPct)return {allowed:false,reason:"CORRELATED CLUSTER RISK LIMIT",symbol:sym,clusterRiskPct:corr.clusterRiskPct,limitPct:corr.limitPct,clusterMembers:corr.clusterMembers,correlationSnapshotAgeMs:savedAge};
  return {allowed:true,reason:"PASS",portfolioRiskPct:p.grossRiskPct,symbolExposurePct:symExp,clusterRiskPct:corr.clusterRiskPct,clusterMembers:corr.clusterMembers,correlationAvailable:corr.available,correlationSnapshotAgeMs:Number.isFinite(savedAge)?savedAge:null};
}
module.exports={version:VERSION,createState:defaultState,ensureState,load,save,snapshot,setConfig,buildPortfolio,stressTest,savePortfolio,executionGate,correlationGate};