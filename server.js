const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{analyze,backtest,backtestBySetup,walkForwardBacktest}=require('./market-engine');
const storage=require('./storage');
const learning=require('./learning');
const phase4=require('./phase4');
const execution=require('./execution');
const phase6=require('./phase6');
const phase7=require('./phase7');
const phase910=require('./phase9-10');
const phase1113=require('./phase11-13');
const phase14=require('./phase14-signal-intelligence');
const phase15=require('./phase15');
const phase16=require('./phase16');
const autotrader=require('./autotrader');
const phase18MarketState=require('./phase18-market-state');
const phase18Opportunity=require('./phase18-opportunity');
const phase18ExecutionRouter=require('./phase18-execution-router');
const {validateTradeLevels}=require("./trade-levels");
const {buildDecisionIntelligence}=require("./decision-intelligence");
const phase20=require("./phase20-scenario-matrix");
const phase21=require("./phase21-state-contract");
const phaseHistory=require("./phase-history");
const phaseAudit=require("./phase-audit");
setTimeout(async()=>{
  try{
    const report=await phaseAudit.run();
    console.log("[phase-audit]",JSON.stringify({
      ok:report.ok,
      registry:report.registry,
      coreChecks:report.coreChecks,
      moduleCount:report.moduleCount,
      moduleFailures:report.moduleFailures?.slice(0,20)||[],
      weakSelfTests:report.weakSelfTests?.slice(0,20)||[],
      modulesWithoutSelfTest:report.modulesWithoutSelfTest?.slice(0,20)||[],
      consolidated:report.consolidated
    }));
  }catch(e){
    console.error("[phase-audit] runtime error",String(e?.message||e));
  }
},1500);
const phaseStack=require("./phase21-50-stack");
const phase51to100=require("./phase51-100-stack");
const phase101to200=require("./phase101-200-stack");
const phase201to300=require("./phase201-300-profit-engine");
const phase301to400=require("./phase301-400-adaptive-intelligence");
const phase401to500=require("./phase401-500-apex-engine");
const signalNotifications=require('./signal-notifications');
const propFirm=require('./prop-firm');
const research=require('./research-data');
const dataFabric=require('./data-fabric');
const auth=require('./auth');
const WebSocket=require('ws');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const COINGECKO_IDS={BTCUSDT:'bitcoin',ETHUSDT:'ethereum',SOLUSDT:'solana',BNBUSDT:'binancecoin',XRPUSDT:'ripple',DOGEUSDT:'dogecoin',ADAUSDT:'cardano'};
const COINCAP_IDS={BTCUSDT:'bitcoin',ETHUSDT:'ethereum',SOLUSDT:'solana',BNBUSDT:'binance-coin',XRPUSDT:'xrp',DOGEUSDT:'dogecoin',ADAUSDT:'cardano'};
const MARKET_META_CACHE={ts:0,data:{}};
const MARKET_META_TTL=60000;
const TICKER_CACHE={ts:0,data:{}};
const TICKER_TTL=10000;
const RELIABLE_TICKER_CACHE={ts:0,data:{}};
const RELIABLE_TICKER_TTL=5000;
const CORE_SNAPSHOT_CACHE=new Map();
const CORE_SNAPSHOT_TTL=20000;
const CORE_SNAPSHOT_JOBS=new Map();

async function getReliableTickerSnapshot(symbols=SYMBOLS){
  const list=(symbols||SYMBOLS).filter(Boolean);
  if(RELIABLE_TICKER_CACHE.ts&&Date.now()-RELIABLE_TICKER_CACHE.ts<RELIABLE_TICKER_TTL){
    return Object.fromEntries(list.map(s=>[s,RELIABLE_TICKER_CACHE.data[s]||null]));
  }

  const rows=await Promise.all(list.map(async symbol=>{
    const now=Date.now();
    try{
      const live=flowBucket(symbol);
      if(Number.isFinite(Number(live.markPrice))&&now-Number(live.lastTs||0)<10000){
        return [symbol,{
          price:Number(live.markPrice),
          change24h:null,
          volume24h:null,
          source:"Bybit live flow",
          updatedAt:now
        }];
      }

      const snapshot=await Promise.race([
        dataFabric.krakenSnapshot(symbol),
        dataFabric.coinbaseSnapshot(symbol)
      ]);

      const price=Number(snapshot?.price);
      return [symbol,{
        price:Number.isFinite(price)?price:null,
        change24h:null,
        volume24h:null,
        source:snapshot?.name||"market feed",
        updatedAt:now
      }];
    }catch{
      return [symbol,null];
    }
  }));

  const data=Object.fromEntries(rows);
  RELIABLE_TICKER_CACHE.ts=Date.now();
  RELIABLE_TICKER_CACHE.data=data;
  return Object.fromEntries(list.map(s=>[s,data[s]||null]));
}

async function getBinanceTickerSnapshot(symbols=SYMBOLS){
  const list=(symbols||SYMBOLS).filter(Boolean);
  if(TICKER_CACHE.ts&&Date.now()-TICKER_CACHE.ts<TICKER_TTL){
    return Object.fromEntries(list.map(s=>[s,TICKER_CACHE.data[s]||null]));
  }
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com'];
  const load=async base=>{
    const u=new URL(base+'/api/v3/ticker/24hr');
    u.searchParams.set('symbols',JSON.stringify(list));
    const r=await fetch(u,{signal:timeoutSignal(4500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Binance ticker HTTP '+r.status);
    const rows=await r.json();
    const data={};
    (Array.isArray(rows)?rows:[]).forEach(x=>{
      const symbol=String(x.symbol||'').toUpperCase();
      if(!symbol)return;
      data[symbol]={
        price:Number.isFinite(Number(x.lastPrice))?Number(x.lastPrice):null,
        change24h:Number.isFinite(Number(x.priceChangePercent))?Number(x.priceChangePercent):null,
        volume24h:Number.isFinite(Number(x.quoteVolume))?Number(x.quoteVolume):null,
        source:'binance'
      };
    });
    return data;
  };
  try{
    const data=await Promise.any(bases.map(load));
    TICKER_CACHE.ts=Date.now();TICKER_CACHE.data=data;
    return Object.fromEntries(list.map(s=>[s,data[s]||null]));
  }catch{
    return Object.fromEntries(list.map(s=>[s,TICKER_CACHE.data[s]||null]));
  }
}

async function getCoinCapMetadata(symbols){
  const list=(symbols||SYMBOLS).filter(Boolean);
  const ids=list.map(s=>COINGECKO_IDS[s]).filter(Boolean);
  if(!ids.length)return {};
  try{
    const u=new URL('https://api.coincap.io/v2/assets');
    u.searchParams.set('ids',ids.join(','));
    const r=await fetch(u,{signal:timeoutSignal(5000),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('CoinCap HTTP '+r.status);
    const body=await r.json();
    const data={};
    (Array.isArray(body?.data)?body.data:[]).forEach(x=>{
      const symbol=Object.keys(COINCAP_IDS).find(k=>COINCAP_IDS[k]===x.id);
      if(!symbol)return;
      data[symbol]={
        rank:Number.isFinite(Number(x.rank))?Number(x.rank):null,
        marketCap:Number.isFinite(Number(x.marketCapUsd))?Number(x.marketCapUsd):null,
        volume24h:Number.isFinite(Number(x.volumeUsd24Hr))?Number(x.volumeUsd24Hr):null,
        geckoPrice:Number.isFinite(Number(x.priceUsd))?Number(x.priceUsd):null,
        change24h:Number.isFinite(Number(x.changePercent24Hr))?Number(x.changePercent24Hr):null,
        source:'coincap',
        updatedAt:Date.now()
      };
    });
    return data;
  }catch{
    return {};
  }
}
async function getCryptoCompareMetadata(symbols){
  const list=(symbols||SYMBOLS).filter(Boolean);
  const fs=list.map(s=>String(labels[s]||s).replace('USDT','')).join(',');
  if(!fs)return {};
  try{
    const u=new URL('https://min-api.cryptocompare.com/data/pricemultifull');
    u.searchParams.set('fsyms',fs);
    u.searchParams.set('tsyms','USD');
    const r=await fetch(u,{signal:timeoutSignal(4500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('CryptoCompare HTTP '+r.status);
    const body=await r.json();
    const raw=body?.RAW||{};
    const data={};
    list.forEach(function(symbol){
      const coin=String(labels[symbol]||symbol).replace('USDT','').toUpperCase();
      const usd=raw?.[coin]?.USD||{};
      data[symbol]={
        rank:null,
        marketCap:Number.isFinite(Number(usd.MKTCAP))?Number(usd.MKTCAP):null,
        volume24h:Number.isFinite(Number(usd.TOTALVOLUME24H))?Number(usd.TOTALVOLUME24H):null,
        geckoPrice:Number.isFinite(Number(usd.PRICE))?Number(usd.PRICE):null,
        change24h:Number.isFinite(Number(usd.CHANGE24HOURPCT))?Number(usd.CHANGE24HOURPCT):null,
        source:'cryptocompare',
        updatedAt:Date.now()
      };
    });
    return data;
  }catch{return {}}
}
async function getMarketMetadata(symbols=SYMBOLS){
  const list=(symbols||SYMBOLS).filter(Boolean);
  if(MARKET_META_CACHE.ts&&Date.now()-MARKET_META_CACHE.ts<MARKET_META_TTL){
    return Object.fromEntries(list.map(s=>[s,MARKET_META_CACHE.data[s]||null]));
  }
  const [ticker,coincap,cc]=await Promise.all([
    getBinanceTickerSnapshot(list),
    getCoinCapMetadata(list),
    getCryptoCompareMetadata(list)
  ]);
  let primary={};
  try{
    const ids=list.map(s=>COINGECKO_IDS[s]).filter(Boolean);
    if(ids.length){
      const u=new URL('https://api.coingecko.com/api/v3/coins/markets');
      u.searchParams.set('vs_currency','usd');
      u.searchParams.set('ids',ids.join(','));
      u.searchParams.set('order','market_cap_desc');
      u.searchParams.set('per_page',String(Math.min(250,ids.length)));
      u.searchParams.set('page','1');
      u.searchParams.set('sparkline','false');
      u.searchParams.set('price_change_percentage','24h');
      const r=await fetch(u,{signal:timeoutSignal(5000),headers:{accept:'application/json'}});
      if(r.ok){
        const rows=await r.json();
        (Array.isArray(rows)?rows:[]).forEach(x=>{
          const symbol=Object.keys(COINGECKO_IDS).find(k=>COINGECKO_IDS[k]===x.id);
          if(!symbol)return;
          primary[symbol]={
            rank:Number.isFinite(Number(x.market_cap_rank))?Number(x.market_cap_rank):null,
            marketCap:Number.isFinite(Number(x.market_cap))?Number(x.market_cap):null,
            volume24h:Number.isFinite(Number(x.total_volume))?Number(x.total_volume):null,
            geckoPrice:Number.isFinite(Number(x.current_price))?Number(x.current_price):null,
            change24h:Number.isFinite(Number(x.price_change_percentage_24h))?Number(x.price_change_percentage_24h):null,
            source:'coingecko',
            updatedAt:Date.now()
          };
        });
      }
    }
  }catch{}
  const data={};
  list.forEach(symbol=>{
    const p=primary[symbol]||{}, cg=coincap[symbol]||{}, ccx=cc[symbol]||{}, t=ticker[symbol]||{};
    data[symbol]={
      rank:p.rank??cg.rank??ccx.rank??null,
      marketCap:p.marketCap??cg.marketCap??ccx.marketCap??null,
      // Binance is the freshest volume source; fall back to metadata providers.
      volume24h:t.volume24h??p.volume24h??cg.volume24h??ccx.volume24h??null,
      geckoPrice:t.price??p.geckoPrice??cg.geckoPrice??ccx.geckoPrice??null,
      // The fast Binance ticker should win for 24h movement.
      change24h:t.change24h??p.change24h??cg.change24h??ccx.change24h??null,
      source:p.marketCap!=null?'coingecko':(cg.marketCap!=null?'coincap':(ccx.marketCap!=null?'cryptocompare':'binance')),
      updatedAt:Date.now()
    };
  });
  MARKET_META_CACHE.ts=Date.now();MARKET_META_CACHE.data=data;
  return Object.fromEntries(list.map(s=>[s,data[s]||null]));
}
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=45000;
const SCAN_CACHE=new Map(); const SCAN_TTL=20000;
const SNAPSHOT_CACHE=new Map(); const SNAPSHOT_TTL=5000;
const SCAN_JOBS=new Map();
const CORE_ANALYTICS_CACHE=new Map();
const CORE_ANALYTICS_JOBS=new Set();
const CORE_ANALYTICS_TTL=120000;
const PHASE2_VERSION=2; const PHASE3_VERSION=3; const PHASE4_VERSION=4; const PHASE5_VERSION=5; const PHASE6_VERSION=6; const PHASE7_VERSION=7; const PHASE7_DATA_VERSION=2;
const PHASE9_VERSION=9; const PHASE10_VERSION=10; const PHASE11_VERSION=11; const PHASE12_VERSION=12; const PHASE13_VERSION=13;
const DECISION_CACHE=new Map(); const DECISION_TTL=5000; const DECISION_LAST_GOOD=new Map();
const DECISION_JOBS=new Map();
const TRADE_RADAR_CACHE=new Map();
const TRADE_RADAR_JOBS=new Map();
const TRADE_RADAR_TTL=15000;

async function getDecisionSnapshotCached(symbol,interval,searchParams,device){
  const jobKey=String(symbol)+"|"+String(interval)+"|"+String(searchParams?.toString?.()||"")+"|"+String(device||"");
  let job=DECISION_JOBS.get(jobKey);
  if(!job){
    job=buildDecisionSnapshot(symbol,interval,searchParams||new URLSearchParams(),device).finally(()=>{
      if(DECISION_JOBS.get(jobKey)===job)DECISION_JOBS.delete(jobKey);
    });
    DECISION_JOBS.set(jobKey,job);
  }
  try{
    return await Promise.race([
      job,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error("DECISION_ENGINE_WARMING")),6500))
    ]);
  }catch(e){
    if(String(e?.message||e)!=="DECISION_ENGINE_WARMING")throw e;
    const key=String(symbol)+"|"+String(interval);
    const last=DECISION_LAST_GOOD.get(key);
    if(last?.payload){
      return {
        ...last.payload,ok:true,stale:true,warming:true,
        action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
        market:{...(last.payload.market||{}),side:"WAIT",status:"WARMING",type:"ENGINE WARMING / NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(last.payload.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        deploymentGate:{...(last.payload.deploymentGate||{}),state:"BLOCKED",reason:"Fresh decision is still computing; stale data is not eligible for a live signal."},
        operational:{...(last.payload.operational||{}),liveUse:"PAPER_ONLY"},
        signalStability:{state:"RELEASED",reason:"decision_warming"},
        degraded:"DECISION_ENGINE_WARMING"
      };
    }
    return {
      ok:true,warming:true,stale:false,cache:"warming",symbol,interval,
      action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
      market:{side:"WAIT",status:"WARMING",type:"ENGINE WARMING / NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL",confluenceScore:0},
      levels:{entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      deploymentGate:{state:"BLOCKED",reason:"Decision engine is warming; no trade signal is available."},
      operational:{liveUse:"PAPER_ONLY"},
      signalStability:{state:"RELEASED",reason:"decision_warming"},
      degraded:"DECISION_ENGINE_WARMING"
    };
  }
}
const SIGNAL_STABILITY=new Map();
const SIGNAL_CONFIRMATIONS_REQUIRED=1;
const SIGNAL_RELEASE_MISSES=1;
const SIGNAL_CANDIDATE_TTL_MS=180000;
const SIGNAL_MODE="LOOSE";

function signalStabilityKey(symbol,interval){return String(symbol)+"|"+String(interval)}
function hardSignalBlock(decision){
  const state=String(decision?.state||"").toUpperCase();
  const gate=String(decision?.deploymentGate?.state||"").toUpperCase();
  const reason=String(decision?.reason||"").toLowerCase();
  return Boolean(
    decision?.stale ||
    state==="DATA_BLOCKED" ||
    state==="RISK_BLOCKED" ||
    gate==="BLOCKED" ||
    reason.includes("data quality") ||
    reason.includes("risk gate") ||
    reason.includes("stale") ||
    reason.includes("higher-timeframe trend conflicts") ||
    reason.includes("15m trend conflicts") ||
    reason.includes("cvd divergence") ||
    reason.includes("r:r below") ||
    reason.includes("derivatives unavailable") ||
    reason.includes("insufficient derivatives completeness")
  );
}
function applySignalStability(decision,symbol,interval){
  const d=decision||{}, key=signalStabilityKey(symbol,interval), now=Date.now();
  const candidate=["LONG","SHORT"].includes(String(d?.action||"").toUpperCase()) ? String(d.action).toUpperCase() : null;
  const eligible=Boolean(d?.liveSignalEligible&&candidate);
  const row=SIGNAL_STABILITY.get(key)||{side:null,confirmations:0,misses:0,confirmed:false,lastTs:0,levels:null,lastPrice:null};

  if(eligible){
    if(row.side===candidate){
      row.confirmations=Math.min(SIGNAL_CONFIRMATIONS_REQUIRED,row.confirmations+1);
    }else{
      row.side=candidate; row.confirmations=1; row.misses=0; row.confirmed=false;
    }
    row.lastTs=now;
    row.lastPrice=Number.isFinite(Number(d?.market?.price))?Number(d.market.price):row.lastPrice;
    row.levels=d?.levels||d?.candidateEvidence?.levels||row.levels||null;
    if(row.confirmations>=SIGNAL_CONFIRMATIONS_REQUIRED)row.confirmed=true;
    SIGNAL_STABILITY.set(key,row);

    if(row.confirmed){
      return {...d,signalStability:{state:"CONFIRMED",side:candidate,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0},
        rawAction:d.rawAction||candidate};
    }

    const confirmingReason="Directional setup detected, but it must persist across "+SIGNAL_CONFIRMATIONS_REQUIRED+" live refreshes before becoming a confirmed signal.";
    return {
      ...d,
      rawAction:d.rawAction||candidate,
      action:"WAIT",
      state:"NO_TRADE",
      liveSignalEligible:false,
      market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"CONFIRMING SETUP",bias:"Neutral",directionalLean:"NEUTRAL"},
      levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      deploymentGate:{...(d.deploymentGate||{}),state:"CONFIRMING",reason:confirmingReason},
      operational:{...(d.operational||{}),liveUse:"PAPER_ONLY"},
      candidateEvidence:{
        action:candidate,state:d.state,market:d.market||null,levels:d.levels||null,
        thesis:d.evidence?.thesis||null,type:d.market?.type||null,
        strategyFamily:d.analysis?.strategyFamily||d.strategyFamily||"NONE"
      },
      signalStability:{state:"CONFIRMING",side:candidate,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0}
    };
  }

  if(!row.confirmed){
    const transientCandidate=["LONG","SHORT"].includes(String(
      d?.rawAction||d?.candidateEvidence?.action||d?.market?.side||""
    ).toUpperCase())?String(
      d?.rawAction||d?.candidateEvidence?.action||d?.market?.side
    ).toUpperCase():null;
    const age=now-Number(row.lastTs||0);
    const samePending=transientCandidate===row.side && age<=30000 && !hardSignalBlock(d);
    if(samePending){
      SIGNAL_STABILITY.set(key,row);
      return {
        ...d,
        rawAction:d.rawAction||row.side,
        action:"WAIT",
        state:"NO_TRADE",
        liveSignalEligible:false,
        market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"PENDING CONFIRMATION",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        candidateEvidence:{...(d.candidateEvidence||{}),action:row.side,levels:d.candidateEvidence?.levels||d.levels||null,market:d.market||null},
        deploymentGate:{...(d.deploymentGate||{}),state:String(d.deploymentGate?.state||"PAPER_ONLY").toUpperCase()},
        signalStability:{state:"CONFIRMING",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:row.misses,retainedAfterTransientGap:true}
      };
    }
    SIGNAL_STABILITY.delete(key);
    return {...d,signalStability:{state:"NONE",side:null,confirmations:0,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:0}};
  }

  const rowAge=now-Number(row.lastTs||0);
  const currentPrice=Number(d?.market?.price??d?.livePrice);
  const stop=Number(row?.levels?.stop??d?.candidateEvidence?.levels?.stop);
  const invalidated=(row.side==="LONG"&&Number.isFinite(currentPrice)&&Number.isFinite(stop)&&currentPrice<=stop) ||
    (row.side==="SHORT"&&Number.isFinite(currentPrice)&&Number.isFinite(stop)&&currentPrice>=stop);
  if(row.confirmed&&(rowAge>SIGNAL_CANDIDATE_TTL_MS||invalidated)){
    const reason=invalidated?"PRICE_INVALIDATION":"CANDIDATE_EXPIRED";
    SIGNAL_STABILITY.delete(key);
    return {...d,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
      rawAction:row.side,
      market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:reason,bias:"Neutral",directionalLean:"NEUTRAL"},
      levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      deploymentGate:{...(d.deploymentGate||{}),state:"BLOCKED",reason},
      candidateEvidence:{...(d.candidateEvidence||{}),action:row.side,levels:row.levels||null},
      signalStability:{state:"RELEASED",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:row.misses,reason}};
  }

  if(hardSignalBlock(d)){
    SIGNAL_STABILITY.delete(key);
    return {...d,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
      market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
      levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
      candidateEvidence:d.candidateEvidence||{
        action:d.rawAction||row.side,state:d.state,market:d.market||null,levels:d.levels||null,
        thesis:d.evidence?.thesis||null,type:d.market?.type||null,
        strategyFamily:d.analysis?.strategyFamily||d.strategyFamily||"NONE"
      },
      deploymentGate:{...(d.deploymentGate||{}),state:"BLOCKED"},
      signalStability:{state:"RELEASED",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:SIGNAL_RELEASE_MISSES}};
  }

  if(row.side===String(d?.rawAction||"").toUpperCase() || row.side===String(d?.market?.side||"").toUpperCase()){
    row.misses+=1; row.lastTs=now;
    if(row.misses<SIGNAL_RELEASE_MISSES){
      SIGNAL_STABILITY.set(key,row);
      return {
        ...d,
        action:"WAIT",
        state:"NO_TRADE",
        liveSignalEligible:false,
        rawAction:d.rawAction||row.side,
        market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"HOLDING PREVIOUS CONTEXT",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(d.levels||{}),side:"WAIT",entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        candidateEvidence:{
          ...(d.candidateEvidence||{}),
          action:row.side,
          state:d.state,
          market:d.market||null,
          levels:d.candidateEvidence?.levels||null,
          thesis:d.evidence?.thesis||null,
          type:d.market?.type||null,
          strategyFamily:d.analysis?.strategyFamily||d.strategyFamily||"NONE"
        },
        deploymentGate:{...(d.deploymentGate||{}),state:String(d.deploymentGate?.state||"PAPER_ONLY").toUpperCase()},
        signalStability:{state:"HOLDING",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:row.misses,releaseAfter:SIGNAL_RELEASE_MISSES}
      };
    }
  }

  SIGNAL_STABILITY.delete(key);
  return {...d,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
    market:{...(d.market||{}),side:"WAIT",status:"WAITING",type:"NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
    levels:{...(d.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
    deploymentGate:{...(d.deploymentGate||{}),state:"PAPER_ONLY"},
    signalStability:{state:"RELEASED",side:row.side,confirmations:row.confirmations,required:SIGNAL_CONFIRMATIONS_REQUIRED,misses:SIGNAL_RELEASE_MISSES}};
}
function sanitizeFinalDecision(decision){
  const d=decision||{};
  const eligible=Boolean(d.liveSignalEligible===true&&d.state==="READY"&&["LONG","SHORT"].includes(String(d.action||"").toUpperCase()));
  if(eligible)return d;

  const rawSide=["LONG","SHORT"].includes(String(d.rawAction||"").toUpperCase())?String(d.rawAction).toUpperCase():null;
  const analysisSide=["LONG","SHORT"].includes(String(d.analysis?.side||"").toUpperCase())?String(d.analysis.side).toUpperCase():null;
  const existingLevels=d.levels&&Number.isFinite(Number(d.levels.entry))?d.levels:null;
  const analysisLevels=d.analysis&&(Number.isFinite(Number(d.analysis.entry))||Number.isFinite(Number(d.analysis.entryLow)))?{
    side:analysisSide||String(d.analysis.side||"WAIT").toUpperCase(),
    entryLow:d.analysis.entryLow??d.analysis.entry??null,
    entryHigh:d.analysis.entryHigh??d.analysis.entry??null,
    entry:d.analysis.entry??null,
    stop:d.analysis.stop??null,
    tp1:d.analysis.tp1??null,
    tp2:d.analysis.tp2??null,
    rr:d.analysis.rr??null,
    riskDistance:d.analysis.riskDistance??null,
    target1Distance:d.analysis.target1Distance??null
  }:null;
  const candidate=d.candidateEvidence&&typeof d.candidateEvidence==="object"
    ?{
      ...d.candidateEvidence,
      action:["LONG","SHORT"].includes(String(d.candidateEvidence.action||"").toUpperCase())?String(d.candidateEvidence.action).toUpperCase():(rawSide||analysisSide||"WAIT"),
      levels:d.candidateEvidence.levels&&Number.isFinite(Number(d.candidateEvidence.levels.entry))
        ?d.candidateEvidence.levels:(existingLevels||analysisLevels)
    }
    :{
      action:rawSide||analysisSide||String(d.market?.side||"WAIT").toUpperCase(),
      state:d.state||"NO_TRADE",
      market:d.market||null,
      levels:existingLevels||analysisLevels,
      thesis:d.evidence?.thesis||null,
      type:d.market?.type||null,
      strategyFamily:d.analysis?.strategyFamily||d.strategyFamily||"NONE"
    };

  const neutral={
    ...d,
    candidateEvidence:candidate,
    action:"WAIT",
    state:"NO_TRADE",
    liveSignalEligible:false,
    market:{
      ...(d.market||{}),
      side:"WAIT",
      status:"WAITING",
      type:"NO TRADE",
      bias:"Neutral",
      directionalLean:"NEUTRAL",
      probabilityLabel:"LOW CONFLUENCE"
    },
    levels:{
      ...(d.levels||{}),
      side:"WAIT",
      entryLow:null,
      entryHigh:null,
      entry:null,
      stop:null,
      tp1:null,
      tp2:null,
      rr:null,
      riskDistance:null,
      target1Distance:null
    },
    evidence:{
      ...(d.evidence||{}),
      thesis:[
        d.stale
          ?"Live decision data is stale; directional output is suppressed until a fresh decision is available."
          :"No trade — the directional candidate has not cleared the final confirmation, validation, data, and risk gates."
      ],
      primaryScenario:"Wait for a confirmed directional setup.",
      invalidationScenario:"A new closed-candle setup plus all final safety gates must clear before a direction is shown.",
      contributors:[],
      strictGate:{
        ...(d.evidence?.strictGate||{}),
        eligible:false
      }
    },
    strategyFamily:"NONE",
    deploymentGate:{
      ...(d.deploymentGate||{}),
      state:String(d.deploymentGate?.state||"PAPER_ONLY").toUpperCase()==="BLOCKED"?"BLOCKED":"PAPER_ONLY"
    },
    // Preserve the model's computed trade map as read-only conditional context.
    // It is intentionally separate from `levels`, which is blanked for non-eligible
    // decisions and remains the only level set allowed by execution preparation.
    conditionalLevels:candidate.levels||null,
    operational:{
      ...(d.operational||{}),
      liveUse:"PAPER_ONLY"
    }
  };

  return neutral;
}
const PHASE1113_CACHE=new Map(); const PHASE1113_JOBS=new Set(); const PHASE1113_TTL=10*60*1000;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const AI_LIMIT_MS=8000; const AI_CALLS=new Map();
const DATA_TIMEOUT_MS=7000;
const GLOBAL_RATE_WINDOW_MS=5*60*1000;
const GLOBAL_RATE_LIMIT=300;
const GLOBAL_RATE=new Map();
const FAST_PUBLIC_PATHS=new Set(["/api/core","/api/chart","/api/fast-ticker","/api/core-enrichment","/api/core-analytics","/api/decision","/api/validation","/api/data-fabric","/api/config","/health","/"]);
const FAST_TICKER_CACHE=new Map(); const FAST_TICKER_CACHE_TTL_MS=750;
const CSRF_COOKIE="mp_csrf";
const SERVER_METRICS={startedAt:Date.now(),requests:0,errors:0,totalLatencyMs:0,routeCounts:new Map(),lastErrors:[],recentRequests:[]};
let RESEARCH_JOB={running:false,startedAt:null,finishedAt:null,error:null,symbol:null,interval:null,bars:0,records:0,trained:0,skipped:0,progress:{processed:0,total:0,pct:0}};
async function runResearchWarmup(){
  if(RESEARCH_JOB.running)return {skipped:true,reason:"job_running"};
  const enabled=String(process.env.RESEARCH_WARMUP_ENABLED??"true").toLowerCase()!=="false";
  if(!enabled)return {skipped:true,reason:"disabled"};
  try{
    const st=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
    const updates=Number(st?.model?.updates)||0;
    if(updates>=150)return {skipped:true,reason:"already_warmed",updates};
  }catch{}
  const symbols=String(process.env.RESEARCH_WARMUP_SYMBOLS||"BTCUSDT,ETHUSDT").split(",").map(s=>s.trim().toUpperCase()).filter(s=>SYMBOLS.includes(s));
  const bars=Math.max(600,Math.min(3000,Number(process.env.RESEARCH_WARMUP_BARS||1500)));
  for(const symbol of symbols){
    if(RESEARCH_JOB.running)return {skipped:true,reason:"job_running"};
    RESEARCH_JOB={running:true,startedAt:Date.now(),finishedAt:null,error:null,symbol,interval:"1h",bars,records:0,trained:0,skipped:0,mode:"automatic",progress:{processed:0,total:0,pct:0}};
    try{
      const built=await research.buildReplayRecords({symbol,interval:"1h",bars,analyze,onProgress:async function(progress){RESEARCH_JOB.progress=progress}});
      RESEARCH_JOB.records=built.records.length;
      RESEARCH_JOB.progress={processed:built.bars,total:built.bars,pct:100};
      const trained=await learning.trainFromReplay(built.records);
      RESEARCH_JOB.trained=trained.trained;RESEARCH_JOB.skipped=trained.skipped;
      RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();
    }catch(e){
      RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();RESEARCH_JOB.error=String(e.message||e);
    }
  }
  return {ok:true};
}
let ADMIN_RUNTIME={loadedAt:0,config:null};
async function getAdminRuntime(force=false){
  if(!force&&ADMIN_RUNTIME.config&&Date.now()-ADMIN_RUNTIME.loadedAt<2000)return ADMIN_RUNTIME.config;
  try{ADMIN_RUNTIME.config=await storage.getAdminConfig();ADMIN_RUNTIME.loadedAt=Date.now();return ADMIN_RUNTIME.config}catch{return ADMIN_RUNTIME.config||{mode:"normal",maintenanceMode:false,readOnlyMode:false,registrationsEnabled:true,aiEnabled:true,executionEnabled:true,marketDataEnabled:true,writesEnabled:true,maintenanceMessage:"MarketPulse is temporarily unavailable."}}
}
async function setAdminRuntime(payload){ADMIN_RUNTIME.config=payload;ADMIN_RUNTIME.loadedAt=Date.now();return payload}
function featureEnabled(flags,key){return Boolean(flags?.[key]?.enabled!==false&&Number(flags?.[key]?.rolloutPct??100)>0)}
async function auditAdmin(req,action,category,targetUserId,metadata){
  try{const u=await auth.userFromRequest(req);if(u?.isAdmin)await storage.recordAdminAudit(u.email,action,category,targetUserId,metadata||{})}catch{}
}
async function securityEvent(severity,eventType,email,metadata){try{await storage.recordSecurityEvent(severity,eventType,email,metadata||{})}catch{}}

function clientIp(req){
  const peer=String(req.socket?.remoteAddress||"unknown");
  // Proxy headers are untrusted unless the deployment explicitly opts in.
  if(process.env.MARKETPULSE_TRUST_PROXY!=="true")return peer;
  const chain=String(req.headers["x-forwarded-for"]||"").split(",").map(x=>x.trim()).filter(Boolean);
  return chain.at(-1)||peer;
}
function rateRequest(req,path){
  const method=String(req.method||"GET").toUpperCase();
  const route=String(path||"");
  
  // Normal dashboard delivery and live market transport must not be throttled
  // by the heavy API limiter. The dashboard is intentionally chatty while
  // maintaining a real-time market session.
  if(method==="GET"&&(
    !route.startsWith("/api/") ||
    route==="/api/live-sync" ||
    route==="/api/fast-ticker" ||
    route==="/api/market-state" ||
    route==="/api/chart"
  ))return true;

  const key=clientIp(req),now=Date.now();
  // Prevent a large set of spoofed or rotating IPs from growing this map indefinitely.
  if(GLOBAL_RATE.size>5000){
    for(const [id,bucket] of GLOBAL_RATE)if(now-bucket.started>GLOBAL_RATE_WINDOW_MS)GLOBAL_RATE.delete(id);
    while(GLOBAL_RATE.size>5000)GLOBAL_RATE.delete(GLOBAL_RATE.keys().next().value);
  }
  const x=GLOBAL_RATE.get(key);
  if(!x||now-x.started>GLOBAL_RATE_WINDOW_MS){
    GLOBAL_RATE.set(key,{started:now,count:1});
    return true;
  }
  x.count++;
  return x.count<=GLOBAL_RATE_LIMIT;
}
function originAllowed(req){
  const fetchSite=String(req.headers["sec-fetch-site"]||"").toLowerCase();
  if(fetchSite==="cross-site"||fetchSite==="same-site")return false;
  const origin=req.headers.origin;
  if(!origin)return true;
  const proto=String(req.headers["x-forwarded-proto"]||"http").split(",")[0].trim();
  const host=String(req.headers.host||"");
  return origin===proto+"://"+host;
}
function csrfCookie(){
  const secure=String(process.env.NODE_ENV||"").toLowerCase()==="production"?" Secure;":"";
  return CSRF_COOKIE+"="+crypto.randomBytes(32).toString("hex")+"; Path=/; SameSite=Strict; Max-Age=86400;"+secure;
}
const ADMIN_ONLY_PREFIXES=['/api/admin'];
const LIVE_VISITORS=new Map();
function markLiveVisitor(device,registered){
  const id=String(device||"").slice(0,128);
  if(!id)return;
  LIVE_VISITORS.set(id,{lastSeen:Date.now(),registered:Boolean(registered)});
}
function liveVisitorStats(){
  const cutoff=Date.now()-120000;
  let visitors=0,registered=0;
  for(const [id,row] of LIVE_VISITORS){if(row.lastSeen<cutoff){LIVE_VISITORS.delete(id);continue}visitors++;if(row.registered)registered++}
  return {liveVisitors:visitors,liveRegistered:registered};
}

const ADMIN_ONLY_PATHS=new Set([
  '/api/edge',
  '/api/memory/status',
  '/api/phase7/health',
  '/api/learning/status',
  '/api/edge/health',
  '/api/edge/events',
  '/api/edge/config',
  '/api/edge/journal',
  '/api/execution',
  '/api/execution/config',
  '/api/execution/arm',
  '/api/execution/kill',
  '/api/execution/reconcile',
  '/api/execution/prepare',
  '/api/execution/intent',
  '/api/execution/submit',
  '/api/execution/cancel',
  '/api/execution/close-sim',
  '/api/autotrader',
  '/api/autotrader/history',
  '/api/autotrader/config',
  '/api/autotrader/arm',
  '/api/autotrader/pause',
  '/api/autotrader/kill',
  '/api/portfolio/config',
  '/api/portfolio/health',
  '/api/system-check',
  '/api/dna/clear',
  '/api/research/status',
  '/api/research/train',
  '/api/phase14',
  '/api/phase14/validation',
  '/api/phase14/calibrate',
  '/api/phase15',
  '/api/phase15/calibrate',
  '/api/phase15/audit'
]);
function normalizeFundingRate(value){
  const n=Number(value);
  if(!Number.isFinite(n))return null;
  if(Math.abs(n)>0.1)return n/100;
  return n;
}
function timeoutSignal(ms){return typeof AbortSignal!=="undefined"&&AbortSignal.timeout?AbortSignal.timeout(ms):undefined;}
function queueCoreAnalytics(symbol,interval,candles){
  const key=String(symbol)+"|"+String(interval),hit=CORE_ANALYTICS_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<CORE_ANALYTICS_TTL)return hit.payload;
  if(CORE_ANALYTICS_JOBS.has(key))return hit?.payload||null;
  CORE_ANALYTICS_JOBS.add(key);
  const sample=(candles||[]).slice(-600);
  setTimeout(()=>{
    (async()=>{
      try{
        if(sample.length<240)return;
    const payload={
          backtest:backtest(sample),
          validation:walkForwardBacktest(sample),
          setupStats:backtestBySetup(sample)
        };
        CORE_ANALYTICS_CACHE.set(key,{ts:Date.now(),payload});
      }catch{}finally{CORE_ANALYTICS_JOBS.delete(key)}
    })();
  },1500);
  return hit?.payload||null;
}

function queuePhase1113Validation(symbol,interval,candles){
  const key="P11-13|"+String(symbol)+"|"+String(interval),now=Date.now(),hit=PHASE1113_CACHE.get(key);
  if(hit&&now-hit.ts<PHASE1113_TTL)return hit.payload;
  if(PHASE1113_JOBS.has(key))return hit?.payload||null;
  const fallback=(candles||[]).slice(-900);
  if(fallback.length<260)return hit?.payload||null;
  PHASE1113_JOBS.add(key);
  setTimeout(async()=>{
    try{
      let source=fallback;
      try{
        const historical=await research.fetchBinanceKlines(symbol,interval,{maxBars:1800});
        const closed=closedCandles(historical,interval,Date.now());
        if(closed.length>=600)source=closed;
      }catch{}
      const sample=source.slice(-1500);
      let higher8h=null;
      if(String(interval).toLowerCase()==="15m"){
        try{
          const h=await research.fetchBinanceKlines(symbol,"8h",{maxBars:1800});
          higher8h=closedCandles(h,"8h",Date.now());
        }catch{}
      }
      const validation=phase1113.runWalkForward(sample,{symbol,interval,higher8h,basePolicy:{minScore:78,minRR:1.5},step:2,maxSamples:350,minTrades:80,minTestBars:300});
      PHASE1113_CACHE.set(key,{ts:Date.now(),payload:validation});
      try{
        const state=await storage.getLearningState();
        const payload=state?.payload&&typeof state.payload==="object"?state.payload:{};
        await storage.saveLearningState({...payload,phase11_13:{...validation,storedAt:Date.now()}});
      }catch{}
    }catch{}finally{PHASE1113_JOBS.delete(key)}
  },100);
  return hit?.payload||null;
}

function safePhase14Summary(validation){
  return {
    version:"14.0.0",
    method:"Phase 11/12 walk-forward replay aggregated by setup and regime.",
    setupBuckets:validation?.setupBuckets||{},
    regimeBuckets:validation?.regimeBuckets||{},
    adaptive:validation?.adaptive||null,
    sample:validation?.summary||null
  };
}

async function buildDecisionSnapshot(symbol,interval,query,deviceId=null){
  const key=symbol+"|"+interval,now=Date.now(),cached=DECISION_CACHE.get(key);
  if(cached&&now-cached.ts<DECISION_TTL)return Object.assign({cache:"fresh",cacheAgeMs:now-cached.ts},cached.payload);
  try{
    const rawCandles=await getFastKlines(symbol,interval);
    const candles=closedCandles(rawCandles,interval,now);
    if(!candles||candles.length<220)throw Error("Insufficient closed candles");
    const phase14Profile=phase14.peekAdaptiveProfile({symbol,interval})||null;
    if(!phase14Profile){
      setTimeout(()=>phase14.getAdaptiveProfile(storage,{symbol,interval}).catch(()=>null),0);
    }
    const lowerInterval=interval==="15m"?null:"15m";
    const higherInterval=interval==="4h"?"1d":interval==="1d"?null:"4h";
    const dlineHigherInterval=interval==="15m"?"8h":null;
    const liveSeed=flowBucket(symbol);
    const consensusPrimaryPrice=Number.isFinite(Number(liveSeed.markPrice))?Number(liveSeed.markPrice):candles[candles.length-1]?.c;
    const consensusPrimaryAge=Number.isFinite(Number(liveSeed.lastTs))&&Number(liveSeed.lastTs)>0
      ?Math.max(0,now-Number(liveSeed.lastTs))
      :(candles[candles.length-1]?.t?Math.max(0,now-Number(candles[candles.length-1].t)):null);
    // Supporting feeds are independent. Fetch them concurrently so one slow
    // provider cannot serially consume the entire decision-engine timeout.
    const [lowerRaw,higherRaw,dlineHigherRaw,deriv,consensus]=await Promise.all([
      lowerInterval?Promise.race([klines(symbol,lowerInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1400))]).catch(()=>null):Promise.resolve(null),
      higherInterval?Promise.race([klines(symbol,higherInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1400))]).catch(()=>null):Promise.resolve(null),
      dlineHigherInterval?Promise.race([klines(symbol,dlineHigherInterval),new Promise(resolve=>setTimeout(()=>resolve(null),1400))]).catch(()=>null):Promise.resolve(null),
      Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),1800))]).catch(()=>null),
      Promise.race([dataFabric.assess(symbol,interval,{
        primaryPrice:consensusPrimaryPrice,
        primaryAgeMs:consensusPrimaryAge,
        primarySource:liveSeed.markPrice!=null?"Bybit live flow":(candles?.[0]?.source||"engine"),
        liveFlow:liveSeed
      }),new Promise(resolve=>setTimeout(()=>resolve(null),2600))]).catch(()=>null)
    ]);
    const lower=lowerRaw?closedCandles(lowerRaw,lowerInterval,now):null;
    const higher=higherRaw?closedCandles(higherRaw,higherInterval,now):null;
    const dlineHigher=dlineHigherRaw?closedCandles(dlineHigherRaw,dlineHigherInterval,now):null;
    const lowerAnalysis=lower&&lower.length>=220&&lowerInterval?analyze(lower,{interval:lowerInterval}):null;
    const higherAnalysis=higher&&higher.length>=220&&higherInterval?analyze(higher,{interval:higherInterval}):null;
    const dlineHigherAnalysis=dlineHigher&&dlineHigher.length>=100?analyze(dlineHigher,{interval:dlineHigherInterval}):null;
    const dlineContext=interval==="1h"?(higherAnalysis||null):(dlineHigherAnalysis||higherAnalysis||null);
    let analysis=analyze(candles,{interval,lower:lowerAnalysis,higher:higherAnalysis,dlineHigher:dlineContext,deriv,phase14Profile});
    let learned=null;
    try{
      learned=await Promise.race([learning.process(symbol,interval,candles,analysis,{observe:false}),new Promise(resolve=>setTimeout(()=>resolve(null),500))]);
      if(learned?.analysis)analysis=learned.analysis;
    }catch{}
    const flow=mergeFlowSnapshot(symbol,deriv||{});
    const analytics=queueCoreAnalytics(symbol,interval,candles);
    const validation1113=queuePhase1113Validation(symbol,interval,candles);
    const getQ=(k,d)=>query&&typeof query.get==='function'?(query.get(k)??d):(query?.[k]??d);
    const usePropFirmGate=String(getQ('propFirmGate',process.env.PROP_FIRM_GATE_ENABLED||"false")).toLowerCase()==="true";
    const signalPolicy={
      minSignalScore:Number(getQ('minSignalScore',process.env.MP_MIN_SIGNAL_SCORE||78)),
      minRR:Number(getQ('minRR',process.env.MP_MIN_RR||1.5))
    };
    const config=usePropFirmGate?propFirm.normalizeConfig({
      accountSize:Number(getQ('accountSize',process.env.PROP_ACCOUNT_SIZE||0)),
      startingEquity:Number(getQ('equity',process.env.PROP_STARTING_EQUITY||0)),
      dailyLossLimitPct:Number(getQ('dailyLossLimitPct',process.env.PROP_DAILY_LOSS_PCT||0)),
      maxDrawdownPct:Number(getQ('maxDrawdownPct',process.env.PROP_MAX_DRAWDOWN_PCT||0)),
      riskPerTradePct:Number(getQ('riskPerTradePct',process.env.PROP_RISK_PER_TRADE_PCT||0)),
      maxOpenRiskPct:Number(getQ('maxOpenRiskPct',process.env.PROP_MAX_OPEN_RISK_PCT||0)),
      minSignalScore:signalPolicy.minSignalScore,
      minRR:signalPolicy.minRR,
      minConsensusQualityPct:Number(getQ('minConsensusQualityPct',process.env.PROP_MIN_CONSENSUS_QUALITY_PCT||85)),
      maxPriceDispersionBps:Number(getQ('maxPriceDispersionBps',process.env.PROP_MAX_PRICE_DISPERSION_BPS||80)),
      blockMixedFlow:String(getQ('blockMixedFlow',process.env.PROP_BLOCK_MIXED_FLOW||"true"))!=="false"
    }):null;
    const liveMarketAgeMs=Number.isFinite(Number(liveSeed?.lastTs))&&Number(liveSeed.lastTs)>0
      ?Math.max(0,now-Number(liveSeed.lastTs))
      :(Number.isFinite(Number(consensus?.freshestAgeMs))?Number(consensus.freshestAgeMs):(candles.length?Math.max(0,now-Number(candles[candles.length-1].t)):null));
    const gate=usePropFirmGate
      ?propFirm.evaluateStandard({
        analysis,derivatives:flow,
        dataQuality:{
          candleAgeMs:liveMarketAgeMs,
          qualityPct:flow?.available?100:80,
          consensusQualityPct:consensus?.consensusQualityPct,
          priceDispersionBps:consensus?.priceDispersionBps,
          providerCount:consensus?.sourceCount,
          independentSourceCount:consensus?.independentSourceCount
        },
        equity:config.startingEquity,dayStartEquity:config.startingEquity,peakEquity:config.startingEquity,config
      })
      :{decision:"DISABLED",reasons:[],warnings:["PROP_FIRM_GATE_DISABLED"],mode:"GENERAL_MARKET_MODE"};
    const decision=phase910.evaluate({
      symbol,interval,analysis,lower:lowerAnalysis,higher:higherAnalysis,derivatives:flow,consensus,
      dataQuality:{candleAgeMs:liveMarketAgeMs},
      liveFlow:flow,validation:analytics?.validation||null,propGate:gate
    });
    // Preserve the engine's calculated setup before deployment gating can blank
    // executable levels. This remains conditional context only; execution still
    // requires the final gated READY decision.
    const decisionLevels=decision?.levels&&typeof decision.levels==="object"?decision.levels:{};
    const analysisLevels={
      side:analysis?.side||decisionLevels.side||"WAIT",
      entryLow:analysis?.entryLow??null,
      entryHigh:analysis?.entryHigh??null,
      entry:analysis?.entry??null,
      stop:analysis?.stop??null,
      tp1:analysis?.tp1??null,
      tp2:analysis?.tp2??null,
      rr:analysis?.rr??null,
      riskDistance:analysis?.riskDistance??null,
      target1Distance:analysis?.target1Distance??null
    };
    const finitePositive=(v)=>Number.isFinite(Number(v))&&Number(v)>0?v:null;
    const candidateSource=(
      decisionLevels && typeof decisionLevels==="object" &&
      ["LONG","SHORT"].includes(String(decisionLevels.side||"").toUpperCase())
    ) ? decisionLevels : (
      analysis?.tradeLevels && typeof analysis.tradeLevels==="object" ? analysis.tradeLevels : (
        ["LONG","SHORT"].includes(String(analysisLevels.side||"").toUpperCase()) ? analysisLevels : null
      )
    );
    const conditionalCheck=candidateSource
      ? validateTradeLevels(candidateSource,{minRR:signalPolicy.minRR})
      : {valid:false,reasons:["NO_TRADE_LEVELS"]};
    const conditionalLevels=conditionalCheck.valid ? {
      side:conditionalCheck.side,
      entryLow:conditionalCheck.entryLow,
      entryHigh:conditionalCheck.entryHigh,
      entry:conditionalCheck.entry,
      stop:conditionalCheck.stop,
      tp1:conditionalCheck.tp1,
      tp2:conditionalCheck.tp2,
      rr:conditionalCheck.rr,
      riskDistance:conditionalCheck.riskDistance,
      target1Distance:conditionalCheck.target1Distance,
      rr1:conditionalCheck.rr1,
      rr2:conditionalCheck.rr2,
      riskAtr:candidateSource.riskAtr??null,
      source:candidateSource.source||"CONSERVATIVE LEVEL BUILDER",
      valid:true
    } : null;
    const levelBlockReason=conditionalLevels?null:(
      Array.isArray(conditionalCheck.reasons)&&conditionalCheck.reasons.length
        ?conditionalCheck.reasons.join(", ")
        :"NO_VALID_TRADE_LEVELS"
    );
    const gatedDecision=phase1113.applyDeploymentGate(decision,validation1113,{basePolicy:signalPolicy});
    const stableDecision=applySignalStability(gatedDecision,symbol,interval);
    let finalDecision=sanitizeFinalDecision(stableDecision);
    const signalCandidate=(()=>{
      const candidates=[
        stableDecision?.rawAction,
        stableDecision?.candidateEvidence?.action,
        gatedDecision?.action,
        decision?.action,
        analysis?.side,
        analysis?.marketStructure?.setup?.side,
        phaseStack?.direction||phaseStack?.bias?.side
      ];
      const side=candidates.map(v=>String(v||"").toUpperCase()).find(v=>v==="LONG"||v==="SHORT")||"WAIT";
      return {
        side,
        score:Number.isFinite(Number(finalDecision?.market?.confluenceScore))?Number(finalDecision.market.confluenceScore):
          Number.isFinite(Number(analysis?.score))?Number(analysis.score):null,
        source:stableDecision?.rawAction||gatedDecision?.action||decision?.action||analysis?.side||"WAIT"
      };
    })();
    finalDecision={
      ...finalDecision,
      conditionalLevels:conditionalLevels||null,
      candidateEvidence:{
        ...(finalDecision.candidateEvidence||{}),
        levels:conditionalLevels||null,
        levelValidation:{
          valid:Boolean(conditionalLevels),
          minimumRR:signalPolicy.minRR,
          reason:levelBlockReason
        }
      },
      levelSafety:{
        valid:Boolean(conditionalLevels),
        minimumRR:signalPolicy.minRR,
        reason:levelBlockReason,
        riskAtr:conditionalLevels?.riskAtr??null
      }
    };
    const decisionIntelligence=buildDecisionIntelligence({analysis,decision:finalDecision});
    let phase18State=null;
    try{
      phase18State=await Promise.race([
        phase18MarketState.snapshot(symbol,{fast:true,liveFlow:flow}),
        new Promise(resolve=>setTimeout(()=>resolve(null),1400))
      ]);
    }catch{}
    let phase6State=null;
    try{phase6State=await Promise.race([
      phase6.snapshot(),
      new Promise(resolve=>setTimeout(()=>resolve(null),700))
    ])}catch{}
    const phase20Scenario=phase20.buildScenarioMatrix({
      symbol,
      interval,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      decision:{...finalDecision,derivatives:flow},
      analysis,
      decisionIntelligence,
      marketState:phase18State,
      ts:now
    });
    const canonicalState=phase21.normalize({
      symbol,
      interval,
      ts:now,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      decision:{...finalDecision,derivatives:flow},
      structure:analysis?.marketStructure||{},
      liquidity:analysis?.liquidity||flow?.liquidity||{}
    });
    const canonicalSnapshotId=phase21.hash(canonicalState);
    const phaseStackState=phaseStack.evaluate({
      symbol,
      interval,
      ts:now,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      decision:{...finalDecision,derivatives:flow},
      analysis,
      derivatives:flow,
      consensus,
      candidateAction:signalCandidate?.side||finalDecision?.action||"WAIT",
      validation:validation1113,
      decisionIntelligence,
      marketState:phase18State||{},
      priorDirection:String(finalDecision?.action||"WAIT").toUpperCase(),
      operatorApproved:String(process.env.MARKETPULSE_PHASE50_OPERATOR_ACK||"false").toLowerCase()==="true",
      shadow:String(process.env.MARKETPULSE_PHASE50_SHADOW_MODE||"true").toLowerCase()!=="false"
    });
    const earlyCandidate=(()=>{
      const candidates=[
        signalCandidate?.side,
        phase101to200State?.aggregation?.direction,
        phase101to200State?.baseline?.action,
        analysis?.side,
        analysis?.marketStructure?.setup?.side
      ];
      const side=candidates.map(v=>String(v||"").toUpperCase()).find(v=>v==="LONG"||v==="SHORT")||"WAIT";
      return {side,source:candidates.map(v=>String(v||"").toUpperCase()).find(v=>v==="LONG"||v==="SHORT")||"WAIT"};
    })();
    const validationEvidence=validation1113||analytics?.validation||null;
    const validationReady=Boolean(validation1113?.adaptive?.signalGateReady);
    const candidateSideForValidation=String(signalCandidate?.side||finalDecision?.action||analysis?.side||"").toUpperCase();
    const directionalValidation=validationEvidence?.directional?.[candidateSideForValidation.toLowerCase()]||null;
    const empiricalWinRate=validationReady
      ? (Number.isFinite(Number(directionalValidation?.trades))&&Number(directionalValidation.trades)>=20&&Number.isFinite(Number(directionalValidation?.winRate))
          ? Number(directionalValidation.winRate)
          : Number.isFinite(Number(validationEvidence?.summary?.winRate))?Number(validationEvidence.summary.winRate):null)
      : null;
    const phase51to100State=phase51to100.evaluate({
      symbol,interval,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      decision:{...finalDecision,derivatives:flow},
      analysis,derivatives:flow,consensus,decisionIntelligence,
      candidateAction:signalCandidate?.side||finalDecision?.action||"WAIT",
      phase20:phase20Scenario,phaseStack:phaseStackState,
      mtf:{higher:String(finalDecision?.higher?.side||finalDecision?.higherTimeframe?.side||analysis?.higher?.side||finalDecision?.action||"WAIT").toUpperCase(),
           execution:String(finalDecision?.action||"WAIT").toUpperCase(),
           lower:String(analysis?.lower?.side||analysis?.lowerTimeframe?.side||finalDecision?.action||"WAIT").toUpperCase()},
      triggerConfirmed:Boolean(finalDecision?.liveSignalEligible&&finalDecision?.state==="READY"),
      setupEvidence:Boolean(analysis?.marketStructure?.setup||analysis?.setup||decisionIntelligence?.strategyFamily),
      flowEvidence:Boolean(flow?.available!==false&&(flow?.cvdState||flow?.takerImbalance!=null)),
      invalidation:Boolean(conditionalLevels?.stop!=null),
      levelsValid:Boolean(conditionalLevels?.entry!=null||conditionalLevels?.entryLow!=null),
      invalidationText:String(levelBlockReason||"Structural invalidation is defined by the final decision."),
      signalAgeMs:Math.max(0,now-Number(candles?.[candles.length-1]?.t||now)),
      signalTtlMs:Math.max(mins(interval)*60*1000*1.5,60000),
      dataQualityOk:Boolean(phaseStackState?.data?.quality?.liveEligible),
      riskBlocked:Boolean(phaseStackState?.risk?.blocked),
      anomalyBlocked:Boolean(phaseStackState?.anomaly?.anomalous),
      publicReadiness:{
        data:Boolean(phaseStackState?.data?.quality?.liveEligible),
        validation:validationReady,
        calibration:validationReady,
        risk:!Boolean(phaseStackState?.risk?.blocked),
        // Phase 51–100 is a read-only public decision-support surface. The stricter
        // admin/operator security audit remains enforced by Phase 49/50 and is not
        // conflated with ordinary public signal availability.
        security:true,
        observability:true,operations:true
      },
      exchangeHealth:(()=>{
        const venues=Array.isArray(phase18State?.venues)?phase18State.venues:[];
        const perps=venues.filter(v=>v?.venueType==="perp");
        const healthy=perps.filter(v=>v?.status==="healthy"&&Number.isFinite(Number(v?.price)));
        const spreads=healthy.map(v=>Number(v?.spreadBps)).filter(Number.isFinite);
        const ages=venues.map(v=>Number(v?.sourceTs)).filter(Number.isFinite).map(ts=>Math.max(0,now-ts));
        return {
          reliabilityPct:perps.length?healthy.length/perps.length*100:0,
          spreadBps:spreads.length?Math.max(...spreads):null,
          dataLagMs:ages.length?Math.max(...ages):null,
          outage:perps.length===0,
          source:"PHASE18_MARKET_STATE"
        };
      })(),
      portfolio:{
        positions:Array.isArray(phase6State?.portfolio?.positions)?phase6State.portfolio.positions:[],
        orders:Array.isArray(phase6State?.portfolio?.orders)?phase6State.portfolio.orders:[],
        totalRiskPct:Number(phase6State?.portfolio?.grossRiskPct||0)
      },
      checklist:{
        side:finalDecision?.action,
        trigger:finalDecision?.evidence?.trigger||finalDecision?.deploymentGate?.reason,
        entry:conditionalLevels?.entry??conditionalLevels?.entryLow,
        invalidation:conditionalLevels?.stop,target:conditionalLevels?.tp1,
        risk:finalDecision?.risk?.riskPct,venue:"USER_SELECTED_EXCHANGE",
        cancelIf:phaseStackState?.hardBlockers?.join(", ")||"ANY HARD BLOCKER"
      },
      calibration:{probability:empiricalWinRate,source:empiricalWinRate!=null?"WALK_FORWARD_EMPIRICAL":"UNAVAILABLE"},
      uncertainty:{coveragePct:phaseStackState?.data?.quality?.score||0,calibrationSamples:Number(validation1113?.summary?.trades||validation1113?.directional?.long?.trades||0),disagreementPct:0},
      expectancy:{winProbability:empiricalWinRate!=null?empiricalWinRate/100:null,averageWinR:Number(conditionalLevels?.rr)||1.5,averageLossR:1,costR:0.05},
      expectancyGate:{probability:empiricalWinRate!=null?empiricalWinRate/100:null,rr:Number(conditionalLevels?.rr)||0,costBps:10}
    });
    const phase101to200State=phase101to200.evaluate({
      symbol,interval,now,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      candles,
      decision:{...finalDecision,derivatives:flow},
      market:finalDecision?.market||{},analysis,derivatives:flow,consensus,
      candidateAction:signalCandidate?.side||finalDecision?.action||"WAIT",
      mtf:{higher:String(finalDecision?.higher?.side||finalDecision?.higherTimeframe?.side||analysis?.higher?.side||"WAIT").toUpperCase(),execution:String(signalCandidate?.side||finalDecision?.action||"WAIT").toUpperCase(),lower:String(analysis?.lower?.side||analysis?.lowerTimeframe?.side||signalCandidate?.side||finalDecision?.action||"WAIT").toUpperCase()},
      phase51to100:phase51to100State,validation:validation1113||analytics?.validation||null,
      calibration:{probability:empiricalWinRate??null,source:empiricalWinRate!=null?"WALK_FORWARD_EMPIRICAL":"UNAVAILABLE"},
      freshnessPct:phaseStackState?.data?.quality?.score??100,stale:Boolean(finalDecision?.stale),risk:finalDecision?.risk||{},marketSource:flow?.provider||"MARKET_FEED"
    });
    const phase201to300State=phase201to300.evaluate({
      symbol,interval,now,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      candles,
      decision:{
        ...finalDecision,
        // Preserve the computed directional candidate even when the previous
        // validation gate intentionally presents the public action as WAIT.
        action:signalCandidate.side!=="WAIT"?signalCandidate.side:finalDecision.action,
        levels:finalDecision.levels?.entry!=null
          ?finalDecision.levels
          :(finalDecision.conditionalLevels||finalDecision.levels||{})
      },
      analysis,derivatives:flow,consensus,
      mtf:{higher:String(finalDecision?.higher?.side||finalDecision?.higherTimeframe?.side||analysis?.higher?.side||"WAIT").toUpperCase(),lower:String(analysis?.lower?.side||analysis?.lowerTimeframe?.side||signalCandidate.side||finalDecision?.action||"WAIT").toUpperCase()},
      phase101to200:phase101to200State,
      baselineAction:String(
        signalCandidate.side!=="WAIT"?signalCandidate.side:
        earlyCandidate?.side!=="WAIT"?earlyCandidate.side:
        phase101to200State?.aggregation?.direction!=="WAIT"?phase101to200State?.aggregation?.direction:
        (finalDecision?.action||phase101to200State?.gate?.action||"WAIT")
      ).toUpperCase(),
      baselineEligible:Boolean(phase101to200State?.gate?.action!=="WAIT"&&["LONG","SHORT"].includes(String(signalCandidate?.side||"").toUpperCase())),
      freshnessPct:phaseStackState?.data?.quality?.score??100,
      validation:validation1113||analytics?.validation||null,
      minimumSamples:80,
      hardBlockers:phase101to200State?.gate?.blockers||[]
    });
    if(phase201to300State?.gate?.status!=="LIVE_SIGNAL_READY"&&["LONG","SHORT"].includes(String(finalDecision?.action||"").toUpperCase())){
      finalDecision={...sanitizeFinalDecision(finalDecision),action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
        market:{...(finalDecision.market||{}),side:"WAIT",status:"WAITING",type:"PROFITABILITY GATE BLOCK",bias:"Neutral",directionalLean:"NEUTRAL",probabilityLabel:"POSITIVE EXPECTED VALUE NOT VALIDATED"},
        levels:{...(finalDecision.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        deploymentGate:{...(finalDecision.deploymentGate||{}),state:"BLOCKED",reason:(phase201to300State.gate.blockers||[]).join(", ")||"Profitability engine blocked the directional candidate."},
        operational:{...(finalDecision.operational||{}),liveUse:"PAPER_ONLY"},phase201to300Blocked:true};
    }else if(phase201to300State?.gate?.status==="LIVE_SIGNAL_READY"){
      const restoredSide=["LONG","SHORT"].includes(String(phase201to300State?.gate?.action||"").toUpperCase())
        ?String(phase201to300State.gate.action).toUpperCase():signalCandidate.side;
      const restoredLevels=(finalDecision.levels&&finalDecision.levels.entry!=null)
        ?finalDecision.levels:(finalDecision.conditionalLevels||finalDecision.levels||{});
      finalDecision={
        ...finalDecision,
        action:restoredSide,
        rawAction:restoredSide,
        state:"READY",
        liveSignalEligible:true,
        levels:restoredLevels,
        market:{...(finalDecision.market||{}),side:restoredSide,status:"READY",type:finalDecision.market?.type||"QUALIFIED SETUP"},
        deploymentGate:{...(finalDecision.deploymentGate||{}),state:"LIVE_SIGNAL_READY",reason:"Validated positive expected-value gate passed; manual execution remains required.",candidateAction:restoredSide},
        operational:{...(finalDecision.operational||{}),liveUse:"LIVE_SIGNAL"},
        phase201to300SignalReady:true
      };
    }
    const phase301to400State=phase301to400.evaluate({
      symbol,interval,now,
      price:Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c),
      candles,decision:finalDecision,analysis,derivatives:flow,consensus,
      mtf:{higher:String(finalDecision?.higher?.side||finalDecision?.higherTimeframe?.side||analysis?.higher?.side||"WAIT").toUpperCase(),execution:String(finalDecision?.action||"WAIT").toUpperCase(),lower:String(analysis?.lower?.side||analysis?.lowerTimeframe?.side||finalDecision?.action||"WAIT").toUpperCase()},
      phase201to300:phase201to300State,baselineAction:String(finalDecision?.action||"WAIT").toUpperCase(),
      learningObservations:analytics?.validation?.recent||[]
    });
    if(phase301to400State?.failureIntelligence?.emergencyWait&&["LONG","SHORT"].includes(String(finalDecision?.action||"").toUpperCase())){
      finalDecision={...sanitizeFinalDecision(finalDecision),action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,
        market:{...(finalDecision.market||{}),side:"WAIT",status:"WAITING",type:"ADAPTIVE INTELLIGENCE BLOCK",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(finalDecision.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        deploymentGate:{...(finalDecision.deploymentGate||{}),state:"BLOCKED",reason:(phase301to400State.gate.blockers||[]).join(", ")||"Adaptive intelligence detected a material thesis failure."},
        operational:{...(finalDecision.operational||{}),liveUse:"PAPER_ONLY"},phase301to400Blocked:true};
    }
    // Phase 401–500 is the final canonical integrity gate for the normal
    // decision path as well as the execution path. Build it from the exact same
    // live price/flow snapshot that powers the dashboard so READY cannot drift
    // from the visible market state.
    const phase401CanonicalPrice=Number.isFinite(Number(liveSeed.lastPrice))
      ?Number(liveSeed.lastPrice)
      :(Number.isFinite(Number(liveSeed.markPrice))
        ?Number(liveSeed.markPrice)
        :Number(finalDecision?.market?.price??analysis?.price??candles?.at(-1)?.c));
    const phase401CanonicalTs=Number.isFinite(Number(liveSeed.lastTs))&&Number(liveSeed.lastTs)>0
      ?Number(liveSeed.lastTs):Number(candles?.at(-1)?.t||now);
    const phase401Decision={
      ...finalDecision,
      livePrice:phase401CanonicalPrice,
      livePriceTs:phase401CanonicalTs,
      market:{
        ...(finalDecision.market||{}),
        livePrice:phase401CanonicalPrice,
        marketSyncTs:phase401CanonicalTs,
        liveSource:"BYBIT_CANONICAL"
      },
      derivatives:flow
    };
    let phase401State=phase401to500.buildState({
      symbol,
      interval,
      price:phase401CanonicalPrice,
      updatedAt:now,
      dataTs:phase401CanonicalTs,
      liveSeq:liveSeed.liveSeq||0,
      markPrice:liveSeed.markPrice,
      candles,
      decision:phase401Decision,
      radar:{
        side:String(finalDecision?.action||"WAIT").toUpperCase(),
        score:finalDecision?.market?.confluenceScore,
        rr:finalDecision?.levels?.rr,
        price:phase401CanonicalPrice
      },
      marketState:{
        price:phase401CanonicalPrice,
        markPrice:liveSeed.markPrice,
        orderBook:liveSeed.orderBook||flow.orderBook||null,
        flow
      },
      ticker:{
        price:phase401CanonicalPrice,
        markPrice:liveSeed.markPrice,
        change24h:liveSeed.price24hPcnt
      },
      execution:{
        mode:"PAPER",
        armed:false,
        killSwitch:false,
        reconciliation:{ok:true}
      }
    });

    // A canonical mismatch is a hard stop. Re-run the apex state after
    // demoting the decision so every surface reports the same WAIT state.
    if(
      phase401State.executionGate.status!=="ELIGIBLE" &&
      ["LONG","SHORT"].includes(String(finalDecision?.action||"").toUpperCase()) &&
      finalDecision?.liveSignalEligible===true
    ){
      finalDecision={
        ...sanitizeFinalDecision(finalDecision),
        action:"WAIT",
        state:"NO_TRADE",
        liveSignalEligible:false,
        rawAction:String(finalDecision.action).toUpperCase(),
        market:{
          ...(finalDecision.market||{}),
          side:"WAIT",
          status:"WAITING",
          type:"CANONICAL INTEGRITY BLOCK",
          bias:"Neutral",
          directionalLean:"NEUTRAL",
          probabilityLabel:"CANONICAL DATA MUST ALIGN"
        },
        levels:{
          ...(finalDecision.levels||{}),
          side:"WAIT",
          entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null,
          riskDistance:null,target1Distance:null
        },
        deploymentGate:{
          ...(finalDecision.deploymentGate||{}),
          state:"BLOCKED",
          reason:(phase401State.executionGate.reasons||[]).join(", ")||"Phase 401–500 canonical integrity gate blocked the signal."
        },
        operational:{...(finalDecision.operational||{}),liveUse:"PAPER_ONLY"},
        phase401Blocked:true
      };
      phase401State=phase401to500.buildState({
        symbol,
        interval,
        price:phase401CanonicalPrice,
        updatedAt:now,
        dataTs:phase401CanonicalTs,
        liveSeq:liveSeed.liveSeq||0,
        markPrice:liveSeed.markPrice,
        candles,
        decision:{
          ...finalDecision,
          livePrice:phase401CanonicalPrice,
          livePriceTs:phase401CanonicalTs,
          market:{...(finalDecision.market||{}),livePrice:phase401CanonicalPrice,marketSyncTs:phase401CanonicalTs},
          derivatives:flow
        },
        radar:{side:"WAIT",score:finalDecision?.market?.confluenceScore,rr:null,price:phase401CanonicalPrice},
        marketState:{price:phase401CanonicalPrice,markPrice:liveSeed.markPrice,orderBook:liveSeed.orderBook||flow.orderBook||null,flow},
        ticker:{price:phase401CanonicalPrice,markPrice:liveSeed.markPrice,change24h:liveSeed.price24hPcnt},
        execution:{mode:"PAPER",armed:false,killSwitch:false,reconciliation:{ok:true}}
      });
    }
    const signalGateChain={
      candidate:{side:signalCandidate?.side||"WAIT",earlySide:earlyCandidate?.side||"WAIT",source:signalCandidate?.source||earlyCandidate?.source||"NONE"},
      phase9to10:{action:String(gatedDecision?.action||"WAIT").toUpperCase(),state:gatedDecision?.state||"WAIT",gate:gatedDecision?.deploymentGate?.state||"UNKNOWN",reason:gatedDecision?.reason||null},
      phase11to13:{ready:Boolean(validation1113?.adaptive?.signalGateReady),mode:validation1113?.adaptive?.mode||"WARMING",reasons:Array.isArray(validation1113?.adaptive?.reasons)?validation1113.adaptive.reasons:[],summaryTrades:Number(validation1113?.summary?.trades||0),directionalLong:Number(validation1113?.directional?.long?.trades||0),directionalShort:Number(validation1113?.directional?.short?.trades||0)},
      phase51to100:{qualified:Boolean(phase51to100State?.gate?.qualified),action:phase51to100State?.signal?.action||"WAIT",blockers:Array.isArray(phase51to100State?.gate?.blockers)?phase51to100State.gate.blockers:[]},
      phase101to200:{qualified:Boolean(phase101to200State?.gate?.action&&phase101to200State.gate.action!=="WAIT"),action:phase101to200State?.gate?.action||"WAIT",blockers:Array.isArray(phase101to200State?.gate?.blockers)?phase101to200State.gate.blockers:[]},
      phase201to300:{ready:Boolean(phase201to300State?.gate?.status==="LIVE_SIGNAL_READY"),action:phase201to300State?.gate?.action||"WAIT",blockers:Array.isArray(phase201to300State?.gate?.blockers)?phase201to300State.gate.blockers:[]},
      phase301to400:{action:phase301to400State?.gate?.action||"WAIT",blockers:Array.isArray(phase301to400State?.gate?.blockers)?phase301to400State.gate.blockers:[]},
      phase401to500:{eligible:Boolean(phase401State?.executionGate?.status==="ELIGIBLE"),reasons:Array.isArray(phase401State?.executionGate?.reasons)?phase401State.executionGate.reasons:[]}
    };
    const resolvedCandidate=(()=>{
      const candidates=[
        signalCandidate?.side,
        earlyCandidate?.side,
        phase201to300State?.gate?.action,
        phase301to400State?.gate?.action,
        phase301to400State?.council?.action,
        phase101to200State?.aggregation?.direction,
        phase101to200State?.baseline?.action,
        analysis?.side,
        analysis?.marketStructure?.setup?.side,
        finalDecision?.action
      ];
      const side=candidates.map(v=>String(v||"").toUpperCase()).find(v=>v==="LONG"||v==="SHORT")||"WAIT";
      const score=Number.isFinite(Number(finalDecision?.market?.confluenceScore))
        ?Number(finalDecision.market.confluenceScore)
        :Number.isFinite(Number(phase301to400State?.gate?.quality))
          ?Number(phase301to400State.gate.quality*100)
          :Number.isFinite(Number(phase101to200State?.aggregation?.edge))
            ?Number(phase101to200State.aggregation.edge)
            :null;
      const source=candidates.map(v=>String(v||"").toUpperCase()).find(v=>v==="LONG"||v==="SHORT")||"WAIT";
      return {side,score,source,watchOnly:side!=="WAIT"&&String(finalDecision?.action||"WAIT").toUpperCase()==="WAIT"};
    })();
        try{
      setTimeout(()=>signalNotifications.notifyAdminSignal(storage,{
        decision:finalDecision,
        symbol,
        interval,
        candleTs:candles?.[candles.length-1]?.t||null
      }).catch(()=>{}),0);
      setTimeout(()=>signalNotifications.notifyAdminOpportunity(storage,{
        decision:finalDecision,
        symbol,
        interval,
        candleTs:candles?.[candles.length-1]?.t||null
      }).catch(()=>{}),0);
    }catch{}

    try{
      const candleTs=candles?.[candles.length-1]?.t;
      if(Number.isFinite(Number(candleTs)))setTimeout(()=>phase15.recordDecision({
        symbol,interval,candleTs:Number(candleTs),decision:finalDecision,analysis
      }).catch(()=>{}),0);
    }catch{}

    try{
      const autoEnabled=false;
      if(autoEnabled&&finalDecision?.liveSignalEligible&&finalDecision?.state==="READY"&&["LONG","SHORT"].includes(String(finalDecision?.action||"").toUpperCase())){
        const signal={
          id:["LIVE_AUTO",symbol,interval,candles?.[candles.length-1]?.t,finalDecision.action].join("|"),
          symbol,interval,side:String(finalDecision.action).toUpperCase(),status:"READY",score:finalDecision.market?.confluenceScore||0,
          entry:finalDecision.levels?.entry,stop:finalDecision.levels?.stop,target:finalDecision.levels?.tp1,tp2:finalDecision.levels?.tp2,
          rr:finalDecision.levels?.rr,type:finalDecision.market?.type,regime:finalDecision.market?.regime,tradeStyle:finalDecision.tradeStyle
        };
        setTimeout(()=>execution.autoSubmitFinalDecision(signal).catch(()=>{}),0);
      }
    }catch{}
    try{phase4.updateFinalDecision(deviceId||"00000000-0000-0000-0000-000000000000",symbol,interval,finalDecision,candles).catch(()=>{})}catch{}
    try{learning.observeFinalDecision(symbol,interval,candles,finalDecision).catch(()=>{})}catch{}
    try{setTimeout(()=>phase14.refreshAdaptiveState(storage,{symbol,interval}).catch(()=>{}),250)}catch{}
    const payload={
      ok:true,...finalDecision,analysis,derivatives:flow,consensus,decisionIntelligence,phase20:phase20Scenario,canonicalState,canonicalSnapshotId,phaseStack:phaseStackState,phase51to100:phase51to100State,
      learning:null,
      signalCandidate:resolvedCandidate,
      signalCandidateRaw:signalCandidate,
      earlyCandidate,
      signalGateChain:
      decisionDiagnostics,
      backtest:analytics?.backtest||null,validation:analytics?.validation||null,setupStats:analytics?.setupStats||null,
      phase11_13:validation1113,
      validationStatus:{ready:validationReady,pending:!validationReady,source:validation1113?"P11-13_WALK_FORWARD":"WARMING",sampleCount:Number(validation1113?.summary?.trades||0),minimumSamples:80},
      phase14:finalDecision.phase14||analysis.phase14||null,
      phase14Status:finalDecision.phase14?.adaptive||analysis.phase14?.adaptive||null,
      phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,phase14Version:"14.0.0",phase20Version:phase20.VERSION,phase21Version:phase21.VERSION,phase21to50Version:phaseStack.VERSION,phase51to100Version:phase51to100.VERSION,phase51to100:phase51to100State,phase101to200Version:phase101to200.VERSION,phase101to200:phase101to200State,phase201to300Version:phase201to300.VERSION,phase201to300:phase201to300State,phase301to400Version:phase301to400.VERSION,phase301to400:phase301to400State,
      phase401to500Version:phase401to500.VERSION,
      phase401to500:phase401State,
      canonicalExecutionIntegrity:phase401State.executionGate,
      canonicalLiveFrame:phase401State.canonical,
      decisionSnapshot:{
        id:canonicalSnapshotId,
        generatedAt:now,
        candleTs:Number(candles?.at(-1)?.t||0),
        liveDataTs:phase401CanonicalTs,
        liveSeq:Number(liveSeed.liveSeq||0),
        canonicalPrice:phase401CanonicalPrice,
        canonicalFrameHash:phase401State?.canonical?.hash||null,
        source:"BYBIT_CANONICAL"
      },
      updatedAt:now
    };
    DECISION_CACHE.set(key,{ts:now,payload});
    DECISION_LAST_GOOD.set(key,{ts:now,payload});
    return Object.assign({cache:"fresh",cacheAgeMs:0},payload);
  }catch(e){
    const last=DECISION_LAST_GOOD.get(key);
    if(last){
      const safeStale={
        ...last.payload,
        stale:true,
        action:"WAIT",
        state:"NO_TRADE",
        liveSignalEligible:false,
        market:{...(last.payload.market||{}),side:"WAIT",status:"WAITING",type:"STALE DATA / NO TRADE",bias:"Neutral",directionalLean:"NEUTRAL"},
        levels:{...(last.payload.levels||{}),entryLow:null,entryHigh:null,entry:null,stop:null,tp1:null,tp2:null,rr:null},
        deploymentGate:{...(last.payload.deploymentGate||{}),state:"BLOCKED",reason:"Decision refresh failed; stale directional data is not eligible for a live signal."},
        operational:{...(last.payload.operational||{}),liveUse:"PAPER_ONLY"},
        signalStability:{state:"STALE",side:last.payload?.signalCandidate?.side||last.payload?.rawAction||null,reason:"stale_decision"},
        signalCandidate:{...(last.payload?.signalCandidate||{}),stale:true,staleAgeMs:Math.max(0,now-last.ts),staleReason:String(e.message||"DECISION_REFRESH_FAILED")}
      };
      return Object.assign({cache:"stale",stale:true,cacheAgeMs:Math.max(0,now-last.ts),degraded:String(e.message||e)},safeStale);
    }
    throw e;
  }
}

function authKey(ip,email,type){return type+":"+String(ip||"unknown")+":"+String(email||"").toLowerCase()}
function requestDevice(req){return String(req.headers["x-marketpulse-device"]||"00000000-0000-0000-0000-000000000000").slice(0,128)}

function mins(interval){return ({'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440})[interval]||60}
function closedCandles(rows,interval,now=Date.now()){
  const ms=mins(interval)*60*1000;
  return (Array.isArray(rows)?rows:[]).filter(x=>Number.isFinite(Number(x?.t))&&Number(x.t)+ms<=now-1000);
}
async function getBinance(symbol,interval,timeoutMs=DATA_TIMEOUT_MS){
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com'];
  const requests=bases.map(async base=>{const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(KLINE_LIMIT,1000)));const r=await fetch(u,{signal:timeoutSignal(timeoutMs)});if(!r.ok)throw Error('HTTP '+r.status);const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}))});
  try{return await Promise.any(requests)}catch{return null}
}
async function getKraken(symbol,interval,timeoutMs=DATA_TIMEOUT_MS){
  const pair=KRAKEN_PAIRS[symbol]; if(!pair)throw new Error('No Kraken mapping for '+symbol);
  const u=new URL('https://api.kraken.com/0/public/OHLC');u.searchParams.set('pair',pair);u.searchParams.set('interval',String(mins(interval)));
  const r=await fetch(u,{signal:timeoutSignal(timeoutMs)});if(!r.ok)throw new Error('Kraken returned '+r.status);const body=await r.json();if(body.error?.length)throw new Error(body.error.join(', '));
  const key=Object.keys(body.result||{}).find(k=>k!=='last');if(!key)throw new Error('Kraken returned no OHLC data');
  return (body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720)).map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:'kraken'}));
}
async function getBybitKlines(symbol,interval,timeoutMs=2200){
  const bybitIntervalMap={"15m":"15","30m":"30","1h":"60","4h":"240","8h":"480","1d":"D"};
  const iv=bybitIntervalMap[interval]||"60";
  const hosts=["https://api.bybit.com","https://api.bytick.com"];
  let lastErr=null;
  for(const host of hosts){
    try{
      const u=new URL(host+"/v5/market/kline");
      u.searchParams.set("category","linear");
      u.searchParams.set("symbol",symbol);
      u.searchParams.set("interval",iv);
      u.searchParams.set("limit",String(Math.min(KLINE_LIMIT,1000)));
      const j=await fetchJson(u.toString(),timeoutMs);
      if(Number(j?.retCode)!==0)throw Error(j?.retMsg||("Bybit error "+j?.retCode));
      const rows=Array.isArray(j?.result?.list)?j.result.list.slice().reverse():[];
      const mapped=rows.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:"bybit"})).filter(x=>[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
      if(mapped.length<220)throw Error("Bybit returned insufficient candles");
      return mapped;
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error("Bybit kline request failed");
}
async function getFastKlines(symbol,interval){
  const key="FAST|"+symbol+"|"+interval,hit=CACHE.get(key);
  if(hit&&Date.now()-hit.ts<20000)return hit.rows;
  const providers=[
    ["bybit",()=>getBybitKlines(symbol,interval,2200)],
    ["kraken",()=>getKraken(symbol,interval,2600)],
    ["binance",()=>getBinance(symbol,interval,1900)]
  ];
  try{
    const rows=await Promise.any(providers.map(([,fn])=>Promise.resolve().then(fn).then(rows=>{
      if(!Array.isArray(rows)||rows.length<220)throw Error("Provider returned insufficient candles");
      return rows;
    })));
    CACHE.set(key,{ts:Date.now(),rows});
    return rows;
  }catch{
    if(hit?.rows)return hit.rows;
    throw Error("No fast market data source available");
  }
}
async function klines(symbol,interval){
  const key=symbol+'|'+interval,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL)return hit.rows;
  const rows=await getFastKlines(symbol,interval)||await getBinance(symbol,interval)||await getKraken(symbol,interval);CACHE.set(key,{ts:Date.now(),rows});return rows;
}
async function longDailyHistory(symbol,days=4200){
  const key="LONG|"+symbol,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL*4)return hit.rows;
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
  for(const base of bases){
    try{
      let endTime=Date.now(),all=[];
      while(all.length<days){
        const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval','1d');u.searchParams.set('limit','1000');u.searchParams.set('endTime',String(endTime));
        const r=await fetch(u,{headers:{Accept:'application/json'},signal:timeoutSignal(5000)});if(!r.ok)throw Error('HTTP '+r.status);
        const rows=await r.json();if(!rows.length)break;
        const mapped=rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}));
        all=mapped.concat(all);endTime=rows[0][0]-1;if(rows.length<1000)break;
      }
      all=all.slice(-days);if(all.length){CACHE.set(key,{ts:Date.now(),rows:all});return all}
    }catch{}
  }
  const fallback=await klines(symbol,'1d').catch(()=>[]);return fallback;
}

const LIVE_FLOW=new Map();
const LIVE_FLOW_LIMIT=900;
const LIVE_SYMBOLS=SYMBOLS.filter(s=>["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"].includes(s));
async function directPublicTicker(symbol){
  const coin=String(labels[symbol]||symbol).replace('USDT','').toUpperCase();
  const jobs=[];
  jobs.push(async()=>{
    const u=new URL('https://api.binance.com/api/v3/ticker/24hr');
    u.searchParams.set('symbol',symbol);
    const r=await fetch(u,{signal:timeoutSignal(2500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Binance ticker HTTP '+r.status);
    const x=await r.json();
    const price=Number(x?.lastPrice);
    if(!Number.isFinite(price))throw Error('Binance ticker missing price');
    return {price,change24h:Number(x?.priceChangePercent),source:'Binance public ticker',updatedAt:Date.now()};
  });
  jobs.push(async()=>{
    const u=new URL('https://api.bybit.com/v5/market/tickers');
    u.searchParams.set('category','linear');u.searchParams.set('symbol',symbol);
    const r=await fetch(u,{signal:timeoutSignal(2500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Bybit ticker HTTP '+r.status);
    const x=await r.json(),row=x?.result?.list?.[0],price=Number(row?.lastPrice);
    if(Number(x?.retCode||0)!==0||!Number.isFinite(price))throw Error('Bybit ticker missing price');
    return {price,change24h:Number(row?.price24hPcnt),source:'Bybit public ticker',updatedAt:Date.now()};
  });
  jobs.push(async()=>{
    const u=new URL('https://api.coinbase.com/v2/prices/'+coin+'-USD/spot');
    const r=await fetch(u,{signal:timeoutSignal(2500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Coinbase ticker HTTP '+r.status);
    const x=await r.json(),price=Number(x?.data?.amount);
    if(!Number.isFinite(price))throw Error('Coinbase ticker missing price');
    return {price,change24h:null,source:'Coinbase spot ticker',updatedAt:Date.now()};
  });
  const pair=KRAKEN_PAIRS[symbol];
  if(pair)jobs.push(async()=>{
    const u=new URL('https://api.kraken.com/0/public/Ticker');
    u.searchParams.set('pair',pair);
    const r=await fetch(u,{signal:timeoutSignal(2500),headers:{accept:'application/json'}});
    if(!r.ok)throw Error('Kraken ticker HTTP '+r.status);
    const x=await r.json(),row=x?.result&&x.result[Object.keys(x.result)[0]],price=Number(row?.c?.[0]);
    if(!Number.isFinite(price))throw Error('Kraken ticker missing price');
    return {price,change24h:null,source:'Kraken public ticker',updatedAt:Date.now()};
  });
  return Promise.any(jobs.map(fn=>Promise.resolve().then(fn).then(v=>{
    if(!v||!Number.isFinite(Number(v.price)))throw Error('Invalid ticker');
    return {...v,price:Number(v.price)};
  })));
}

function flowBucket(symbol){
  let v=LIVE_FLOW.get(symbol);
  if(!v){
    v={
      liqLong:0,liqShort:0,cvd:0,cvdNotional:0,lastTs:0,lastPrice:null,
      price24hPcnt:null,oi:null,fundingRate:null,markPrice:null,orderBook:null,
      points:[],liveSeq:0,wsConnected:false
    };
    LIVE_FLOW.set(symbol,v)
  }
  return v;
}
function recordFlowPoint(symbol){
  const v=flowBucket(symbol),now=Date.now();
  if(v.lastPointAt&&now-v.lastPointAt<1000)return;
  v.lastPointAt=now;
  v.points.push({ts:now,liqLong:v.liqLong,liqShort:v.liqShort,liqTotal:v.liqLong+v.liqShort,cvd:v.cvd,cvdRatio:v.cvdNotional?v.cvd/v.cvdNotional:null,oi:v.oi,fundingRate:v.fundingRate,markPrice:v.markPrice,lastPrice:v.lastPrice,price24hPcnt:v.price24hPcnt,orderBook:v.orderBook});
  if(v.points.length>LIVE_FLOW_LIMIT)v.points.shift();
}
function startBybitLiveFlow(){
  if(!LIVE_SYMBOLS.length)return;
  let stopped=false,ws=null,retry=1000,timer=null,heartbeat=null,hostIndex=0;
  const hosts=String(process.env.BYBIT_WS_HOSTS||[
    "wss://stream.bybit.com/v5/public/linear",
    "wss://stream.bybit.tr/v5/public/linear",
    "wss://stream.bybit.id/v5/public/linear",
    "wss://stream.bybit.kz/v5/public/linear",
    "wss://stream.bybitgeorgia.ge/v5/public/linear",
    "wss://stream.manepa.jp/v5/public/linear"
  ].join(",")).split(",").map(s=>s.trim()).filter(Boolean);
  const connect=()=>{
    if(stopped)return;
    const url=hosts[hostIndex%hosts.length]||hosts[0]; hostIndex++;
    try{ws=new WebSocket(url)}catch{retry=Math.min(retry*2,30000);timer=setTimeout(connect,retry);return}
    ws.on("open",()=>{
      retry=1000;
      const now=Date.now();
      for(const sym of LIVE_SYMBOLS){
        const v=flowBucket(sym);
        v.wsConnected=true;v.wsHost=url;v.wsConnectedAt=now;v.wsReconnects=Number(v.wsReconnects||0)+1;
      }
      ws.send(JSON.stringify({op:"subscribe",args:LIVE_SYMBOLS.flatMap(sym=>["allLiquidation."+sym,"publicTrade."+sym,"tickers."+sym,"orderbook.50."+sym])}));
      clearInterval(heartbeat);
      heartbeat=setInterval(()=>{try{ws&&ws.readyState===1&&ws.send(JSON.stringify({op:"ping",req_id:String(Date.now())}))}catch{}},20000);
    });
    ws.on("message",raw=>{
      try{
        const msg=JSON.parse(raw.toString()),topic=String(msg.topic||""),data=Array.isArray(msg.data)?msg.data:[msg.data];
        if(!topic||!data.length)return;
        const symbol=topic.split(".")[1];if(!LIVE_FLOW.has(symbol))return;const v=flowBucket(symbol);
        if(topic.startsWith("allLiquidation.")){
          for(const x of data){
            const q=Number(x.v)*Number(x.p);if(!Number.isFinite(q)||q<=0)continue;
            if(x.S==="Buy")v.liqLong+=q;else if(x.S==="Sell")v.liqShort+=q;
            v.lastTs=Number(x.T)||Date.now();
          }
        }else if(topic.startsWith("publicTrade.")){
          for(const x of data){
            const q=Number(x.v)*Number(x.p);if(!Number.isFinite(q)||q<=0)continue;
            v.cvd+=(x.S==="Buy"?q:-q);v.cvdNotional+=q;v.lastTs=Number(x.T)||Date.now();
          }
        }else if(topic.startsWith("tickers.")){
          const x=data[0]||{};
          if(Number.isFinite(+x.lastPrice))v.lastPrice=+x.lastPrice;
          if(Number.isFinite(+x.price24hPcnt))v.price24hPcnt=+x.price24hPcnt*100;
          if(Number.isFinite(+x.openInterest))v.oi=+x.openInterest;
          if(Number.isFinite(+x.fundingRate))v.fundingRate=normalizeFundingRate(x.fundingRate);
          if(Number.isFinite(+x.markPrice))v.markPrice=+x.markPrice;
          v.lastTs=Number(msg.ts)||Date.now();
        }else if(topic.startsWith("orderbook.50.")){
          const x=data[0]||{},bids=Array.isArray(x.b)?x.b:[],asks=Array.isArray(x.a)?x.a:[];
          const bidQty=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
          const askQty=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
          const bidDepth=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
          const askDepth=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
          const bid=Number(bids[0]?.[0]),ask=Number(asks[0]?.[0]);
          const mid=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null;
          const micro=mid&&bidQty+askQty>0?((ask*bidQty)+(bid*askQty))/(bidQty+askQty):null;
          v.orderBook={
            imbalance:(bidQty+askQty)>0?(bidQty-askQty)/(bidQty+askQty):null,
            micropriceBias:mid&&Number.isFinite(micro)?(micro-mid)/mid:null,
            spreadBps:mid&&Number.isFinite(ask)&&Number.isFinite(bid)?((ask-bid)/mid)*10000:null,
            depthNotional:bidDepth+askDepth,bidDepth,askDepth,ts:Date.now()
          };
          v.lastTs=Number(msg.ts)||Date.now();
        }
        v.liveSeq = Number(v.liveSeq||0)+1;
        v.lastEventAt = Date.now();
        recordFlowPoint(symbol);
        scheduleLiveSyncBroadcast(symbol);
      }catch{}
    });
    ws.on("close",()=>{
      clearInterval(heartbeat);
      LIVE_SYMBOLS.forEach(sym=>{const v=flowBucket(sym);v.wsConnected=false;v.wsLastDisconnectAt=Date.now()});
      if(!stopped){clearTimeout(timer);timer=setTimeout(connect,retry);retry=Math.min(retry*2,30000)}
    });
    ws.on("error",()=>{try{ws.close()}catch{}});
  };
  connect();
  process.on("SIGTERM",()=>{stopped=true;clearTimeout(timer);clearInterval(heartbeat);try{ws?.close()}catch{}});
}
startBybitLiveFlow();

function liveSyncSnapshot(symbol){
  const v=flowBucket(symbol), now=Date.now();
  // Exchange-style visible price must follow the last traded price.
  // Mark price remains available separately for derivatives/risk calculations.
  const price=Number.isFinite(Number(v.lastPrice))?Number(v.lastPrice):
    (Number.isFinite(Number(v.markPrice))?Number(v.markPrice):null);
  const dataTs=Number.isFinite(Number(v.lastTs))&&Number(v.lastTs)>0?Number(v.lastTs):null;
  const dataAgeMs=dataTs!==null?Math.max(0,now-dataTs):null;
  const cvdRatio=Number.isFinite(Number(v.cvdRatio))
    ?Number(v.cvdRatio)
    :(Number(v.cvdNotional)>0?Number(v.cvd)/Number(v.cvdNotional):null);
  const cvdState=Number.isFinite(cvdRatio)
    ?(cvdRatio>0.01?"BUYERS PRESSURE":cvdRatio<-0.01?"SELLERS PRESSURE":"BALANCED")
    :"WAITING";
  const liqLong=Number(v.liqLong)||0, liqShort=Number(v.liqShort)||0, liqTotal=liqLong+liqShort;
  const liquidationBias=liqTotal>0
    ?(liqLong>liqShort?"LONG LIQS DOMINANT":liqShort>liqLong?"SHORT LIQS DOMINANT":"LIQUIDATION ACTIVITY")
    :"NO LIQUIDATION ACTIVITY";
  return {
    ok:true,
    symbol,
    source:"SERVER_BYBIT_CANONICAL",
    seq:Number(v.liveSeq||0),
    liveConnected:Boolean(v.wsConnected),
    updatedAt:now,
    dataTs,
    dataAgeMs,
    price,
    lastPrice:Number.isFinite(Number(v.lastPrice))?Number(v.lastPrice):null,
    markPrice:Number.isFinite(Number(v.markPrice))?Number(v.markPrice):null,
    change24h:Number.isFinite(Number(v.price24hPcnt))?Number(v.price24hPcnt):null,
    oi:Number.isFinite(Number(v.oi))?Number(v.oi):null,
    fundingRate:Number.isFinite(Number(v.fundingRate))?Number(v.fundingRate):null,
    cvd:Number.isFinite(Number(v.cvd))?Number(v.cvd):null,
    cvdDelta:Number.isFinite(Number(v.cvd))?Number(v.cvd):null,
    cvdRatio,
    cvdState,
    longLiquidations:liqLong,
    shortLiquidations:liqShort,
    liquidationTotal:liqTotal,
    liquidationBias,
    orderBook:v.orderBook||null,
    takerImbalance:Number.isFinite(cvdRatio)?cvdRatio:null,
    positioning:Number.isFinite(Number(v.oi))?"OI LIVE":"WAITING",
    livePointCount:Array.isArray(v.points)?v.points.length:0,
    liveHistory:Array.isArray(v.points)?v.points.slice(-180):[]
  };
}

const DERIV_CACHE=new Map(); const DERIV_INFLIGHT=new Map(); const DERIV_TTL=15000;
const KRAKEN_FUTURES_PAIRS={BTCUSDT:"PF_XBTUSD",ETHUSDT:"PF_ETHUSD",SOLUSDT:"PF_SOLUSD",BNBUSDT:"PF_BNBUSD",XRPUSDT:"PF_XRPUSD",DOGEUSDT:"PF_DOGEUSD",ADAUSDT:"PF_ADAUSD"};
const BYBIT_HOSTS=["https://api.bybit.com","https://api.bytick.com"];
function bybitInterval(interval){return ({'15m':'15min','30m':'30min','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}

async function fetchJson(url,timeoutMs=4500){
  const controller=new AbortController();const t=setTimeout(()=>controller.abort(),timeoutMs);
  try{const r=await fetch(url,{signal:controller.signal,headers:{"User-Agent":"MarketPulse/2.0","Accept":"application/json"}});const raw=await r.text();let j={};try{j=JSON.parse(raw)}catch{}if(!r.ok)throw new Error("HTTP "+r.status);return j}
  finally{clearTimeout(t)}
}

async function bybitGet(path,params,timeoutMs=4500){
  let lastErr=new Error("Bybit request failed");
  for(const host of BYBIT_HOSTS){
    const u=new URL(host+path);for(const [k,v] of Object.entries(params||{}))u.searchParams.set(k,String(v));
    try{const j=await fetchJson(u,timeoutMs);if(j.retCode!==0)throw new Error(j.retMsg||("Bybit error "+j.retCode));return {result:j.result,host}}catch(e){lastErr=e}
  }
  throw lastErr;
}

async function krakenRecentCvd(symbol){
  const pair=KRAKEN_FUTURES_PAIRS[symbol];if(!pair)throw new Error("No Kraken futures trade mapping");
  const j=await fetchJson("https://futures.kraken.com/derivatives/api/v3/history?symbol="+encodeURIComponent(pair));
  const rows=(j.history||[]).slice().reverse();
  if(!rows.length)throw new Error("Kraken Futures history returned no trades");
  let cvd=0,total=0;
  for(const t of rows){
    const q=Number(t.notional_amount||Number(t.price||0)*Number(t.size||0));
    if(!Number.isFinite(q)||!q)continue;
    cvd+=(String(t.side).toLowerCase()==="buy"?q:-q);total+=q;
  }
  const first=Number(rows[0]?.price),last=Number(rows[rows.length-1]?.price);
  return {cvdDelta:cvd,cvdRatio:total?cvd/total:null,tradeCount:rows.length,tradePriceChangePct:Number.isFinite(first)&&first?((last-first)/first)*100:null};
}

async function krakenAnalytics(symbol,interval){
  const pair=KRAKEN_FUTURES_PAIRS[symbol];if(!pair)throw new Error("No Kraken futures mapping for "+symbol);
  const secs=mins(interval)*60;
  const windows={"15m":6*3600,"1h":24*3600,"4h":3*86400,"1d":7*86400};
  const since=Math.floor((Date.now()-(windows[interval]||24*3600))/1000);
  const base="https://futures.kraken.com/api/charts/v1/analytics/"+pair;
  const urls={cvd:base+"/cvd?since="+since+"&interval="+secs,oi:base+"/open-interest?since="+since+"&interval="+secs,funding:base+"/funding?since="+since+"&interval="+secs,ls:base+"/long-short-info?since="+since+"&interval="+secs,liq:base+"/liquidation-volume?since="+since+"&interval="+secs};
  const settled=await Promise.all(Object.entries(urls).map(async([key,url])=>{try{return{key,status:"fulfilled",value:await fetchJson(url,5000)}}catch(e){return{key,status:"rejected",reason:String(e.message||e)}}}));
  const byName=Object.fromEntries(settled.map(x=>[x.key,x]));
  const payload=key=>byName[key]?.status==="fulfilled"?(byName[key].value?.result||byName[key].value):null;
  const arraysFrom=(obj,names)=>{
    if(!obj)return[];const roots=[obj?.data,obj?.result?.data,obj?.result,obj];
    for(const root of roots){
      if(!root)continue;
      for(const name of names){const v=root?.[name];if(Array.isArray(v)){const out=v.map(x=>typeof x==="object"?Number(x.value??x.v??x[name]):Number(x)).filter(Number.isFinite);if(out.length)return out}}
      if(Array.isArray(root))for(const name of names){const out=root.map(x=>Number(x?.[name]??x?.value??x?.v)).filter(Number.isFinite);if(out.length)return out}
    }
    return[];
  };
  const cvdPayload=payload("cvd"),oiPayload=payload("oi"),fundingPayload=payload("funding"),lsPayload=payload("ls"),liqPayload=payload("liq");
  const cvdVals=arraysFrom(cvdPayload,["cvd","cumulativeVolumeDelta","cumulative_volume_delta"]);
  const buyVals=arraysFrom(cvdPayload,["buyVolume","buy_volume","buyNotional"]);
  const sellVals=arraysFrom(cvdPayload,["sellVolume","sell_volume","sellNotional"]);
  const oiVals=arraysFrom(oiPayload,["openInterest","open_interest","oi"]);
  const fundingVals=arraysFrom(fundingPayload,["rate","fundingRate","funding_rate"]);
  const longPct=arraysFrom(lsPayload,["longPercent","long_percent","long"]);
  const shortPct=arraysFrom(lsPayload,["shortPercent","short_percent","short"]);
  const ratioVals=arraysFrom(lsPayload,["ratio","longShortRatio","long_short_ratio"]);
  const liqTotalVals=arraysFrom(liqPayload,["liquidationVolume","liquidation_volume","volume","usdValue"]);
  const cvdFirst=cvdVals[0],cvdLast=cvdVals[cvdVals.length-1];
  let cvdDelta=Number.isFinite(cvdLast)&&Number.isFinite(cvdFirst)?cvdLast-cvdFirst:null;
  if(cvdDelta===null&&buyVals.length&&sellVals.length){const n=Math.min(buyVals.length,sellVals.length),buy=buyVals.slice(-n).reduce((a,b)=>a+b,0),sell=sellVals.slice(-n).reduce((a,b)=>a+b,0);cvdDelta=buy-sell}
  const oiFirst=oiVals[0],oiLast=oiVals[oiVals.length-1],oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((oiLast-oiFirst)/oiFirst)*100:null;
  const fundingRate=fundingVals.length?fundingVals[fundingVals.length-1]:null;
  const longLast=longPct.length?longPct[longPct.length-1]:null,shortLast=shortPct.length?shortPct[shortPct.length-1]:null,ratioLast=ratioVals.length?ratioVals[ratioVals.length-1]:null;
  const liquidationTotal=liqTotalVals.length?liqTotalVals.reduce((a,b)=>a+b,0):0;
  if(!Number.isFinite(oiLast)&&!Number.isFinite(cvdDelta)&&liqTotalVals.length===0&&!Number.isFinite(fundingRate)&&!Number.isFinite(longLast))throw new Error("Kraken Futures analytics returned no usable data");
  const cvdState=Number.isFinite(cvdDelta)?(cvdDelta>0?"BUYERS PRESSURE":cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):"UNAVAILABLE";
  let positioning="UNAVAILABLE";if(Number.isFinite(longLast)&&Number.isFinite(shortLast))positioning=longLast>shortLast+2?"LONG BIAS":shortLast>longLast+2?"SHORT BIAS":"BALANCED";else if(Number.isFinite(oiChangePct))positioning=oiChangePct>1?"OI RISING":oiChangePct<-1?"OI FALLING":"OI FLAT";
  const errors=settled.filter(x=>x.status==="rejected").map(x=>x.key+": "+x.reason),lengths=[cvdVals.length,oiVals.length,liqTotalVals.length].filter(Boolean);
  return{available:true,provider:"Kraken Futures public API",symbol:pair,oi:Number.isFinite(oiLast)?oiLast:null,oiChangePct,cvdDelta,cvdState,positioning,tradeCount:0,fundingRate:Number.isFinite(fundingRate)?fundingRate:null,markPrice:null,cvdRatio:null,longPercent:longLast,shortPercent:shortLast,longShortRatio:ratioLast,liquidationTotal,liquidationBias:liquidationTotal>0?"LIQUIDATION ACTIVITY":"NO LIQUIDATION ACTIVITY",analyticsBuckets:lengths.length?Math.max(...lengths):0,series:{cvd:cvdVals,oi:oiVals,liq:liqTotalVals},completeness:{oi:Number.isFinite(oiLast),cvd:Number.isFinite(cvdDelta),funding:Number.isFinite(fundingRate),positioning:Number.isFinite(longLast)&&Number.isFinite(shortLast),liquidations:liqTotalVals.length>0},errors,updatedAt:Date.now()};
}
async function bybitDerivatives(symbol,interval){
  const [oiRes,tradeRes,tickerRes,bookRes]=await Promise.allSettled([
    bybitGet('/v5/market/open-interest',{category:'linear',symbol,intervalTime:bybitInterval(interval),limit:50}),
    bybitGet('/v5/market/recent-trade',{category:'linear',symbol,limit:1000}),
    bybitGet('/v5/market/tickers',{category:'linear',symbol}),
    bybitGet('/v5/market/orderbook',{category:'linear',symbol,limit:50})
  ]);
  const errors=[];
  const oiPayload=oiRes.status==='fulfilled'?oiRes.value:null,tradePayload=tradeRes.status==='fulfilled'?tradeRes.value:null,tickerPayload=tickerRes.status==='fulfilled'?tickerRes.value:null,bookPayload=bookRes.status==='fulfilled'?bookRes.value:null;
  if(oiRes.status==='rejected')errors.push("OI: "+oiRes.reason.message);if(tradeRes.status==='rejected')errors.push("Trades: "+tradeRes.reason.message);if(tickerRes.status==='rejected')errors.push("Ticker: "+tickerRes.reason.message);if(bookRes.status==='rejected')errors.push("Order book: "+bookRes.reason.message);
  const oiList=(oiPayload?.result?.list||[]).slice().reverse().map(x=>+x.openInterest),ticker=tickerPayload?.result?.list?.[0]||null;
  const book=bookPayload?.result||{},bids=Array.isArray(book.b)?book.b:[],asks=Array.isArray(book.a)?book.a:[];
  const bidQty=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0),askQty=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[1])||0),0);
  const bidDepth=bids.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0),askDepth=asks.slice(0,10).reduce((n,r)=>n+(Number(r?.[0])||0)*(Number(r?.[1])||0),0);
  const bid=Number(bids[0]?.[0]),ask=Number(asks[0]?.[0]),mid=Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:null;
  const micro=mid&&bidQty+askQty>0?((ask*bidQty)+(bid*askQty))/(bidQty+askQty):null;
  const orderBook={imbalance:bidQty+askQty>0?(bidQty-askQty)/(bidQty+askQty):null,micropriceBias:mid&&Number.isFinite(micro)?(micro-mid)/mid:null,spreadBps:mid&&Number.isFinite(ask)&&Number.isFinite(bid)?((ask-bid)/mid)*10000:null,depthNotional:bidDepth+askDepth,bidDepth,askDepth,ts:Date.now()};
  const currentOi=oiList.length?oiList[oiList.length-1]:(ticker&&Number.isFinite(+ticker.openInterest)?+ticker.openInterest:NaN),oiFirst=oiList[0],oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((currentOi-oiFirst)/oiFirst)*100:null;
  const trades=(tradePayload?.result?.list||[]).slice().sort((a,b)=>+a.time-+b.time).map(x=>({ts:+x.time,price:+x.price,size:+x.size,side:x.side}));
  let cvd=0,total=0;for(const t of trades){const q=t.price*t.size;cvd+=(t.side==="Buy"?q:-q);total+=q}
  const first=trades[0]?.price,lastT=trades[trades.length-1]?.price,priceChangePct=Number.isFinite(first)&&first?((lastT-first)/first)*100:null,cvdRatio=total?cvd/total:null;
  const live=flowBucket(symbol),liveCvd=live.cvdNotional?live.cvd:cvd,liveCvdRatio=live.cvdNotional?live.cvd/live.cvdNotional:cvdRatio,liqTotal=live.liqLong+live.liqShort,liqBias=liqTotal?(live.liqLong>live.liqShort?"LONG LIQS DOMINANT":"SHORT LIQS DOMINANT"):"UNAVAILABLE";
  const liveOrderBook=live.orderBook||orderBook;
  const data={available:Boolean(ticker||oiPayload||tradePayload||bookPayload||live.cvdNotional||liqTotal),provider:"Bybit linear futures"+(live.cvdNotional||liqTotal?" · live stream":""),oi:Number.isFinite(currentOi)?currentOi:null,oiChangePct,cvdDelta:liveCvd,cvdRatio:liveCvdRatio,cvdState:"MIXED",positioning:"MIXED",tradeCount:trades.length,fundingRate:ticker&&Number.isFinite(+ticker.fundingRate)?normalizeFundingRate(ticker.fundingRate):null,markPrice:ticker&&Number.isFinite(+ticker.markPrice)?+ticker.markPrice:null,tradePriceChangePct:priceChangePct,takerImbalance:liveCvdRatio,longLiquidations:live.liqLong,shortLiquidations:live.liqShort,liquidationTotal:liqTotal,liquidationBias:liqBias,orderBook:liveOrderBook,livePointCount:live.points.length,liveHistory:live.points.slice(-120),errors,updatedAt:Date.now()};
  if(priceChangePct!=null&&cvdRatio!=null){if(priceChangePct>0.15&&cvdRatio<-0.01)data.cvdState="BEARISH DIVERGENCE";else if(priceChangePct<-0.15&&cvdRatio>0.01)data.cvdState="BULLISH DIVERGENCE";else if(priceChangePct>0.15&&cvdRatio>0.01)data.cvdState="BUYERS CONFIRM";else if(priceChangePct<-0.15&&cvdRatio<-0.01)data.cvdState="SELLERS CONFIRM"}else if(trades.length===0)data.cvdState="UNAVAILABLE";
  if(priceChangePct!=null&&oiChangePct!=null){if(priceChangePct>0.15&&oiChangePct>1)data.positioning="PRICE + OI: LONG PARTICIPATION";else if(priceChangePct>0.15&&oiChangePct<-1)data.positioning="PRICE UP + OI DOWN: SHORT COVERING";else if(priceChangePct<-0.15&&oiChangePct>1)data.positioning="PRICE DOWN + OI UP: SHORT PARTICIPATION";else if(priceChangePct<-0.15&&oiChangePct<-1)data.positioning="PRICE DOWN + OI DOWN: LONG LIQUIDATION"}else if(!Number.isFinite(oiChangePct))data.positioning=Number.isFinite(currentOi)?"OI CHANGE NOT AVAILABLE":"OI UNAVAILABLE";
  return mergeFlowSnapshot(symbol,data);
}

function mergeFlowSnapshot(symbol,base){
  const live=flowBucket(symbol);
  const points=Array.isArray(live.points)?live.points:[],last=points.length?points[points.length-1]:{},prev=points.length>1?points[points.length-2]:{};
  const out=Object.assign({},base||{});
  out.available=Boolean(out.available||live.wsConnected||Number.isFinite(live.oi)||Number.isFinite(live.fundingRate)||live.cvdNotional>0||live.orderBook||live.liqLong||live.liqShort||points.length);
  out.provider=out.provider||"Bybit linear futures";
  out.oi=Number.isFinite(live.oi)?live.oi:(Number.isFinite(out.oi)?out.oi:(Number.isFinite(last.oi)?last.oi:null));
  const dt=Number(last.ts||0)-Number(prev.ts||0);
  out.oiChangePct=Number.isFinite(out.oiChangePct)?out.oiChangePct:(Number.isFinite(live.oi)&&Number.isFinite(Number(prev.oi))&&Number(prev.oi)!==0&&dt>0&&dt<=120000?((live.oi-Number(prev.oi))/Math.abs(Number(prev.oi)))*100:null);
  out.cvdDelta=live.cvdNotional>0?live.cvd:(Number.isFinite(out.cvdDelta)?out.cvdDelta:(Number.isFinite(last.cvd)?last.cvd:null));
  out.cvdRatio=live.cvdNotional>0?live.cvd/live.cvdNotional:(Number.isFinite(out.cvdRatio)?out.cvdRatio:(Number.isFinite(last.cvdRatio)?last.cvdRatio:null));
  out.cvdState=Number.isFinite(out.cvdDelta)?(out.cvdDelta>0?"BUYERS PRESSURE":out.cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):(out.cvdState||"WAITING");
  out.fundingRate=Number.isFinite(live.fundingRate)?live.fundingRate:(Number.isFinite(out.fundingRate)?out.fundingRate:null);
  out.markPrice=Number.isFinite(live.markPrice)?live.markPrice:(Number.isFinite(out.markPrice)?out.markPrice:null);
  if(Number.isFinite(out.oiChangePct))out.positioning=out.oiChangePct>1?"OI RISING":out.oiChangePct<-1?"OI FALLING":"OI FLAT";
  if(!out.positioning||out.positioning==="MIXED"||out.positioning==="OI CHANGE NOT AVAILABLE"||out.positioning==="OI UNAVAILABLE"){
    out.positioning=Number.isFinite(out.oi)?"OI LIVE":"WAITING";
  }
  out.longLiquidations=Number.isFinite(live.liqLong)?live.liqLong:(Number.isFinite(out.longLiquidations)?out.longLiquidations:0);
  out.shortLiquidations=Number.isFinite(live.liqShort)?live.liqShort:(Number.isFinite(out.shortLiquidations)?out.shortLiquidations:0);
  out.liquidationTotal=out.longLiquidations+out.shortLiquidations;
  out.liquidationBias=out.liquidationTotal>0?(out.longLiquidations>out.shortLiquidations?"LONG LIQS DOMINANT":out.shortLiquidations>out.longLiquidations?"SHORT LIQS DOMINANT":"LIQUIDATION ACTIVITY"):"NO LIQUIDATION ACTIVITY";
  out.orderBook=live.orderBook||out.orderBook||null;
  out.liveHistory=points.slice(-180);
  out.livePointCount=points.length;
  out.liveConnected=Boolean(live.wsConnected);
  out.liveHost=live.wsHost||null;
  out.series=out.series||{};
  if(!Array.isArray(out.series.cvd)||out.series.cvd.length<2)out.series.cvd=points.map(x=>x.cvdRatio??x.cvd).filter(Number.isFinite);
  if(!Array.isArray(out.series.oi)||out.series.oi.length<2)out.series.oi=points.map(x=>x.oi).filter(Number.isFinite);
  if(!Array.isArray(out.series.liq)||out.series.liq.length<2)out.series.liq=points.map(x=>x.liqTotal).filter(Number.isFinite);
  return out;
}

async function derivatives(symbol,interval){
  const key=symbol+"|"+interval,hit=DERIV_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<DERIV_TTL)return hit.data;
  const existing=DERIV_INFLIGHT.get(key);
  if(existing)return existing;

  const job=(async()=>{
    const live=flowBucket(symbol);
    const now=Date.now();
    const liveFresh=Boolean(
      live.wsConnected &&
      Number.isFinite(live.lastTs) &&
      now-Number(live.lastTs||0) < 45000 &&
      (Number.isFinite(live.oi) || live.cvdNotional>0 || live.liqLong>0 || live.liqShort>0 || live.orderBook)
    );

    let data=null;

    // Prefer the existing live market-data stream when it is fresh. This avoids
    // turning a temporary REST/provider restriction into a total derivatives outage.
    if(liveFresh){
      data={
        available:true,
        provider:"Bybit live stream",
        symbol,
        oi:Number.isFinite(live.oi)?live.oi:null,
        oiChangePct:null,
        cvdDelta:live.cvdNotional>0?live.cvd:null,
        cvdRatio:live.cvdNotional>0?live.cvd/live.cvdNotional:null,
        cvdState:live.cvd>0?"BUYERS PRESSURE":live.cvd<0?"SELLERS PRESSURE":"BALANCED",
        positioning:Number.isFinite(live.oi)?"OI LIVE":"WAITING",
        tradeCount:0,
        fundingRate:Number.isFinite(live.fundingRate)?live.fundingRate:null,
        markPrice:Number.isFinite(live.markPrice)?live.markPrice:null,
        longLiquidations:Number(live.liqLong||0),
        shortLiquidations:Number(live.liqShort||0),
        liquidationTotal:Number(live.liqLong||0)+Number(live.liqShort||0),
        liquidationBias:(live.liqLong||0)+(live.liqShort||0)
          ?((live.liqLong||0)>(live.liqShort||0)?"LONG LIQS DOMINANT":(live.liqShort||0)>(live.liqLong||0)?"SHORT LIQS DOMINANT":"LIQUIDATION ACTIVITY")
          :"NO LIQUIDATION ACTIVITY",
        orderBook:live.orderBook||null,
        liveConnected:true,
        liveHost:live.wsHost||null,
        livePointCount:Array.isArray(live.points)?live.points.length:0,
        liveHistory:Array.isArray(live.points)?live.points.slice(-180):[],
        errors:[],
        updatedAt:now
      };
    }

    // If the stream is not fresh enough, use the faster public Bybit REST API first.
    if(!data){
      try{data=await bybitDerivatives(symbol,interval)}
      catch(bybitErr){
        // Kraken remains the historical/public analytics fallback.
        try{data=await krakenAnalytics(symbol,interval)}
        catch(krakenErr){
          try{
            const ticker=await fetchJson("https://futures.kraken.com/derivatives/api/v3/tickers");
            const t=(ticker.tickers||[]).find(x=>String(x.symbol||"").toUpperCase()===KRAKEN_FUTURES_PAIRS[symbol]);
            const cvd=await krakenRecentCvd(symbol).catch(()=>null);
            if(!t&&!cvd)throw new Error("Kraken Futures public analytics unavailable");
            data={
              available:true,
              provider:"Kraken Futures public API",
              symbol:KRAKEN_FUTURES_PAIRS[symbol],
              oi:t&&Number.isFinite(+t.openInterest)?+t.openInterest:null,
              oiChangePct:null,
              cvdDelta:cvd?.cvdDelta??null,
              cvdRatio:cvd?.cvdRatio??null,
              cvdState:"MIXED",
              positioning:"OI CHANGE NOT AVAILABLE",
              tradeCount:cvd?.tradeCount??0,
              fundingRate:t&&Number.isFinite(+t.fundingRate)?+t.fundingRate:null,
              markPrice:t&&Number.isFinite(+t.markPrice)?+t.markPrice:null,
              tradePriceChangePct:cvd?.tradePriceChangePct??null,
              errors:["Bybit: "+String(bybitErr?.message||bybitErr),"Kraken analytics: "+String(krakenErr?.message||krakenErr)],
              updatedAt:now
            };
          }catch(fallbackErr){
            data={
              available:false,
              provider:"No derivatives provider",
              oi:null,oiChangePct:null,cvdDelta:null,cvdRatio:null,
              cvdState:"UNAVAILABLE",positioning:"UNAVAILABLE",tradeCount:0,
              fundingRate:null,markPrice:null,
              errors:[
                "Bybit: "+String(bybitErr?.message||bybitErr),
                "Kraken analytics: "+String(krakenErr?.message||krakenErr),
                "Kraken ticker/CVD fallback: "+String(fallbackErr?.message||fallbackErr)
              ],
              updatedAt:now
            };
          }
        }
      }
    }

    const live2=flowBucket(symbol);
    if(Number.isFinite(data.oi))live2.oi=data.oi;
    if(Number.isFinite(data.fundingRate))live2.fundingRate=data.fundingRate;
    if(Number.isFinite(data.markPrice))live2.markPrice=data.markPrice;

    if(Number.isFinite(data.cvdDelta)&&!live2.cvdNotional){
      live2.cvd=data.cvdDelta;live2.cvdNotional=1;
    }

    if(Number.isFinite(data.cvdDelta)){
      data.cvdState=data.cvdDelta>0?"BUYERS PRESSURE":data.cvdDelta<0?"SELLERS PRESSURE":"BALANCED";
    }
    if(Number.isFinite(data.oiChangePct)){
      data.positioning=data.oiChangePct>1?"OI RISING":data.oiChangePct<-1?"OI FALLING":"OI FLAT";
    }
    if(Number.isFinite(data.longPercent)&&Number.isFinite(data.shortPercent)){
      data.positioning=data.longPercent>data.shortPercent+2?"LONG BIAS":data.shortPercent>data.longPercent+2?"SHORT BIAS":"BALANCED";
    }

    recordFlowPoint(symbol);

    if(live2.cvdNotional>0){
      data.cvdDelta=live2.cvd;
      data.cvdRatio=live2.cvdNotional?live2.cvd/live2.cvdNotional:null;
      data.cvdState=live2.cvd>0?"BUYERS PRESSURE":live2.cvd<0?"SELLERS PRESSURE":"BALANCED";
    }
    if(Number.isFinite(live2.oi))data.oi=live2.oi;
    if(Number.isFinite(live2.fundingRate))data.fundingRate=live2.fundingRate;
    if(Number.isFinite(live2.markPrice))data.markPrice=live2.markPrice;
    if(live2.orderBook)data.orderBook=live2.orderBook;

    if(live2.liqLong||live2.liqShort){
      data.longLiquidations=live2.liqLong;data.shortLiquidations=live2.liqShort;
      data.liquidationTotal=live2.liqLong+live2.liqShort;
      data.liquidationBias=live2.liqLong>live2.liqShort?"LONG LIQS DOMINANT":live2.liqShort>live2.liqLong?"SHORT LIQS DOMINANT":"LIQUIDATION ACTIVITY";
    }

    data.series=data.series||{};
    if(!Array.isArray(data.series.cvd)||data.series.cvd.length<2)data.series.cvd=live2.points.map(x=>x.cvdRatio??x.cvd).filter(Number.isFinite);
    if(!Array.isArray(data.series.oi)||data.series.oi.length<2)data.series.oi=live2.points.map(x=>x.oi).filter(Number.isFinite);
    if(!Array.isArray(data.series.liq)||data.series.liq.length<2)data.series.liq=live2.points.map(x=>x.liqTotal).filter(Number.isFinite);

    data.provider=(data.provider||"Derivatives");
    if(live2.wsConnected)data.provider+=" · live flow";
    data.liveHistory=live2.points.slice(-180);
    data.livePointCount=live2.points.length;
    data.liveConnected=Boolean(live2.wsConnected);
    data.liveHost=live2.wsHost||null;

    // A provider being temporarily restricted is not itself a complete market-data outage
    // when another usable provider/stream is active.
    data.providerHealth={
      liveStream:live2.wsConnected?"HEALTHY":"UNAVAILABLE",
      restPrimary:["Bybit linear futures","Bybit live stream"].some(x=>String(data.provider).includes(x))?"HEALTHY":"DEGRADED",
      historicalFallback:"Kraken Futures public API"
    };

    data=mergeFlowSnapshot(symbol,data);
    DERIV_CACHE.set(key,{ts:Date.now(),data});
    return data;
  })().finally(()=>DERIV_INFLIGHT.delete(key));

  DERIV_INFLIGHT.set(key,job);
  return job;
}

function send(res,code,p){
  // Keep operational errors in server logs; avoid returning stack and SQL details.
  if(code>=500&&p&&typeof p.error==="string"&&!/^[A-Z][A-Z0-9_]{2,60}$/.test(p.error)){
    p={...p,error:code===503?"Service temporarily unavailable":"Internal server error"};
  }
  res.writeHead(code,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Strict-Transport-Security':'max-age=31536000; includeSubDomains',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
    'Cross-Origin-Opener-Policy':'same-origin',
    'Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  });
  res.end(JSON.stringify(p))
}
async function callOpenAI(systemPrompt,userPrompt){
  if(!OPENAI_API_KEY) throw new Error("AI_COPILOT_NOT_CONFIGURED");
  const now=Date.now();
  const body={
    model:OPENAI_MODEL,
    instructions:systemPrompt,
    input:userPrompt,
    max_output_tokens:900
  };
  const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),AI_LIMIT_MS);
  try{
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+OPENAI_API_KEY},
      body:JSON.stringify(body),
      signal:controller.signal
    });
    const raw=await r.text();
    let j={}; try{j=JSON.parse(raw)}catch{}
    if(!r.ok) throw new Error(j?.error?.message||("OpenAI returned "+r.status));
    const text=j.output_text || (j.output||[]).flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text || "";
    if(!text) throw new Error("AI returned no text");
    return {text,model:OPENAI_MODEL,ts:Date.now()};
  } finally {clearTimeout(t)}
}

function aiAllowed(req){
  const ip=clientIp(req);
  const last=AI_CALLS.get(ip)||0;
  if(Date.now()-last<4000)return false;
  AI_CALLS.set(ip,Date.now()); return true;
}

function aiSystem(){
  return [
    "You are MarketPulse Copilot, a calm crypto market analyst inside a decision-support product.",
    "Use the supplied market data and trade details. Do not invent live prices, catalysts, news, or indicators.",
    "Explain reasoning in plain, modern language. Be concise but useful.",
    "Never promise profit, certainty, or a winning probability. Never tell the user to risk more money.",
    "For a market read: describe regime, multi-timeframe alignment, momentum, volatility, structure, and what would invalidate the setup.",
    "For a personal trade review: separate execution quality from outcome. Review entry, stop, target, R:R, sizing/risk, and whether the plan matched the market regime.",
    "When evidence conflicts, say so. A valid answer may be WAIT / NO TRADE.",
    "This is educational decision support, not individualized financial advice."
  ].join(" ");
}

function liteCopilot(mode,market,trade,question){
  const m=market||{},call=String(m.status==="READY"?m.type:m.status==="WATCH"?"WATCH":m.status==="WAITING"?"NO TRADE":m.type||"NO TRADE"),regime=String(m.regime||"UNKNOWN"),score=Number(m.score||0),rsi=Number.isFinite(Number(m.rsi))?Number(m.rsi).toFixed(2):"—",adx=Number.isFinite(Number(m.adx))?Number(m.adx).toFixed(2):"—",structure=String(m.structure||"—"),mtf=m.mtf?("4H "+(m.mtf.higher||"UNKNOWN")+" · 15M "+(m.mtf.lower||"UNKNOWN")):"",deriv=m.derivatives||{};
  if(mode==="trade"){
    const entry=Number(trade?.entry),stop=Number(trade?.stop),target=Number(trade?.target),side=String(trade?.side||""),risk=Number.isFinite(entry)&&Number.isFinite(stop)?Math.abs(entry-stop):NaN,reward=Number.isFinite(entry)&&Number.isFinite(target)?Math.abs(target-entry):NaN,rr=Number.isFinite(risk)&&risk?reward/risk:NaN;
    const lines=["MarketPulse Lite review","", "Market context: "+regime+" · "+call+" · confluence "+score+"/100.","Momentum: RSI "+rsi+" · ADX "+adx+" · structure "+structure+".",mtf?"Timeframe context: "+mtf+".":"",deriv.cvdState?"Derivatives: "+deriv.cvdState+" · "+(deriv.positioning||"positioning unavailable")+".":""].filter(Boolean);
    if(side)lines.push("Your plan: "+side+(Number.isFinite(rr)?" · planned R:R "+rr.toFixed(2)+"R.":""));
    if(call==="NO TRADE")lines.push("The dashboard currently sees insufficient alignment. That matters more than whether the trade eventually wins or loses.");
    else if(Number.isFinite(rr)&&rr<1.5)lines.push("Your planned R:R is below 1.5R. Check whether the invalidation is structural before proceeding.");
    else if(Number.isFinite(rr))lines.push("Your planned R:R is "+rr.toFixed(2)+"R. Check that the invalidation is structural rather than arbitrary.");
    lines.push("Question: "+(question||"Review this trade."),"Note: Lite mode uses deterministic MarketPulse rules. Add API credits to unlock full AI reasoning.");
    return lines.join("\n");
  }
  return ["MarketPulse Lite","", "Market context: "+regime+" · "+call+" · confluence "+score+"/100.","Momentum: RSI "+rsi+" · ADX "+adx+" · structure "+structure+".",mtf?"Multi-timeframe: "+mtf+".":"",deriv.cvdState?"Derivatives: "+deriv.cvdState+" · "+(deriv.positioning||"positioning unavailable")+".":"",call==="NO TRADE"?"Read: wait for alignment instead of forcing a trade.":"Read: treat this as a setup to validate, not a guarantee.","Question: "+(question||"What is the market doing?"),"Full AI reasoning will be available when API credits are added."].filter(Boolean).join("\n");
}

function replayOutcome(candles,index,analysis,horizon=12){
  if(!analysis||!["READY","WATCH","WAITING"].includes(analysis.status))return {status:"NO_SIGNAL"};
  const entryLow=Number(analysis.entryLow),entryHigh=Number(analysis.entryHigh),stop=Number(analysis.stop),target=Number(analysis.tp1);
  const side=String(analysis.side||"");
  if(!Number.isFinite(stop)||!Number.isFinite(target)||!side)return {status:"NO_LEVELS"};
  const entry=Number.isFinite(entryLow)&&Number.isFinite(entryHigh)?(entryLow+entryHigh)/2:Number(analysis.price);
  if(!Number.isFinite(entry)||Math.abs(entry-stop)<1e-12)return {status:"NO_LEVELS"};
  const zoneLow=Number.isFinite(entryLow)?entryLow:entry,zoneHigh=Number.isFinite(entryHigh)?entryHigh:entry;
  let entryBar=-1;
  for(let j=index+1;j<Math.min(candles.length,index+1+horizon);j++){
    const c=candles[j],hitEntry=Number(c.l)<=zoneHigh&&Number(c.h)>=zoneLow;
    if(hitEntry){entryBar=j;break}
  }
  if(entryBar<0)return {status:"NOT_TRIGGERED",entry,stop,target,side,resolutionBars:horizon};
  let outcome="UNRESOLVED",resultR=0,resolvedBar=-1;
  for(let j=entryBar;j<Math.min(candles.length,index+1+horizon);j++){
    const c=candles[j],lo=Number(c.l),hi=Number(c.h);
    const stopHit=side==="LONG"?lo<=stop:hi>=stop;
    const targetHit=side==="LONG"?hi>=target:lo<=target;
    if(stopHit&&targetHit){outcome="AMBIGUOUS";resolvedBar=j;resultR=0;break}
    if(stopHit){outcome="STOP";resolvedBar=j;resultR=-1;break}
    if(targetHit){outcome="TARGET_1";resolvedBar=j;const risk=Math.abs(entry-stop),reward=Math.abs(target-entry);resultR=risk?reward/risk:0;break}
  }
  return {status:outcome,entry,stop,target,side,resultR,resolutionBars:resolvedBar>=0?resolvedBar-entryBar:horizon,entryBar:entryBar-index,resolvedBar:resolvedBar};
}

function replaySnapshot(a){
  return {
    status:a.status,type:a.type,side:a.side,score:a.score,bias:a.bias,regime:a.regime,mood:a.mood,
    momentum:a.momentum,volatilityState:a.volatilityState,structure:a.structure,directionalLean:a.directionalLean,
    price:a.price,rsi:a.rsi,adx:a.adx,atrPct:a.atrPct,volumeZ:a.volumeZ,
    ema20:a.ema20,ema50:a.ema50,ema200:a.ema200,
    entryLow:a.entryLow,entryHigh:a.entryHigh,stop:a.stop,tp1:a.tp1,tp2:a.tp2,rr:a.rr,
    probabilityLabel:a.probabilityLabel,reasons:(a.reasons||[]).slice(0,6),
    derivatives:a.derivatives||null,
    historicalDerivativeContext:a.derivatives?.available?"BINANCE_PUBLIC_FUTURES":"UNAVAILABLE_IN_REPLAY"
  };
}

async function historicalCandles(symbol,interval,bars){
  const n=Math.max(240,Math.min(Number(bars)||4200,4200));
  if(interval==="1d")return longDailyHistory(symbol,n);
  return klines(symbol,interval);
}

const HIST_DERIV_CACHE=new Map();
const HIST_DERIV_TTL=15*60*1000;
function binanceDerivPeriod(interval){return ({'15m':'15m','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}
async function historicalBinanceDerivatives(symbol,interval){
  const key=symbol+"|"+interval,hit=HIST_DERIV_CACHE.get(key);
  if(hit&&Date.now()-hit.ts<HIST_DERIV_TTL)return hit.rows;
  const period=binanceDerivPeriod(interval),base="https://fapi.binance.com";
  const qs="symbol="+encodeURIComponent(symbol)+"&period="+period+"&limit=500";
  const endpoints={
    oi:"/futures/data/openInterestHist?"+qs+"&contractType=PERPETUAL",
    taker:"/futures/data/takerBuySellVol?"+qs+"&contractType=PERPETUAL",
    accounts:"/futures/data/topLongShortAccountRatio?"+qs+"&contractType=PERPETUAL",
    funding:"/fapi/v1/fundingRate?symbol="+encodeURIComponent(symbol)+"&limit=500"
  };
  const safe=async path=>{try{return await fetchJson(base+path,6000)}catch{return[]}};
  const [oi,taker,accounts,funding]=await Promise.all([safe(endpoints.oi),safe(endpoints.taker),safe(endpoints.accounts),safe(endpoints.funding)]);
  const rows=new Map();
  const put=(ts,patch)=>{const k=Number(ts);if(!Number.isFinite(k))return;const x=rows.get(k)||{t:k};Object.assign(x,patch);rows.set(k,x)};
  (Array.isArray(oi)?oi:[]).forEach((x,i,a)=>{
    const v=Number(x.sumOpenInterestValue??x.sumOpenInterest);put(x.timestamp,{oi:v});
    if(i>0){const prev=Number(a[i-1].sumOpenInterestValue??a[i-1].sumOpenInterest);if(Number.isFinite(v)&&Number.isFinite(prev)&&prev)rows.get(Number(x.timestamp)).oiChangePct=(v-prev)/prev*100}
  });
  (Array.isArray(taker)?taker:[]).forEach(x=>{
    const buy=Number(x.takerBuyVolValue??x.takerBuyVol),sell=Number(x.takerSellVolValue??x.takerSellVol);
    const total=buy+sell;
    put(x.timestamp,{
      takerBuyVol:buy,takerSellVol:sell,
      takerImbalance:Number.isFinite(buy)&&Number.isFinite(sell)&&total>0?(buy-sell)/total:null,
      cvdDelta:Number.isFinite(buy)&&Number.isFinite(sell)?buy-sell:null,
      cvdRatio:Number.isFinite(buy)&&Number.isFinite(sell)&&total>0?(buy-sell)/total:null
    });
  });
  (Array.isArray(accounts)?accounts:[]).forEach(x=>{
    const longPct=Number(x.longAccount)*100,shortPct=Number(x.shortAccount)*100;
    put(x.timestamp,{longPercent:Number.isFinite(longPct)?longPct:null,shortPercent:Number.isFinite(shortPct)?shortPct:null,longShortRatio:Number(x.longShortRatio)});
  });
  (Array.isArray(funding)?funding:[]).forEach(x=>{
    put(x.fundingTime,{fundingRate:Number(x.fundingRate)});
  });
  const out=Array.from(rows.values()).sort((a,b)=>a.t-b.t);
  HIST_DERIV_CACHE.set(key,{ts:Date.now(),rows:out});
  return out;
}
function nearestHistoricalDerivative(rows,ts){
  if(!Array.isArray(rows)||!rows.length)return null;
  let lo=0,hi=rows.length-1,best=null;
  while(lo<=hi){const m=(lo+hi)>>1,x=rows[m];if(x.t<=ts){best=x;lo=m+1}else hi=m-1}
  return best?{...best}:null;
}

async function buildReplayDataset(symbol,interval,{points=60,bars=420}={}){
  const candles=await historicalCandles(symbol,interval,bars);
  if(!candles||candles.length<240)throw new Error("Not enough historical candles for replay");
  const usable=Math.max(1,candles.length-220-13),count=Math.max(10,Math.min(Number(points)||60,usable));
  const step=Math.max(1,Math.floor(usable/count)),frames=[];
  const historicalDeriv=await historicalBinanceDerivatives(symbol,interval).catch(()=>[]);
  for(let idx=220;idx<candles.length-12;idx+=step){
    const window=candles.slice(0,idx+1);
    const rawD=nearestHistoricalDerivative(historicalDeriv,candles[idx].t);
    const deriv=rawD?{
      available:true,provider:"Binance public futures history",
      oi:rawD.oi??null,oiChangePct:rawD.oiChangePct??null,
      takerImbalance:rawD.takerImbalance??null,
      longPercent:rawD.longPercent??null,shortPercent:rawD.shortPercent??null,longShortRatio:rawD.longShortRatio??null,
      cvdDelta:rawD.cvdDelta??null,cvdRatio:rawD.cvdRatio??null,cvdState:Number.isFinite(rawD.cvdDelta)?(rawD.cvdDelta>0?"BUYERS PRESSURE":rawD.cvdDelta<0?"SELLERS PRESSURE":"BALANCED"):"UNAVAILABLE",positioning:"HISTORICAL OI",
      fundingRate:rawD.fundingRate??null,
      liquidationBias:"UNKNOWN",liquidationTotal:null,orderBook:null,errors:[]
    }:null;
    const a=analyze(window,{interval,deriv});
    const outcome=replayOutcome(candles,idx,a,12);
    frames.push({
      index:idx,ts:candles[idx].t,price:candles[idx].c,
      snapshot:replaySnapshot(a),outcome
    });
    if(frames.length>=count)break;
  }
  return {symbol,interval,candles,frames,coverage:{bars:candles.length,startTs:candles[0]?.t,endTs:candles[candles.length-1]?.t,points:frames.length,horizonBars:12,historicalDerivatives:Boolean(historicalDeriv.length),derivativeRows:historicalDeriv.length}};
}

function dnaRecordsFromReplay(dataset){
  return (dataset.frames||[]).map(f=>{
    const s=f.snapshot,o=f.outcome||{};
    const signalKey=["MPDNA",dataset.symbol,dataset.interval,f.ts,s.status,s.score,s.side].join("|");
    return {
      signalKey,symbol:dataset.symbol,interval:dataset.interval,candleTs:f.ts,status:s.status,side:s.side||"NEUTRAL",
      type:s.type||"NO TRADE",regime:s.regime||"UNKNOWN",score:Number(s.score)||0,
      snapshot:s,outcome:o
    };
  });
}

function summarizeDNA(records){
  const rows=Array.isArray(records)?records:[];
  const resolved=rows.filter(x=>["TARGET_1","STOP","AMBIGUOUS"].includes(x.outcome?.status));
  const triggered=rows.filter(x=>!["NOT_TRIGGERED","NO_SIGNAL","NO_LEVELS"].includes(x.outcome?.status));
  const by=(keyFn)=>{
    const map=new Map();
    for(const r of rows){const k=keyFn(r)||"UNKNOWN";const x=map.get(k)||{key:k,total:0,triggered:0,target:0,stop:0,ambiguous:0,notTriggered:0,netR:0,resolved:0};x.total++;if(r.outcome?.status==="TARGET_1"){x.target++;x.triggered++;x.resolved++;x.netR+=Number(r.outcome.resultR)||0}else if(r.outcome?.status==="STOP"){x.stop++;x.triggered++;x.resolved++;x.netR-=1}else if(r.outcome?.status==="AMBIGUOUS"){x.ambiguous++;x.triggered++;x.resolved++}else if(r.outcome?.status==="NOT_TRIGGERED")x.notTriggered++;map.set(k,x)}
    return Array.from(map.values()).map(x=>({...x,triggerRate:x.total?x.triggered/x.total:0,targetRate:x.resolved?x.target/x.resolved:0,avgR:x.resolved?x.netR/x.resolved:0})).sort((a,b)=>b.total-a.total);
  };
  const scoreBuckets=by(r=>{const s=Number(r.score)||0;return s<40?"0-39":s<55?"40-54":s<70?"55-69":s<80?"70-79":"80-100"});
  return {total:rows.length,resolved:resolved.length,triggered:triggered.length,targetHits:resolved.filter(x=>x.outcome?.status==="TARGET_1").length,stops:resolved.filter(x=>x.outcome?.status==="STOP").length,ambiguous:resolved.filter(x=>x.outcome?.status==="AMBIGUOUS").length,notTriggered:rows.filter(x=>x.outcome?.status==="NOT_TRIGGERED").length,netR:resolved.reduce((a,x)=>a+(Number(x.outcome?.resultR)||0),0),byRegime:by(r=>r.regime),bySide:by(r=>r.side),byType:by(r=>r.type),byStatus:by(r=>r.status),byScore:scoreBuckets};
}

function staticFile(req,res){
  // Normalize the URL path before handling the SPA root. The PWA manifest uses
  // '/?app=marketpulse-mobile', so comparing the raw req.url to '/' would
  // incorrectly try to read the public directory instead of public/index.html.
  const urlPath=String(req.url||'/').split('?')[0]||'/';
  if(req.method!=="GET"&&req.method!=="HEAD")return send(res,405,{ok:false,error:"Method not allowed"});
  const reqPath=urlPath==='/'?'/index.html':urlPath;
  // Defend against accidental publication of backups, env files and dot-directories.
  if(reqPath.split("/").some(part=>part.startsWith(".")))return send(res,404,{ok:false,error:"Not found"});
  const root=path.resolve(__dirname,'public'),file=path.resolve(root,'.'+reqPath),relative=path.relative(root,file);
  if(relative.startsWith('..')||path.isAbsolute(relative))return send(res,403,{error:'Forbidden'});
  const safeExt=new Set([".html",".js",".mjs",".css",".json",".svg",".png",".jpg",".jpeg",".webp",".ico"]);
  if(!safeExt.has(path.extname(file).toLowerCase()))return send(res,404,{error:"Not found"});
  fs.realpath(file,(err,actual)=>{
    if(err)return send(res,404,{error:"Not found"});
    const realRelative=path.relative(root,actual);
    if(realRelative.startsWith("..")||path.isAbsolute(realRelative))return send(res,403,{error:"Forbidden"});
  fs.readFile(actual,(e,d)=>{
    if(e)return send(res,404,{error:'Not found'});
    const ext=path.extname(file).toLowerCase();
    const mime={
      '.html':'text/html; charset=utf-8',
      '.js':'application/javascript; charset=utf-8',
      '.mjs':'application/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.json':'application/json; charset=utf-8',
      '.svg':'image/svg+xml',
      '.png':'image/png',
      '.jpg':'image/jpeg',
      '.jpeg':'image/jpeg',
      '.webp':'image/webp',
      '.ico':'image/x-icon'
    };
    const type=mime[ext]||'text/plain; charset=utf-8';
    const nonce=crypto.randomBytes(18).toString('base64');
    let body=d;
    if(ext==='.html')body=Buffer.from(d.toString().replaceAll('__CSP_NONCE__',nonce));
    const csp=[
      "default-src 'self'",
      "script-src 'self' 'nonce-"+nonce+"'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' wss: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests"
    ].join("; ");
    res.writeHead(200,{
      'Content-Type':type,'Cache-Control':'no-store','Pragma':'no-cache',
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
      'Strict-Transport-Security':'max-age=31536000; includeSubDomains',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
      'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':csp
    });
    res.end(req.method==="HEAD"?undefined:body);
  });
  });
}

async function warmCoreScan(interval,force=false){
  const current=SCAN_JOBS.get(interval);
  if(current){
    if(!force)return current;
    try{await current;return}catch{}
  }
  const job=(async()=>{
    const cached=SCAN_CACHE.get(interval);
    if(!force&&cached&&Date.now()-cached.ts<SCAN_TTL)return cached.payload;
    const [ticker,marketMeta]=await Promise.all([getBinanceTickerSnapshot(SYMBOLS),getMarketMetadata(SYMBOLS)]);
    const scanOne=async symbol=>{
      const tick=ticker[symbol]||{},meta=marketMeta[symbol]||{};
      try{
        const candles=await Promise.race([klines(symbol,interval),new Promise((_,reject)=>setTimeout(()=>reject(Error('Primary scan timeout')),6500))]);
        if(!candles||candles.length<220)throw Error('Insufficient candles');
        const higher=interval==='4h'?null:await Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1100))]).catch(()=>null);
        const lower=interval==='15m'?null:await Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1100))]).catch(()=>null);
        let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv:null});
        try{
          const learned=await Promise.race([learning.process(symbol,interval,candles,analysis,{observe:false}),new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
          if(learned?.analysis)analysis=learned.analysis;
        }catch{}
        return {
          symbol,label:labels[symbol]||symbol,
          price:Number.isFinite(Number(tick.price))?tick.price:(Number.isFinite(Number(analysis.price))?analysis.price:(meta.geckoPrice??null)),
          change24h:Number.isFinite(Number(tick.change24h))?tick.change24h:(Number.isFinite(Number(analysis.change24h))?analysis.change24h:(meta.change24h??null)),
          regime:analysis.regime,side:analysis.side,type:analysis.type,status:analysis.status,
          score:analysis.score,bias:analysis.bias,probabilityLabel:analysis.probabilityLabel,structure:analysis.structure,
          market:meta,derivatives:null
        };
      }catch(e){
        return {symbol,label:labels[symbol]||symbol,price:tick.price??meta.geckoPrice??null,change24h:tick.change24h??meta.change24h??null,market:meta,status:'WAITING',side:'WAIT',score:0,error:e.message};
      }
    };
    const rows=await Promise.all(SYMBOLS.map(scanOne));
    const payload={ok:true,interval,rows,marketSource:'multi-source',updatedAt:Date.now(),cacheTtlMs:SCAN_TTL,mode:'fast-cached-scan-v4'};
    SCAN_CACHE.set(interval,{ts:Date.now(),payload});
    return payload;
  })();
  SCAN_JOBS.set(interval,job);
  try{return await job}finally{SCAN_JOBS.delete(interval)}
}
const LIVE_SYNC_CLIENTS=new Set();
const LIVE_SYNC_PUSH_TIMERS=new Map();
const LIVE_SYNC_PUSH_MIN_MS=75;

function liveSyncPushSnapshot(symbol){
  const base=liveSyncSnapshot(symbol);
  // Push only the current canonical frame. The browser already maintains its
  // own history and can render the frame immediately without transferring 180
  // historical points on every market event.
  return {
    type:"market-sync",
    symbol:base.symbol,
    seq:base.seq,
    liveConnected:base.liveConnected,
    updatedAt:base.updatedAt,
    dataTs:base.dataTs,
    dataAgeMs:base.dataAgeMs,
    price:base.price,
    lastPrice:base.lastPrice,
    markPrice:base.markPrice,
    change24h:base.change24h,
    oi:base.oi,
    fundingRate:base.fundingRate,
    cvd:base.cvd,
    cvdDelta:base.cvdDelta,
    cvdRatio:base.cvdRatio,
    cvdState:base.cvdState,
    longLiquidations:base.longLiquidations,
    shortLiquidations:base.shortLiquidations,
    liquidationTotal:base.liquidationTotal,
    liquidationBias:base.liquidationBias,
    orderBook:base.orderBook,
    takerImbalance:base.takerImbalance,
    positioning:base.positioning,
    serverTs:Date.now()
  };
}

function broadcastLiveSync(symbol){
  const payload=JSON.stringify(liveSyncPushSnapshot(symbol));
  for(const client of LIVE_SYNC_CLIENTS){
    try{
      if(client.readyState===WebSocket.OPEN&&client.symbol===symbol){
        client.send(payload);
      }
    }catch{}
  }
}

function scheduleLiveSyncBroadcast(symbol){
  if(LIVE_SYNC_PUSH_TIMERS.has(symbol))return;
  LIVE_SYNC_PUSH_TIMERS.set(symbol,setTimeout(()=>{
    LIVE_SYNC_PUSH_TIMERS.delete(symbol);
    broadcastLiveSync(symbol);
  },LIVE_SYNC_PUSH_MIN_MS));
}

// Bound streamed and chunked JSON bodies as well as requests with Content-Length.
async function readLimitedBody(req,limit=262144){
  const buffers=[];let bytes=0;
  for await(const chunk of req){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    bytes+=buffer.length;
    if(bytes>limit){const error=new Error("Request too large");error.statusCode=413;throw error}
    buffers.push(buffer);
  }
  return Buffer.concat(buffers,bytes).toString("utf8");
}
async function scopedMemoryDevice(req,u){
  const user=await auth.userFromRequest(req);
  if(!user)return {status:401,error:"Authentication required"};
  const originalDevice=String(u.searchParams.get("device")||req.headers["x-marketpulse-device"]||requestDevice(req));
  if(!/^[a-f0-9-]{16,128}$/i.test(originalDevice))return {status:400,error:"Invalid device ID"};
  return {device:crypto.createHash("sha256").update(user.id+":"+originalDevice).digest("hex"),originalDevice};
}
function tokenEquals(a,b){
  const left=Buffer.from(String(a||"")),right=Buffer.from(String(b||""));
  return left.length>0&&left.length===right.length&&crypto.timingSafeEqual(left,right);
}
const server=http.createServer(async(req,res)=>{
  const started=Date.now();SERVER_METRICS.requests++;
  const rawPath=String(req.url||"").split("?")[0];
  SERVER_METRICS.routeCounts.set(rawPath,(SERVER_METRICS.routeCounts.get(rawPath)||0)+1);
  res.on("finish",()=>{const latency=Date.now()-started;const at=Date.now();SERVER_METRICS.totalLatencyMs+=latency;if(res.statusCode>=500)SERVER_METRICS.errors++;if(res.statusCode>=500)SERVER_METRICS.lastErrors.unshift({path:rawPath,status:res.statusCode,latencyMs:latency,at:new Date().toISOString()});if(SERVER_METRICS.lastErrors.length>50)SERVER_METRICS.lastErrors.length=50;SERVER_METRICS.recentRequests.push({at,path:rawPath,status:res.statusCode,latencyMs:latency});const cutoff=at-120000;while(SERVER_METRICS.recentRequests.length&&SERVER_METRICS.recentRequests[0].at<cutoff)SERVER_METRICS.recentRequests.shift()});
  try{
    const u=new URL(req.url,'http://localhost');
    if(!rateRequest(req,u.pathname))return send(res,429,{ok:false,error:"Too many requests. Please slow down."});

    const devTraderBridgeToken=String(process.env.DEV_TRADER_BRIDGE_TOKEN||"");
    const devTraderBridgePath=u.pathname.startsWith("/api/dev-trader/");
    if(devTraderBridgePath){
      if(!devTraderBridgeToken || !tokenEquals(req.headers["x-dev-trader-bridge"],devTraderBridgeToken)){
        return send(res,401,{ok:false,error:"Dev Trader bridge unauthorized"});
      }
      if(req.method==="POST"&&u.pathname==="/api/dev-trader/learning/signal"){
        let raw="";raw=await readLimitedBody(req);
        let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
        try{return send(res,200,{ok:true,...await learning.recordLiveSignalOpen(body)})}catch(e){return send(res,400,{ok:false,error:e.message})}
      }
      if(req.method==="POST"&&u.pathname==="/api/dev-trader/learning/outcome"){
        let raw="";raw=await readLimitedBody(req);
        let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
        try{return send(res,200,{ok:true,...await learning.resolveLiveSignal(body)})}catch(e){return send(res,400,{ok:false,error:e.message})}
      }
      if(req.method==="GET"&&u.pathname==="/api/dev-trader/learning/status"){
        try{return send(res,200,{ok:true,...await learning.status()})}catch(e){return send(res,503,{ok:false,error:e.message})}
      }
      if(req.method==="GET"&&u.pathname==="/api/dev-trader/learning/open"){
        const symbol=u.searchParams.get("symbol")||null,interval=u.searchParams.get("interval")||null;
        try{
          let predictions=await storage.getLearningPredictions({symbol,interval,limit:200,resolvedOnly:false});
          predictions=predictions.filter(p=>p?.outcome==null&&p?.features?.source==="DEV_TRADER_LIVE");
          return send(res,200,{ok:true,predictions});
        }catch(e){return send(res,503,{ok:false,error:e.message})}
      }
      if(req.method==="GET"&&u.pathname==="/api/dev-trader/learning/history"){
        const symbol=u.searchParams.get("symbol")||null,interval=u.searchParams.get("interval")||null;
        try{
          let predictions=await storage.getLearningPredictions({symbol,interval,limit:500,resolvedOnly:true});
          predictions=predictions.filter(p=>p?.features?.source==="DEV_TRADER_LIVE"&&p?.outcome);
          return send(res,200,{ok:true,predictions});
        }catch(e){return send(res,503,{ok:false,error:e.message})}
      }
      if(req.method==="GET"&&u.pathname==="/api/dev-trader/setup-memory"){
        const symbol=u.searchParams.get("symbol")||null,interval=u.searchParams.get("interval")||null;
        try{return send(res,200,{ok:true,memories:await storage.getSetupMemories({symbol,interval,limit:100})})}catch(e){return send(res,503,{ok:false,error:e.message})}
      }
      if(req.method==="POST"&&u.pathname==="/api/dev-trader/setup-memory"){
        let raw="";raw=await readLimitedBody(req);
        let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
        try{return send(res,200,{ok:true,...await storage.saveSetupMemory(body)})}catch(e){return send(res,400,{ok:false,error:e.message})}
      }
      if(req.method==="POST"&&u.pathname==="/api/dev-trader/setup-memory/deactivate"){
        let raw="";raw=await readLimitedBody(req);
        let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
        try{return send(res,200,{ok:true,...await storage.deactivateSetupMemory(body.id)})}catch(e){return send(res,400,{ok:false,error:e.message})}
      }
    }

    if(u.pathname==='/api/watchdog/internal'){
      const watchdogExpected=String(process.env.MARKETPULSE_WATCHDOG_TOKEN||"");
      const autotraderExpected=String(process.env.MARKETPULSE_AUTOTRADER_TOKEN||"");
      const supplied=String(req.headers["x-marketpulse-watchdog-token"]||"");
      const authorized=Boolean((watchdogExpected&&tokenEquals(supplied,watchdogExpected))||(autotraderExpected&&tokenEquals(supplied,autotraderExpected)));
      if(!authorized)return send(res,403,{ok:false,error:"WATCHDOG_UNAUTHORIZED"});
      const action=u.searchParams.get("action")||"status";
      try{
        if(action==="system-check"){
          const checks={server:true,marketEngine:true,learning:false,memory:false,marketData:false,derivatives:false,oi:false,cvd:false,liquidations:false,execution:false,portfolio:false,phase7:false,coreAnalytics:true,decisionEngine:false,phase11_13:false};
          const bounded=async(fn,ms)=>{
            try{
              const value=await Promise.race([
                Promise.resolve().then(fn),
                new Promise(resolve=>setTimeout(()=>resolve({__timeout:true}),ms))
              ]);
              if(value&&value.__timeout)return {ok:false,timeout:true,value:null,error:"Timed out after "+ms+"ms"};
              return {ok:true,timeout:false,value,error:null};
            }catch(e){
              return {ok:false,timeout:false,value:null,error:String(e?.message||e)};
            }
          };

          const [learningCheck,memoryCheck,marketCheck,derivativesCheck,executionCheck,portfolioCheck,phase7Check,decisionCheck,validationCheck]=await Promise.all([
            bounded(()=>learning.status(),2500),
            bounded(()=>storage.status(),1500),
            bounded(()=>klines('BTCUSDT','1h'),6000),
            bounded(()=>derivatives('BTCUSDT','15m'),2500),
            bounded(()=>execution.snapshot(),2500),
            bounded(()=>phase6.snapshot(),2500),
            bounded(()=>phase7.selfTest(),2500),
            bounded(()=>phase910.selfTest(),3500),
            bounded(()=>phase1113.selfTest(),4500)
          ]);

          checks.learning=Boolean(learningCheck.value);
          checks.memory=Boolean(memoryCheck.value);
          checks.marketData=Boolean(marketCheck.value&&marketCheck.value.length>=50);
          const d=derivativesCheck.value;
          checks.derivatives=Boolean(d&&d.available);
          checks.oi=Boolean(Number.isFinite(Number(d?.oi)));
          checks.cvd=Boolean(Number.isFinite(Number(d?.cvdDelta))||["BUYERS PRESSURE","SELLERS PRESSURE","BALANCED"].includes(d?.cvdState));
          checks.liquidations=Boolean(d&&(d.liveConnected||Number(d.livePointCount)>0||Array.isArray(d?.series?.liq)&&d.series.liq.length>1));
          checks.execution=Boolean(executionCheck.value);
          checks.portfolio=Boolean(portfolioCheck.value);
          checks.phase7=Boolean(phase7Check.value&&phase7Check.value.ok);
          checks.decisionEngine=Boolean(decisionCheck.value&&decisionCheck.value.ok);
          checks.phase11_13=Boolean(validationCheck.value&&validationCheck.value.ok);

          const marketError=marketCheck.error||null;
          const derivativesError=derivativesCheck.error||(d&&!d.available?"No derivatives provider returned usable data":null);
          return send(res,200,{
            ok:Object.values(checks).every(Boolean),
            checks,
            marketError,
            derivativesError,
            timing:{
              learningMs:learningCheck.timeout?"timeout":null,
              marketDataMs:marketCheck.timeout?"timeout":null,
              derivativesMs:derivativesCheck.timeout?"timeout":null,
              executionMs:executionCheck.timeout?"timeout":null,
              portfolioMs:portfolioCheck.timeout?"timeout":null,
              phase7Ms:phase7Check.timeout?"timeout":null,
              decisionEngineMs:decisionCheck.timeout?"timeout":null,
              phase11_13Ms:validationCheck.timeout?"timeout":null,
          phaseAuditMs:phaseAuditCheck.timeout?"timeout":null
            },
            phase16:phase16.VERSION,
            timestamp:Date.now()
          });
        }
        if(action==="autotrader-status")return send(res,200,await execution.getBotSnapshot());
        if(action==="autotrader-manage"){
          let raw="";raw=await readLimitedBody(req);
          let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
          try{
            const result=await execution.manageSimulationPositions(body.markPrices||{},body.options||{});
            return send(res,200,result);
          }catch(e){return send(res,400,{ok:false,error:e.message})}
        }
        if(action==="autotrader-execute"){
          let raw="";raw=await readLimitedBody(req);
          let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
          try{
            const snap=await execution.getBotSnapshot();
            const cfg=autotrader.normalizeConfig(snap.bot);
            const gate=autotrader.botCycleGate(snap,cfg,body.decision||null);
            if(!gate.eligible)return send(res,409,{ok:false,error:"AUTOTRADER_BLOCKED",reasons:gate.reasons,strategy:gate.strategy,autotrader:snap});
            const signal=autotrader.buildExecutionSignal(body.decision,{config:cfg,radar:body.radar||null,route:body.executionRoute||null});
            if(cfg.mode==="PAPER"&&snap.execution.mode!=="SIMULATION")return send(res,409,{ok:false,error:"BOT_EXECUTION_MODE_MISMATCH",expected:"SIMULATION",actual:snap.execution.mode});
            if(cfg.mode==="TESTNET"&&snap.execution.mode!=="TESTNET")return send(res,409,{ok:false,error:"BOT_EXECUTION_MODE_MISMATCH",expected:"TESTNET",actual:snap.execution.mode});
            if(cfg.mode==="LIVE"&&snap.execution.mode!=="LIVE")return send(res,409,{ok:false,error:"BOT_EXECUTION_MODE_MISMATCH",expected:"LIVE",actual:snap.execution.mode});
            if(String(cfg.mode||"PAPER").toUpperCase()==="LIVE"){
              let apexGate=null;
              try{
                const apexCandles=await getFastKlines(signal.symbol,signal.interval);
                const apex=phase401to500.buildState({
                  symbol:signal.symbol,interval:signal.interval,price:body?.marketState?.price??body?.decision?.price,
                  updatedAt:Date.now(),dataTs:body?.marketState?.updatedAt,candles:apexCandles,decision:body.decision,
                  radar:body.radar,marketState:body.marketState,execution:snap.execution,ticker:{price:body?.marketState?.price}
                });
                apexGate=apex.executionGate;
                if(!apexGate.automaticExecutionReady)return send(res,409,{ok:false,error:"PHASE401_LIVE_AUTO_BLOCKED",reasons:apexGate.reasons,executionGate:apexGate,autotrader:snap});
              }catch(e){return send(res,409,{ok:false,error:"PHASE401_GATE_ERROR",message:e.message,autotrader:snap})}
            }else{
              const apex=phase401to500.buildState({symbol:signal.symbol,interval:signal.interval,price:body?.marketState?.price??body?.decision?.price,updatedAt:Date.now(),dataTs:body?.marketState?.updatedAt,decision:body.decision,radar:body.radar,marketState:body.marketState,execution:snap.execution});
              if(apex.executionGate.status!=="ELIGIBLE")return send(res,409,{ok:false,error:"PHASE401_EXECUTION_BLOCKED",reasons:apex.executionGate.reasons,executionGate:apex.executionGate,autotrader:snap});
            }
            const intent=await execution.prepareFromSignal(signal);
            const order=await execution.submitIntent(intent.id);
            if(order?.status==="REJECTED"){
              await execution.recordBotError(order.rejectReason||"Execution rejected");
              return send(res,409,{ok:false,error:"AUTOTRADER_EXECUTION_REJECTED",intent,order,autotrader:await execution.getBotSnapshot()});
            }
            await execution.recordBotTradeMeta({signalKey:signal.id,decisionAt:signal.decisionAt,action:signal.side,strategy:signal.strategy,symbol:signal.symbol,interval:signal.interval});
            return send(res,200,{ok:true,signal,intent,order,autotrader:await execution.getBotSnapshot()});
          }catch(e){
            await execution.recordBotError(e.message||String(e)).catch(()=>{});
            return send(res,400,{ok:false,error:String(e.message||e),autotrader:await execution.getBotSnapshot().catch(()=>null)});
          }
        }
        if(action==="execution")return send(res,200,{ok:true,...await execution.snapshot()});
        if(action==="reconcile"){
          const snap=await execution.snapshot();
          if(snap.mode==="SIMULATION")return send(res,200,{ok:true,skipped:true,reason:"SIMULATION_MODE",execution:snap});
          return send(res,200,{ok:true,execution:await execution.reconcile()});
        }
        if(action==="kill-execution"){
          return send(res,200,{ok:true,execution:await execution.killSwitch(true)});
        }
        if(action==="reset-caches"){
          CACHE.clear();SCAN_CACHE.clear();SNAPSHOT_CACHE.clear();CORE_ANALYTICS_CACHE.clear();DECISION_CACHE.clear();DECISION_LAST_GOOD.clear();SIGNAL_STABILITY.clear();PHASE1113_CACHE.clear();
          return send(res,200,{ok:true,action:"reset-caches",at:Date.now()});
        }
        if(action==="status"){
          const now=Date.now(),cutoff=now-60000,recent=SERVER_METRICS.recentRequests.filter(x=>x.at>=cutoff);
          const recentCount=recent.length;
          const recent5xx=recent.filter(x=>x.status>=500).length;
          const recentAvgLatencyMs=recentCount?Math.round(recent.reduce((sum,x)=>sum+x.latencyMs,0)/recentCount):0;
          const recentErrorRatePct=recentCount?Number(((recent5xx/recentCount)*100).toFixed(2)):0;
          const routeCounts=Object.fromEntries(SERVER_METRICS.routeCounts.entries());
          const hotRoutes=recent.reduce((acc,x)=>{acc[x.path]=(acc[x.path]||0)+1;return acc},{}); 
          return send(res,200,{ok:true,phase16:phase16.VERSION,uptimeMs:now-SERVER_METRICS.startedAt,metrics:{
            requests:SERVER_METRICS.requests,
            errors:SERVER_METRICS.errors,
            totalLatencyMs:SERVER_METRICS.totalLatencyMs,
            avgLatencyMs:SERVER_METRICS.requests?Math.round(SERVER_METRICS.totalLatencyMs/SERVER_METRICS.requests):0,
            recent60s:{requests:recentCount,errors5xx:recent5xx,avgLatencyMs:recentAvgLatencyMs,errorRatePct:recentErrorRatePct,routeCounts:hotRoutes},
            routeCounts,
            lastErrors:SERVER_METRICS.lastErrors.slice(0,20)
          }});
        }
        return send(res,400,{ok:false,error:"UNKNOWN_WATCHDOG_ACTION"});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    const unsafe=req.method==='POST'||req.method==='PUT'||req.method==='PATCH'||req.method==='DELETE';
    if(unsafe&&!originAllowed(req))return send(res,403,{ok:false,error:"Cross-origin request blocked"});
    if(Number(req.headers["content-length"]||0)>262144)return send(res,413,{ok:false,error:"Request too large"});
    if(ADMIN_ONLY_PATHS.has(u.pathname)||ADMIN_ONLY_PREFIXES.some(prefix=>u.pathname.startsWith(prefix))){
      const guard=await auth.requireAdmin(req);
      if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
    }
    const authFastPath=(u.pathname==='/api/auth/me'||u.pathname==='/api/auth/presence')&&req.method==="GET";
    if(u.pathname==='/api/auth/me'&&req.method==="GET"){
      try{
        const user=await auth.userFromRequest(req);
        if(user?.setCookie)res.setHeader("Set-Cookie",user.setCookie);
        return send(res,200,{
          ok:true,
          authenticated:Boolean(user),
          user:user?{id:user.id,email:user.email,expiresAt:user.expiresAt,isAdmin:Boolean(user.isAdmin),adminMfaAt:user.adminMfaAt||null}:null,
          adminConfigured:auth.adminConfigured,
          mfaEnabled:auth.mfaEnabled,
          passwordPepperEnabled:auth.passwordPepperEnabled,
          sessionPersistence:storage.status()
        });
      }catch(e){return send(res,503,{ok:false,authenticated:false,error:e.message,sessionPersistence:storage.status()})}
    }

    const fastPublic=FAST_PUBLIC_PATHS.has(u.pathname)&&req.method==="GET";
    const adminCfg=fastPublic?(ADMIN_RUNTIME.config||{
      mode:"normal",maintenanceMode:false,readOnlyMode:false,registrationsEnabled:true,
      aiEnabled:true,executionEnabled:true,marketDataEnabled:true,writesEnabled:true,
      maintenanceMessage:"MarketPulse is temporarily unavailable."
    }):await getAdminRuntime();
    const userForMode=fastPublic?null:await auth.userFromRequest(req);
    if(userForMode?.setCookie)res.setHeader("Set-Cookie",userForMode.setCookie);
    const isAdminUser=Boolean(userForMode?.isAdmin);
    const publicAllowed=new Set(['/api/config','/api/auth/me','/api/auth/login','/api/auth/register','/api/auth/logout','/api/auth/presence','/api/broadcasts/active','/api/telemetry/event','/health','/']);
    if(adminCfg.maintenanceMode&&!isAdminUser&&u.pathname.startsWith('/api/')&&!publicAllowed.has(u.pathname))return send(res,503,{ok:false,error:"MAINTENANCE_MODE",maintenance:true,message:adminCfg.maintenanceMessage});
    if(adminCfg.readOnlyMode&&!isAdminUser&&unsafe&&!['/api/auth/presence','/api/telemetry/event'].includes(u.pathname))return send(res,423,{ok:false,error:"READ_ONLY_MODE",readOnly:true,message:"MarketPulse is temporarily in read-only mode."});
    if(adminCfg.registrationsEnabled===false&&u.pathname==='/api/auth/register'&& !isAdminUser)return send(res,403,{ok:false,error:"REGISTRATIONS_DISABLED"});
    if(adminCfg.aiEnabled===false&&u.pathname==='/api/ai'&&!isAdminUser)return send(res,503,{ok:false,error:"AI_DISABLED"});
    if(adminCfg.executionEnabled===false&&u.pathname.startsWith('/api/execution')&&!isAdminUser)return send(res,503,{ok:false,error:"EXECUTION_DISABLED"});
    if(adminCfg.marketDataEnabled===false&&['/api/core','/api/chart','/api/live','/api/market','/api/scanner','/api/scanner-live','/api/core-scan','/api/core-flow','/api/cycle','/api/core-analytics','/api/decision'].includes(u.pathname)&&!isAdminUser)return send(res,503,{ok:false,error:"MARKET_DATA_DISABLED"});
    if(adminCfg.writesEnabled===false&&unsafe&&!isAdminUser&&!u.pathname.startsWith('/api/auth/')&&!['/api/telemetry/event'].includes(u.pathname))return send(res,423,{ok:false,error:"WRITES_DISABLED"});
    if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'marketpulse-os',time:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/memory'){
      const access=await scopedMemoryDevice(req,u);
      if(!access.device)return send(res,access.status,{ok:false,error:access.error});
      const device=access.device;
      const mem=await storage.get(device);
      return send(res,200,{storage:mem.storage,durable:mem.storage==="postgres",payload:mem.payload,updatedAt:mem.updatedAt});
    }
    if(req.method==='POST'&&u.pathname==='/api/memory'){
      const access=await scopedMemoryDevice(req,u);
      if(!access.device)return send(res,access.status,{ok:false,error:access.error});
      const device=access.device;
      let raw="";raw=await readLimitedBody(req);
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const saved=await storage.save(device,body.memory||body);
      return send(res,200,{ok:true,storage:saved.storage,durable:saved.storage==="postgres",updatedAt:saved.updatedAt});
    }
    if(req.method==='GET'&&u.pathname==='/api/memory/status')return send(res,200,storage.status());
    if(req.method==='GET'&&u.pathname==='/api/admin/storage-health'){
      const guard=await auth.requireAdmin(req);if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
      try{return send(res,200,await storage.health())}catch(e){return send(res,503,{ok:false,mode:'unknown',connected:false,source:'Unavailable',error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/analytics'){
      const access=await scopedMemoryDevice(req,u);
      if(!access.device)return send(res,access.status,{ok:false,error:access.error});
      const device=access.device;
      try{
        const mem=await storage.get(device);
        const analytics=phase7.analyzeJournal(mem.payload?.journal||[]);
        return send(res,200,{ok:true,device,storage:mem.storage,durable:mem.storage==="postgres",analytics,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase7/health'){
      try{
        const access=await scopedMemoryDevice(req,u);
        if(!access.device)return send(res,access.status,{ok:false,error:access.error});
        const device=access.device;
        const mem=await storage.get(device);
        const analytics=phase7.analyzeJournal(mem.payload?.journal||[]);
        let marketData=false,deriv=null;
        try{const rows=await Promise.race([getKraken('BTCUSDT','1h'),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]);marketData=Boolean(rows&&rows.length>=50)}catch{}
        try{deriv=await Promise.race([derivatives('BTCUSDT','1h'),new Promise(resolve=>setTimeout(()=>resolve(null),1800))])}catch{}
        const health=phase7.qualityCheck({
          analytics,
          storage:storage.status(),
          marketData,
          derivatives:Boolean(deriv?.available)
        });
        return send(res,200,{ok:health.ok,health,analyticsQuality:analytics.quality,marketData,derivatives:deriv?.available?{provider:deriv.provider,oi:Boolean(Number.isFinite(Number(deriv.oi))),cvd:Boolean(Number.isFinite(Number(deriv.cvdDelta))),liquidations:Boolean(deriv.liquidationTotal!=null)}:null,storage:mem.storage,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    
    if(req.method==='GET'&&u.pathname==='/api/learning/status')return send(res,200,await learning.status());

    if(req.method==='POST'&&u.pathname==='/api/auth/presence'){
      const user=await auth.userFromRequest(req);
      const device=String(req.headers["x-marketpulse-device"]||"").slice(0,128);
      markLiveVisitor(device,Boolean(user));
      return send(res,200,{ok:true,online:Boolean(user),live:liveVisitorStats()});
    }
    if(req.method==='POST'&&(u.pathname==='/api/auth/register'||u.pathname==='/api/auth/login')){
      let raw="";raw=await readLimitedBody(req);
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{
        if(u.pathname==='/api/auth/register'){
          const key=authKey(clientIp(req),body.email,"register");
          const user=await auth.register(body.email,body.password,key);
          if(auth.isAdminEmail(user.email)&&auth.mfaEnabled){
            return send(res,201,{ok:true,user:{...user,isAdmin:true,mfaEnabled:true},requiresMfa:true});
          }
          const logged=await auth.login(body.email,body.password,authKey(clientIp(req),body.email,"login"),body.mfaCode);
          res.setHeader("Set-Cookie",logged.setCookie);
          return send(res,201,{ok:true,user:logged.user});
        }
        const key=authKey(clientIp(req),body.email,"login");
        const logged=await auth.login(body.email,body.password,key,body.mfaCode);
        res.setHeader("Set-Cookie",logged.setCookie);
        return send(res,200,{ok:true,user:logged.user});
      }catch(e){
        const map={
          EMAIL_EXISTS:["Unable to create an account with those details.",400],
          INVALID_CREDENTIALS:["Email or password is incorrect.",400],
          ACCOUNT_LOCKED:[e.message,423],
          AUTH_RATE_LIMIT:["Too many attempts. Please wait and try again.",429],
          ADMIN_MFA_REQUIRED:["Owner MFA code required.",401],
          ADMIN_MFA_INVALID:["Owner MFA code is incorrect or expired.",401],
          ADMIN_PERSISTENCE_UNAVAILABLE:["Owner session storage is temporarily unavailable. Persistent admin login requires the PostgreSQL database to be healthy.",503],
        };
        const pair=map[e.message]||[e.message,422];
        return send(res,pair[1],{ok:false,error:pair[0],mfaRequired:e.message==="ADMIN_MFA_REQUIRED",adminMfa:e.message.startsWith("ADMIN_MFA_")});
      }
    }
    if(req.method==='POST'&&u.pathname==='/api/auth/logout'){
      try{const x=await auth.logout(req);res.setHeader("Set-Cookie",x.setCookie);res.setHeader("Clear-Site-Data",'"cache"');return send(res,200,{ok:true})}catch(e){return send(res,500,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/users'){
      try{
        const stats=await storage.userStats();
        const users=await storage.listUsers(Math.min(500,Math.max(1,Number(u.searchParams.get('limit')||200))));
        return send(res,200,{ok:true,stats:{...stats,...liveVisitorStats()},users});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/users/')&&u.pathname.endsWith('/action')){
      const userId=u.pathname.slice('/api/admin/users/'.length,-'/action'.length);
      let raw="";raw=await readLimitedBody(req);
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{
        const guard=await auth.requireAdmin(req);
        if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
        if(userId===guard.user.id)return send(res,400,{ok:false,error:"The owner account cannot be moderated."});
        await storage.moderateUser(userId,body.action,body.durationMinutes,body.reason);
        await auditAdmin(req,(String(body.action)==="ban"?"Banned user":String(body.action)==="restrict"?"Restricted user":"Restored user"),"users",userId,{durationMinutes:body.durationMinutes||null,reason:String(body.reason||"").slice(0,200)});
        await securityEvent("warning","admin_user_moderation",(await auth.userFromRequest(req))?.email,{action:body.action,targetUserId:userId});
        return send(res,200,{ok:true});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/broadcasts/active'){
      try{const viewer=await auth.userFromRequest(req),rows=await storage.getActiveBroadcasts();return send(res,200,{ok:true,broadcasts:rows.filter(x=>x.audience==="all"||(x.audience==="registered"&&viewer))})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/telemetry/event'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{await storage.recordUsageEvent(user?.id||null,body.feature||"unknown",body.action||"view",body.symbol||null,body.interval||null,body.metadata||{});return send(res,200,{ok:true})}catch(e){return send(res,200,{ok:false})}
    }
    if(req.method==='POST'&&u.pathname==='/api/support/tickets'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{const ticket=await storage.createSupportTicket(user.id,body);await storage.recordUsageEvent(user.id,"support","ticket_created");return send(res,201,{ok:true,ticket})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/support/tickets'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      try{return send(res,200,{ok:true,tickets:(await storage.listSupportTickets(100)).filter(x=>x.userId===user.id)})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/overview'){
      const safe=async(name,fn,fallback)=>{try{return {ok:true,value:await fn()}}catch(e){return {ok:false,error:String(e.message||e),value:fallback}}};
      const [healthR,statsR,analyticsR,flagsR,configR,auditR,securityR,ticketsR,broadcastsR,snapshotsR,recentUsageR]=await Promise.all([
        safe("health",()=>storage.health(),{ok:false,source:"unavailable"}),
        safe("stats",()=>storage.userStats(),{allTime:0,today:0,week:0,month:0,liveNow:0}),
        safe("analytics",()=>storage.adminAnalytics(),{totals:{},features:[],symbols:[],intervals:[]}),
        safe("flags",()=>storage.getFeatureFlags(),{}),
        safe("config",()=>getAdminRuntime(true),{mode:"normal"}),
        safe("audit",()=>storage.listAdminAudit(20),[]),
        safe("security",()=>storage.listSecurityEvents(20),[]),
        safe("tickets",()=>storage.listSupportTickets(20),[]),
        safe("broadcasts",()=>storage.listBroadcasts(20),[]),
        safe("snapshots",()=>storage.listAdminSnapshots(20),[]),
        safe("recentUsage",()=>storage.recentUsageEvents(40),[])
      ]);
      const perf={uptimeSec:Math.floor((Date.now()-SERVER_METRICS.startedAt)/1000),requests:SERVER_METRICS.requests,errors:SERVER_METRICS.errors,avgLatencyMs:SERVER_METRICS.requests?Math.round(SERVER_METRICS.totalLatencyMs/SERVER_METRICS.requests):0,memoryMb:Math.round(process.memoryUsage().rss/1048576),heapUsedMb:Math.round(process.memoryUsage().heapUsed/1048576),cpu:process.cpuUsage(),lastErrors:SERVER_METRICS.lastErrors.slice(0,12),topRoutes:Array.from(SERVER_METRICS.routeCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([route,count])=>({route,count}))};
      const learningState=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve({state:"unknown"}),1200))]).catch(()=>({state:"unknown"}));
      const phase7Check=(()=>{try{return phase7.selfTest()}catch{return{ok:false}}})();
      const sections={health:healthR,stats:statsR,analytics:analyticsR,flags:flagsR,config:configR,audit:auditR,security:securityR,tickets:ticketsR,broadcasts:broadcastsR,snapshots:snapshotsR,recentUsage:recentUsageR};
      const values=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.value]));
      const errors=Object.fromEntries(Object.entries(sections).filter(([,v])=>!v.ok).map(([k,v])=>[k,v.error]));
      return send(res,200,{ok:Object.keys(errors).length===0,partial:Object.keys(errors).length>0,errors,...values,stats:{...(values.stats||{}),...liveVisitorStats()},learning:learningState,phase7:phase7Check,performance:perf});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/providers'){
      const probe=async(name,urls,validate)=>{
        const started=Date.now(),errors=[];
        const tasks=urls.map(async(item)=>{
          try{
            const j=await fetchJson(item.url,2500);
            if(validate&&!validate(j))throw new Error("unexpected response");
            return {host:item.host};
          }catch(e){
            errors.push(item.host+": "+String(e.message||e).slice(0,120));
            throw e;
          }
        });
        try{
          const hit=await Promise.any(tasks);
          return {name,status:"healthy",latencyMs:Date.now()-started,detail:"reachable via "+hit.host,host:hit.host};
        }catch{
          const detail=errors.slice(0,3).join(" | ")||"all endpoints failed";
          const restricted=/HTTP (401|403|451)/i.test(detail);
          return {name,status:restricted?"restricted":"error",latencyMs:Date.now()-started,detail:restricted?detail+"; network/geographic access restriction likely":detail};
        }
      };
      const items=[];
      const db=await storage.health();
      items.push({name:"PostgreSQL",status:db.connected?"healthy":"degraded",latencyMs:null,detail:db.source});
      const binanceHosts=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com'];
      items.push(await probe("Binance",binanceHosts.map(host=>({host,url:host+"/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1"})),j=>Array.isArray(j)&&j.length===1));
      items.push(await probe("Kraken",[{host:"api.kraken.com",url:"https://api.kraken.com/0/public/SystemStatus"}],j=>j?.result?.status));
      const bybitHosts=(BYBIT_HOSTS||[]).map(host=>({host,url:host+"/v5/market/time"}));
      items.push(await probe("Bybit",bybitHosts,j=>j?.retCode===0));
      items.push(await (async()=>{const t=Date.now();try{const s=await dataFabric.coinbaseSnapshot("BTCUSDT");return{name:"Coinbase Spot",status:"healthy",latencyMs:Date.now()-t,detail:"public trades reachable"}}catch(e){return{name:"Coinbase Spot",status:"error",latencyMs:Date.now()-t,detail:String(e.message||e)}}})());
      items.push({name:"OpenAI",status:OPENAI_API_KEY?"configured":"not_configured",latencyMs:null,detail:OPENAI_MODEL});
      const flow=LIVE_FLOW.get("BTCUSDT"),fresh=Boolean(flow?.lastTs&&Date.now()-flow.lastTs<120000);
      items.push({name:"Bybit Live Flow",status:fresh?"healthy":"stale",latencyMs:fresh?Date.now()-flow.lastTs:null,detail:fresh?"Live derivatives stream active":"No recent live flow event",lastEventAt:flow?.lastTs||null});
      const krakenOk=items.some(x=>x.name==="Kraken"&&x.status==="healthy");
      if(krakenOk){
        items.forEach(function(item){
          if((item.name==="Binance"||item.name==="Bybit")&&item.status==="error"){
            item.status="degraded";
            item.detail=(item.detail||"primary host unavailable")+"; fallback available";
          }
        });
      }
      const usable=items.filter(x=>["PostgreSQL","Binance","Kraken","Bybit"].includes(x.name)&&["healthy","degraded"].includes(x.status)).length;
      return send(res,200,{ok:usable>=2,providers:items,router:{usableProviders:usable,failoverEnabled:true}});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/audit')return send(res,200,{ok:true,rows:await storage.listAdminAudit(300)});
    if(req.method==='GET'&&u.pathname==='/api/admin/security')return send(res,200,{ok:true,rows:await storage.listSecurityEvents(300)});
    if(req.method==='GET'&&u.pathname==='/api/admin/analytics')return send(res,200,{ok:true,data:await storage.adminAnalytics()});
    if(req.method==='GET'&&u.pathname==='/api/admin/flags')return send(res,200,{ok:true,flags:await storage.getFeatureFlags()});
    if(req.method==='POST'&&u.pathname==='/api/admin/flags'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{const row=await storage.saveFeatureFlag(body.key,body, user.email);await auditAdmin(req,"Updated feature flag "+row.key,"feature_flags",null,{enabled:row.enabled,rolloutPct:row.rolloutPct});return send(res,200,{ok:true,flag:row})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/notifications/config'){
      await signalNotifications.ensureConfigured(storage);
      return send(res,200,{ok:true,...signalNotifications.config()});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/notifications/test'){
      try{
        const result=await signalNotifications.sendAdminTest(storage);
        await auditAdmin(req,"Sent admin push notification test","notifications",null,result);
        return send(res,result.sent?200:503,{ok:result.sent,...result});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/signal-alerts'){
      try{
        await signalNotifications.ensureConfigured(storage);
        return send(res,200,{ok:true,alerts:await storage.listAdminSignalAlerts(50),config:signalNotifications.config()})
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/notifications/subscribe'){
      let raw="";raw=await readLimitedBody(req);
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{
        const saved=await storage.saveAdminPushSubscription(body);
        await auditAdmin(req,"Enabled admin BTC signal push notifications","notifications");
        return send(res,201,{ok:true,...saved,config:signalNotifications.config()});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='DELETE'&&u.pathname==='/api/admin/notifications/subscribe'){
      const endpoint=String(u.searchParams.get('endpoint')||"");
      if(!endpoint)return send(res,400,{ok:false,error:"Subscription endpoint required"});
      try{
        await storage.deleteAdminPushSubscription(endpoint);
        await auditAdmin(req,"Disabled admin BTC signal push notifications","notifications");
        return send(res,200,{ok:true});
      }catch(e){return send(res,400,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/config')return send(res,200,{ok:true,config:await getAdminRuntime(true)});
    if(req.method==='GET'&&u.pathname==='/api/admin/intelligence-health'){
      try{const guard=await auth.requireAdmin(req);if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});const last=DECISION_LAST_GOOD.get("BTCUSDT|15m");return send(res,200,{ok:true,phase:"301-400",version:phase301to400.VERSION,automaticExecutionEnabled:false,decisionSupportOnly:true,liveSignalRuntimeGated:true,lastSnapshotId:last?.payload?.phase301to400?.canonical?.hash||null,adaptiveGate:last?.payload?.phase301to400?.gate||null,regime:last?.payload?.phase301to400?.regime||null,admin:last?.payload?.phase301to400?.adminIntelligence||null})}catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/phase-history'){
      try{
        const guard=await auth.requireAdmin(req);
        if(!guard.ok)return send(res,guard.status,{ok:false,error:guard.error});
        return send(res,200,{ok:true,currentPhase:phaseHistory.getCurrentPhase(),engineeringPhase:phaseHistory.getEngineeringPhase(),promotion:phaseHistory.getPromotionSummary(),phases:phaseHistory.getPhaseHistory()});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/config'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const current=await getAdminRuntime(true),next=Object.assign({},current,body);const saved=await storage.saveAdminConfig(next);setAdminRuntime(saved);await auditAdmin(req,"Updated Admin runtime controls","configuration",null,{changed:Object.keys(body)});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/broadcasts')return send(res,200,{ok:true,rows:await storage.listBroadcasts(100)});
    if(req.method==='POST'&&u.pathname==='/api/admin/broadcasts'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const user=await auth.userFromRequest(req);try{const row=await storage.createBroadcast(body,user.email);await auditAdmin(req,"Created broadcast","communications",null,{broadcastId:row.id,title:row.title});return send(res,201,{ok:true,row})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/broadcasts/')&&u.pathname.endsWith('/toggle')){
      const id=u.pathname.slice('/api/admin/broadcasts/'.length,-'/toggle'.length),active=String(u.searchParams.get("active"))!=="false";await storage.setBroadcastActive(id,active);await auditAdmin(req,(active?"Activated":"Deactivated")+" broadcast","communications",null,{broadcastId:id,active});return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/support')return send(res,200,{ok:true,rows:await storage.listSupportTickets(300)});
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/support/')&&u.pathname.endsWith('/reply')){
      const id=u.pathname.slice('/api/admin/support/'.length,-'/reply'.length);let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const out=await storage.replySupportTicket(id,body,auth.isAdminEmail((await auth.userFromRequest(req))?.email));await auditAdmin(req,"Replied to support ticket","support",null,{ticketId:id,status:body.status});return send(res,200,out);
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/snapshots')return send(res,200,{ok:true,rows:await storage.listAdminSnapshots(100)});
    if(req.method==='POST'&&u.pathname==='/api/admin/snapshots'){
      const user=await auth.userFromRequest(req),payload={adminConfig:await getAdminRuntime(true),featureFlags:await storage.getFeatureFlags()};const row=await storage.saveAdminSnapshot("Operational configuration snapshot",payload,user.email);await auditAdmin(req,"Created configuration snapshot","recovery",null,{snapshotId:row.id});return send(res,201,{ok:true,row,payload});
    }
    if(req.method==='POST'&&u.pathname.startsWith('/api/admin/snapshots/')&&u.pathname.endsWith('/restore')){
      const id=u.pathname.slice('/api/admin/snapshots/'.length,-'/restore'.length),snap=await storage.getAdminSnapshot(id);if(!snap)return send(res,404,{ok:false,error:"Snapshot not found"});await storage.restoreAdminConfig(snap);const saved=await storage.getAdminConfig();setAdminRuntime(saved);await auditAdmin(req,"Restored configuration snapshot","recovery",null,{snapshotId:id});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/emergency'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      const current=await getAdminRuntime(true),next=Object.assign({},current,body);const saved=await storage.saveAdminConfig(next);setAdminRuntime(saved);await auditAdmin(req,"Changed emergency control state","emergency",null,{changed:Object.keys(body)});return send(res,200,{ok:true,config:saved});
    }
    if(req.method==='GET'&&u.pathname==='/api/account/memory'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      try{
        const memory=await storage.getAccountMemory(user.id);
        return send(res,200,{ok:true,user:{id:user.id,email:user.email},memory});
      }catch(e){return send(res,500,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/account/memory'){
      const user=await auth.userFromRequest(req);if(!user)return send(res,401,{ok:false,error:"Authentication required"});
      let raw="";raw=await readLimitedBody(req);
      let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{ok:false,error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,memory:await storage.saveAccountMemory(user.id,body.memory||{})})}catch(e){return send(res,400,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/config'){const flags=await storage.getFeatureFlags();return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','30m','1h','4h','1d'],memory:storage.status(),learning:{state:'LOADING'},phase4:PHASE4_VERSION,phase5:PHASE5_VERSION,phase6:PHASE6_VERSION,phase7:PHASE7_VERSION,phase9:PHASE9_VERSION,phase10:PHASE10_VERSION,phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,phase401to500:phase401to500.VERSION,adminMode:adminCfg.mode||"normal",maintenance:adminCfg.maintenanceMode,readOnly:adminCfg.readOnlyMode,maintenanceMessage:adminCfg.maintenanceMessage,flags});}
    if(req.method==='GET'&&u.pathname==='/api/phases'){
      try{
        const phases=phaseHistory.getPhaseHistory();
        return send(res,200,{ok:true,currentPhase:phaseHistory.getCurrentPhase(),engineeringPhase:phaseHistory.getEngineeringPhase(),promotion:phaseHistory.getPromotionSummary(),phases,updatedAt:Date.now()},{'cache-control':'no-store, max-age=0'});
      }catch(e){
        return send(res,503,{ok:false,error:String(e.message||e)});
      }
    }if(req.method==='POST'&&u.pathname==='/api/ai'){
       const aiUser=await auth.userFromRequest(req);
       if(!aiUser)return send(res,401,{ok:false,error:"Authentication required"});
       // Paid AI must remain owner-only until verified users and bounded billing exist.
       if(OPENAI_API_KEY&&!aiUser.isAdmin)return send(res,403,{ok:false,error:"AI_OWNER_ONLY"});
      if(!aiAllowed(req)) return send(res,429,{error:"Slow down for a few seconds."});
      let raw=""; raw=await readLimitedBody(req); let body={}; try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const mode=body.mode==="trade"?"trade":"market";
      const q=String(body.question||"").slice(0,1800);
      const market=body.market||{}; const trade=body.trade||{}; const traderProfile=body.traderProfile||{};
      const aiAccess=await scopedMemoryDevice(req,u);
       let edgeContext={};if(aiAccess.device){try{edgeContext=await phase4.snapshot(aiAccess.device,market.symbol||"BTCUSDT",market.interval||"1h",market)||{}}catch{}}
      const profileText="PERSONAL TRADER PROFILE (descriptive, small-sample aware):\n"+JSON.stringify(traderProfile);
      const edgeText="PHASE 4 LIVE EDGE CONTEXT:\n"+JSON.stringify({
        signal:edgeContext.signal||null,
        evidence:edgeContext.evidence||null,
        risk:edgeContext.risk||null,
        paper:edgeContext.paper?{trades:edgeContext.paper.trades,winRate:edgeContext.paper.winRate,netR:edgeContext.paper.netR,realizedPnl:edgeContext.paper.realizedPnl,openRiskPct:edgeContext.paper.openRiskPct}:null,
        health:edgeContext.health||null
      });
      const userPrompt=mode==="trade"
        ? ("Review this trade plan/trade.\nMARKET CONTEXT:\n"+JSON.stringify(market)+"\nTRADE:\n"+JSON.stringify(trade)+"\n"+profileText+"\n"+edgeText+"\nUSER QUESTION:\n"+q)
        : ("Explain the current market context.\nMARKET:\n"+JSON.stringify(market)+"\n"+profileText+"\n"+edgeText+"\nUSER QUESTION:\n"+q);
      try{return send(res,200,await callOpenAI(aiSystem(),userPrompt))}
      catch(e){
        const msg=String(e.message||"AI request failed");
        if(e.message==="AI_COPILOT_NOT_CONFIGURED"||/credit|billing|quota|insufficient|model.*not.*found|unsupported.*model/i.test(msg)){
          return send(res,200,{text:liteCopilot(mode,market,trade,q),model:"MarketPulse Lite",lite:true,ts:Date.now()});
        }
        return send(res,502,{error:msg});
      }
    }
    
    if(req.method==='GET'&&u.pathname==='/api/live-sync'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      return send(res,200,liveSyncSnapshot(symbol),{"cache-control":"no-store, max-age=0"});
    }

    if(req.method==='GET'&&u.pathname==='/api/fast-ticker'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      const now=Date.now(),cached=FAST_TICKER_CACHE.get(symbol);
      if(cached&&now-cached.ts<FAST_TICKER_CACHE_TTL_MS)return send(res,200,{ok:true,...cached.payload,cached:true,cacheAgeMs:now-cached.ts});
      try{
        const live=flowBucket(symbol);
        if(Number.isFinite(Number(live.lastPrice))&&now-Number(live.lastTs||0)<10000){
          const payload={symbol,price:Number(live.lastPrice),change24h:Number.isFinite(Number(live.price24hPcnt))?Number(live.price24hPcnt):null,source:"Bybit live flow",updatedAt:now};
          FAST_TICKER_CACHE.set(symbol,{ts:now,payload});
          return send(res,200,{ok:true,...payload});
        }
        let payload=null;
        try{
          const direct=await directPublicTicker(symbol);
          payload={symbol,price:Number(direct.price),change24h:Number.isFinite(Number(direct.change24h))?Number(direct.change24h):null,source:direct.source,updatedAt:now};
        }catch{
          const snapshot=await Promise.any([
            dataFabric.krakenSnapshot(symbol),
            dataFabric.coinbaseSnapshot(symbol)
          ]);
          const price=Number(snapshot?.price);
          if(!Number.isFinite(price))throw Error('No valid public ticker price');
          payload={symbol,price,change24h:Number.isFinite(Number(snapshot?.change24h))?Number(snapshot.change24h):null,source:snapshot?.name||'market-feed',updatedAt:now};
        }
        FAST_TICKER_CACHE.set(symbol,{ts:now,payload});
        return send(res,200,{ok:true,...payload});
      }catch(e){
        if(cached)return send(res,200,{ok:true,...cached.payload,stale:true,cacheAgeMs:now-cached.ts});
        return send(res,503,{ok:false,error:String(e.message||e)});
      }
    }
    if(req.method==='GET'&&u.pathname==='/api/market-state'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const snapshot=await phase18MarketState.snapshot(symbol);
        return send(res,200,{...snapshot,health:phase18MarketState.health(snapshot),phase18:phase18MarketState.VERSION});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),phase18:phase18MarketState.VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/trade-radar'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'15m';
      if(!SYMBOLS.includes(symbol)||!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported symbol or interval'});
      const key=symbol+"|"+interval,ts=Date.now(),cached=TRADE_RADAR_CACHE.get(key);
      if(cached&&ts-cached.ts<TRADE_RADAR_TTL)return send(res,200,{...cached.payload,cache:"server",cacheAgeMs:ts-cached.ts});
      if(TRADE_RADAR_JOBS.has(key)&&cached)return send(res,200,{...cached.payload,cache:"stale",stale:true,cacheAgeMs:ts-cached.ts});
      const job=(async()=>{
        const decisionKey=symbol+"|"+interval;
        const decisionCached=DECISION_CACHE.get(decisionKey),decisionLast=DECISION_LAST_GOOD.get(decisionKey),nowRadar=Date.now();
        const recentDecision=(decisionCached&&nowRadar-decisionCached.ts<=12000)
          ?Object.assign({cache:"radar-reuse",cacheAgeMs:nowRadar-decisionCached.ts},decisionCached.payload)
          :(decisionLast&&nowRadar-decisionLast.ts<=12000)
            ?Object.assign({cache:"radar-last-good",cacheAgeMs:nowRadar-decisionLast.ts,stale:nowRadar-decisionLast.ts>DECISION_TTL},decisionLast.payload)
            :await getDecisionSnapshotCached(symbol,interval,u.searchParams,requestDevice(req));
        const [decision,marketState]=await Promise.all([
          Promise.resolve(recentDecision),
          phase18MarketState.snapshot(symbol,{fast:false,liveFlow:flowBucket(symbol)})
        ]);
        const radar=phase18Opportunity.evaluate(decision,marketState,{weekdayOnly:true,easyMode:true});
        const twinPromise=phase18Opportunity.digitalTwin(storage,decision,marketState);
        const twin=await Promise.race([
          twinPromise,
          new Promise(resolve=>setTimeout(()=>resolve({matchedStates:0,wins:0,losses:0,winRate:null,expectancyR:null,similarityTop:0,ready:false,cache:"deferred"}),700))
        ]);
        const route=phase18ExecutionRouter.choose(marketState,radar.side,"PAPER");
        return {ok:true,phase18:phase18Opportunity.VERSION,symbol,interval,generatedAt:Date.now(),decision,marketState,radar,digitalTwin:twin,executionRoute:route};
      })().finally(()=>TRADE_RADAR_JOBS.delete(key));
      TRADE_RADAR_JOBS.set(key,job);
      try{
        const payload=await Promise.race([job,new Promise(resolve=>setTimeout(()=>resolve(null),12000))]);
        if(payload){TRADE_RADAR_CACHE.set(key,{ts:Date.now(),payload});return send(res,200,payload)}
        if(cached)return send(res,200,{...cached.payload,cache:"stale",stale:true,cacheAgeMs:ts-cached.ts});
        return send(res,200,{
          ok:true,warming:true,phase18:phase18Opportunity.VERSION,symbol,interval,generatedAt:Date.now(),
          decision:{ok:true,warming:true,symbol,interval,action:"WAIT",state:"NO_TRADE",liveSignalEligible:false,market:{side:"WAIT",status:"WARMING",type:"ENGINE WARMING / NO TRADE",confluenceScore:0},levels:{entry:null,entryLow:null,entryHigh:null,stop:null,tp1:null,tp2:null,rr:null}},
          marketState:{ok:false,version:phase18MarketState.VERSION,symbol,summary:{venueCount:0,consensusQuality:0,dispersionBps:null,avgOrderbookImbalance:null},venues:[]},
          radar:{ok:true,status:"FORMING",side:"WAIT",score:0,rr:0,dataQuality:0,reasons:["RADAR_WARMING"],hardBlocks:["RADAR_WARMING"],nextAction:"WATCH",generatedAt:Date.now()},
          digitalTwin:{matchedStates:0,wins:0,losses:0,winRate:null,expectancyR:null,similarityTop:0,ready:false,cache:"deferred"},
          executionRoute:{ok:true,venue:"PAPER",reason:"Radar is warming."}
        });
      }catch(e){
        if(cached)return send(res,200,{...cached.payload,cache:"stale",stale:true,cacheAgeMs:ts-cached.ts});
        return send(res,503,{ok:false,error:String(e.message||e),phase18:phase18Opportunity.VERSION});
      }
    }
    if(req.method==='GET'&&u.pathname==='/api/decision'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol)||!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported symbol or interval'});
      try{
        const payload=await getDecisionSnapshotCached(symbol,interval,u.searchParams,requestDevice(req));
        return send(res,200,payload);
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),phase9:PHASE9_VERSION,phase10:PHASE10_VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const key=symbol+"|"+interval,nowTs=Date.now(),cached=CORE_SNAPSHOT_CACHE.get(key);
      if(cached&&nowTs-cached.ts<CORE_SNAPSHOT_TTL){
        return send(res,200,{...cached.payload,cache:"server",cacheAgeMs:nowTs-cached.ts,stale:false});
      }
      if(CORE_SNAPSHOT_JOBS.has(key)&&cached){
        return send(res,200,{...cached.payload,cache:"server-stale",cacheAgeMs:nowTs-cached.ts,stale:true});
      }
      const refresh=async()=>{
        try{
          const candles=await getFastKlines(symbol,interval);
          if(!candles||candles.length<220)throw Error('Insufficient candles');
          const analysis=analyze(candles,{interval,lower:null,higher:null,deriv:null});
          const analytics=queueCoreAnalytics(symbol,interval,candles);
          const payload={
            ok:true,symbol,interval,candles,analysis,derivatives:null,learning:null,
            backtest:analytics?.backtest||null,validation:analytics?.validation||null,setupStats:analytics?.setupStats||null,
            source:candles?.[0]?.source||'market data',dataConsensus:null,
            phase2:PHASE2_VERSION,phase3:PHASE3_VERSION,phase4:PHASE4_VERSION,
            dataQuality:{candleCount:candles.length,candleAgeMs:candles.length?Math.max(0,Date.now()-Number(candles[candles.length-1].t)):null,derivativesAvailable:false},
            updatedAt:Date.now(),performance:{fastPath:true,serverCached:true,enrichmentBackground:true,analyticsBackground:true}
          };
          CORE_SNAPSHOT_CACHE.set(key,{ts:Date.now(),payload});
          return payload;
        }finally{CORE_SNAPSHOT_JOBS.delete(key)}
      };
      const job=refresh();
      CORE_SNAPSHOT_JOBS.set(key,job);
      try{
        const payload=await Promise.race([job,new Promise((resolve)=>setTimeout(()=>resolve(null),2500))]);
        if(payload)return send(res,200,{...payload,cache:"fresh",cacheAgeMs:0,stale:false});
        if(cached)return send(res,200,{...cached.payload,cache:"server-stale",cacheAgeMs:nowTs-cached.ts,stale:true});
        // Never leave the browser staring at an empty dashboard when the first
        // provider is slow; the client already has its own last-known snapshot.
        return send(res,503,{ok:false,error:"CORE_WARMING",retryAfterMs:1200,source:"market data"});
      }catch(e){
        if(cached)return send(res,200,{...cached.payload,cache:"server-stale",cacheAgeMs:nowTs-cached.ts,stale:true});
        return send(res,503,{ok:false,error:String(e.message||e),source:'market data'});
      }
    }
    if(req.method==='GET'&&u.pathname==='/api/core-enrichment'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const base=await getFastKlines(symbol,interval);
        const [lower,higher,deriv]=await Promise.all([
          interval==='15m'?Promise.resolve(null):Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null),
          interval==='4h'?Promise.resolve(null):Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null),
          Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),2200))]).catch(()=>null)
        ]);
        let analysis=analyze(base,{interval,
          lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,
          higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,
          deriv
        });
        let learned=null;
        try{learned=await learning.process(symbol,interval,base,analysis,{observe:false})}catch{}
        // Phase 4 paper learning is updated from the final gated decision in /api/decision.
        return send(res,200,{ok:true,symbol,interval,
          analysis:learned?.analysis||analysis,
          lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,
          higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,
          derivatives:deriv,learning:learned?await learning.status().catch(()=>null):null,updatedAt:Date.now()
        });
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/core-analytics'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      if(!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported interval'});
      try{
        const key=symbol+'|'+interval,cached=CORE_ANALYTICS_CACHE.get(key);
        if(cached&&Date.now()-cached.ts<CORE_ANALYTICS_TTL)return send(res,200,{ok:true,ready:true,symbol,interval,...cached.payload,updatedAt:cached.ts});
        const candles=await getFastKlines(symbol,interval),payload=queueCoreAnalytics(symbol,interval,candles);
        if(payload)return send(res,200,{ok:true,ready:true,symbol,interval,...payload,updatedAt:Date.now()});
        return send(res,200,{ok:true,ready:false,symbol,interval,message:'Analytics are warming up.'});
      }catch(e){return send(res,503,{ok:false,ready:false,error:String(e.message||e)})}
    }

    if(req.method==='GET'&&u.pathname==='/api/validation'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      if(!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported interval'});
      try{
        const cached=PHASE1113_CACHE.get("P11-13|"+symbol+"|"+interval);
        if(cached&&Date.now()-cached.ts<PHASE1113_TTL)return send(res,200,{ok:true,ready:true,symbol,interval,...cached.payload,updatedAt:cached.ts});
        const candles=closedCandles(await getFastKlines(symbol,interval),interval,Date.now());
        const validation=queuePhase1113Validation(symbol,interval,candles);
        if(validation)return send(res,200,{ok:true,ready:true,symbol,interval,...validation,updatedAt:Date.now()});
        return send(res,200,{ok:true,ready:false,symbol,interval,message:'Validation is warming up in the background.',phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION});
      }catch(e){return send(res,503,{ok:false,ready:false,error:String(e.message||e),phase11:PHASE11_VERSION,phase12:PHASE12_VERSION,phase13:PHASE13_VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase14'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const profile=await phase14.getAdaptiveProfile(storage,{symbol,interval});
        const state=await storage.getLearningState();
        return send(res,200,{ok:true,version:"14.0.0",symbol,interval,adaptive:profile,stored:state?.payload?.phase14||null,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),version:"14.0.0"})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase15'){
      try{
        const symbol=u.searchParams.get('symbol')||null,interval=u.searchParams.get('interval')||null;
        return send(res,200,{ok:true,...await phase15.snapshot({symbol,interval,limit:5000})});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase15/audit'){
      try{
        const symbol=u.searchParams.get('symbol')||null,interval=u.searchParams.get('interval')||null,limit=Number(u.searchParams.get('limit')||200);
        return send(res,200,{ok:true,rows:await phase15.audit({symbol,interval,limit})});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/phase15/calibrate'){
      try{
        const symbol=u.searchParams.get('symbol')||null,interval=u.searchParams.get('interval')||null;
        return send(res,200,{ok:true,...await phase15.calibration({symbol,interval,limit:5000})});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/phase14/validation'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const candles=closedCandles(await getFastKlines(symbol,interval),interval,Date.now());
        const validation=queuePhase1113Validation(symbol,interval,candles);
        if(!validation)return send(res,200,{ok:true,ready:false,symbol,interval,phase14:"14.0.0",message:'Validation is warming up.'});
        return send(res,200,{ok:true,ready:true,symbol,interval,phase14:safePhase14Summary(validation),phase11_13:validation,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),version:"14.0.0"})}
    }
    if(req.method==='POST'&&u.pathname==='/api/phase14/calibrate'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const profile=await phase14.refreshAdaptiveState(storage,{symbol,interval,limit:5000});
        return send(res,200,{ok:true,version:"14.0.0",symbol,interval,profile,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),version:"14.0.0"})}
    }

    if(req.method==='GET'&&u.pathname==='/api/data-fabric'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{ok:false,error:'Unsupported symbol'});
      try{
        const candles=await getFastKlines(symbol,interval);
        const consensus=await Promise.race([
          dataFabric.assess(symbol,interval,{primaryPrice:candles?.[candles.length-1]?.c,primaryAgeMs:candles?.[candles.length-1]?.t?Date.now()-Number(candles[candles.length-1].t):null,primarySource:candles?.[0]?.source,liveFlow:flowBucket(symbol)}),
          new Promise(resolve=>setTimeout(()=>resolve(null),2500))
        ]).catch(()=>null);
        return send(res,200,{ok:Boolean(consensus),symbol,interval,consensus});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/research/catalog')return send(res,200,{ok:true,version:research.VERSION,sources:research.CATALOG,updatedAt:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/research/status')return send(res,200,{ok:true,...RESEARCH_JOB});
    if(req.method==='POST'&&u.pathname==='/api/research/train'){
      if(RESEARCH_JOB.running)return send(res,409,{ok:false,error:"RESEARCH_JOB_ALREADY_RUNNING",job:RESEARCH_JOB});
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      const bars=Math.max(300,Math.min(15000,Number(u.searchParams.get('bars')||5000)));
      RESEARCH_JOB={running:true,startedAt:Date.now(),finishedAt:null,error:null,symbol,interval,bars,records:0,trained:0,skipped:0,mode:"manual",progress:{processed:0,total:0,pct:0}};
      setImmediate(async()=>{
        try{
          const built=await research.buildReplayRecords({symbol,interval,bars,analyze,onProgress:async function(progress){RESEARCH_JOB.progress=progress}});
          RESEARCH_JOB.records=built.records.length;
          RESEARCH_JOB.progress={processed:built.bars,total:built.bars,pct:100};
          const trained=await learning.trainFromReplay(built.records);
          RESEARCH_JOB.trained=trained.trained;RESEARCH_JOB.skipped=trained.skipped;
          RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();
        }catch(e){
          RESEARCH_JOB.running=false;RESEARCH_JOB.finishedAt=Date.now();RESEARCH_JOB.error=String(e.message||e);
        }
      });
      return send(res,202,{ok:true,job:RESEARCH_JOB});
    }

    if(req.method==='GET'&&u.pathname==='/api/chart'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      const interval=u.searchParams.get('interval')||'1h';
      const allowed=['15m','30m','1h','4h','1d'];
      if(!SYMBOLS.includes(symbol)||!allowed.includes(interval))return send(res,400,{error:'Unsupported chart symbol or interval'});
      try{
        const candles=await klines(symbol,interval);
        return send(res,200,{ok:true,symbol,interval,candles:candles||[],updatedAt:Date.now(),source:candles?.[0]?.source||'market-feed'});
      }catch(e){return send(res,503,{ok:false,error:e.message||'Chart data unavailable',symbol,interval})}
    }

    if(req.method==='GET'&&u.pathname==='/api/core-flow'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const warm=mergeFlowSnapshot(symbol,{provider:"Bybit linear futures · live stream"});
        const result=await Promise.race([
          Promise.allSettled([bybitDerivatives(symbol,interval),derivatives(symbol,interval)]).then(function(rs){
            for(const r of rs){if(r.status==="fulfilled"&&r.value)return mergeFlowSnapshot(symbol,r.value)}
            return warm;
          }),
          new Promise(resolve=>setTimeout(()=>resolve(warm),6500))
        ]);
        const data=mergeFlowSnapshot(symbol,result||warm);
        data.provider=(data.provider||"Bybit linear futures")+(data.liveConnected||data.livePointCount?" · live stream":"");
        return send(res,200,{ok:true,data});
      }catch(e){
        return send(res,200,{ok:true,data:mergeFlowSnapshot(symbol,{provider:"Bybit live stream"}),error:String(e.message||e)});
      }
    }

    if(req.method==='GET'&&u.pathname==='/api/market-snapshot'){
      const interval=u.searchParams.get('interval')||'1h';
      const hit=SNAPSHOT_CACHE.get(interval);
      if(hit&&Date.now()-hit.ts<SNAPSHOT_TTL) return send(res,200,hit.payload);
      try{
        const [ticker,marketMeta]=await Promise.all([
          getReliableTickerSnapshot(SYMBOLS),
          getMarketMetadata(SYMBOLS).catch(()=>({}))
        ]);
        const rows=SYMBOLS.map(function(symbol){
          const t=ticker[symbol]||{},m=marketMeta[symbol]||{};
          return {
            symbol,label:labels[symbol]||symbol,
            price:t.price??m.geckoPrice??null,
            change24h:t.change24h??m.change24h??null,
            market:m,
            status:'SNAPSHOT',side:'WAIT',score:null
          };
        });
        const payload={ok:true,interval,rows,source:'fast-market-snapshot',updatedAt:Date.now()};
        SNAPSHOT_CACHE.set(interval,{ts:Date.now(),payload});
        // Warm metadata and deep scan in the background; never block the first paint.
        getMarketMetadata(SYMBOLS).catch(()=>{});
        queueMicrotask(()=>warmCoreScan(interval).catch(()=>{}));
        return send(res,200,payload);
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),source:'fast-market-snapshot'})}
    }

    if(req.method==='GET'&&u.pathname==='/api/core-scan'){
      const interval=u.searchParams.get('interval')||'1h';
      const deep=String(u.searchParams.get('deep')||'0')==='1';
      const cached=SCAN_CACHE.get(interval);

      if(!deep){
        if(cached&&Date.now()-cached.ts<SCAN_TTL)return send(res,200,cached.payload);
        const snap=SNAPSHOT_CACHE.get(interval);
        if(snap&&Date.now()-snap.ts<SNAPSHOT_TTL){
          queueMicrotask(()=>warmCoreScan(interval).catch(()=>{}));
          return send(res,200,{...snap.payload,mode:'snapshot-fallback'});
        }
        const [ticker,marketMeta]=await Promise.all([
          getReliableTickerSnapshot(SYMBOLS),
          getMarketMetadata(SYMBOLS).catch(()=>({}))
        ]);
        const rows=SYMBOLS.map(function(symbol){
          const t=ticker[symbol]||{},m=marketMeta[symbol]||{};
          return {symbol,label:labels[symbol]||symbol,price:t.price??m.geckoPrice??null,change24h:t.change24h??m.change24h??null,market:m,status:'SNAPSHOT',side:'WAIT',score:null};
        });
        const payload={ok:true,interval,rows,marketSource:'multi-source',updatedAt:Date.now(),cacheTtlMs:SCAN_TTL,mode:'snapshot-fallback'};
        SNAPSHOT_CACHE.set(interval,{ts:Date.now(),payload});
        queueMicrotask(()=>warmCoreScan(interval).catch(()=>{}));
        return send(res,200,payload);
      }

      try{
        await warmCoreScan(interval,true);
        const fresh=SCAN_CACHE.get(interval);
        if(fresh)return send(res,200,{...fresh.payload,mode:'deep-scan'});
        return send(res,503,{ok:false,error:'DEEP_SCAN_NOT_READY'});
      }catch(e){
        return send(res,503,{ok:false,error:String(e.message||e),mode:'deep-scan'});
      }
    }

    if(req.method==='GET'&&u.pathname==='/api/edge'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      const access=await scopedMemoryDevice(req,u);if(!access.device)return send(res,access.status,{ok:false,error:access.error});
       try{return send(res,200,await phase4.snapshot(access.device,symbol,interval,null))}catch(e){return send(res,503,{ok:false,error:"Edge state unavailable"})}
    }
    if(req.method==='GET'&&u.pathname==='/api/edge/health'){
      const access=await scopedMemoryDevice(req,u);if(!access.device)return send(res,access.status,{ok:false,error:access.error});
       try{const x=await phase4.snapshot(access.device,null,null,null);return send(res,200,{ok:true,health:x.health,paper:x.paper,personalEdge:x.personalEdge,updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:"Edge state unavailable"})}
    }
    if(req.method==='POST'&&u.pathname==='/api/edge/config'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const access=await scopedMemoryDevice(req,u);if(!access.device)return send(res,access.status,{ok:false,error:access.error});
       try{return send(res,200,await phase4.setConfig(access.device,{account:body.account,riskPct:body.riskPct,minRR:body.minRR,maxOpenRiskPct:body.maxOpenRiskPct}))}catch(e){return send(res,400,{error:"Invalid edge configuration"})}
    }
    if(req.method==='POST'&&u.pathname==='/api/edge/journal'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const access=await scopedMemoryDevice(req,u);if(!access.device)return send(res,access.status,{ok:false,error:access.error});
       try{const row=await phase4.addJournal(access.device,body.entry||body);return send(res,200,{ok:true,row})}catch(e){return send(res,400,{error:"Invalid edge journal"})}
    }
    if(req.method==='GET'&&u.pathname==='/api/edge/events'){
      const access=await scopedMemoryDevice(req,u);if(!access.device)return send(res,access.status,{ok:false,error:access.error});
       try{const x=await phase4.snapshot(access.device,null,null,null);return send(res,200,{ok:true,events:x.events||[],updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:"Edge state unavailable"})}
    }

    if(req.method==='GET'&&u.pathname==='/api/phase401-500'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'15m';
      if(!SYMBOLS.includes(symbol)||!['15m','30m','1h','4h','1d'].includes(interval))return send(res,400,{ok:false,error:'Unsupported symbol or interval'});
      try{
        const [decision,marketState,execSnap,candles]=await Promise.all([
          getDecisionSnapshotCached(symbol,interval,u.searchParams,requestDevice(req)),
          phase18MarketState.snapshot(symbol,{fast:false,liveFlow:flowBucket(symbol)}),
          execution.snapshot(),
          getFastKlines(symbol,interval)
        ]);
        const radar=phase18Opportunity.evaluate(decision,marketState,{weekdayOnly:true,easyMode:true});
        const live=flowBucket(symbol);
        const canonicalPrice=Number.isFinite(Number(live.lastPrice))
          ?Number(live.lastPrice)
          :(Number.isFinite(Number(live.markPrice))
            ?Number(live.markPrice)
            :Number.isFinite(Number(marketState?.price))
              ?Number(marketState.price)
              :Number(decision?.price));
        const apex=phase401to500.buildState({
          symbol,interval,price:canonicalPrice,updatedAt:Date.now(),
          dataTs:live.lastTs||marketState?.updatedAt,liveSeq:live.liveSeq||marketState?.seq,
          candles,decision,radar,marketState,
          ticker:{price:canonicalPrice,change24h:live.price24hPcnt,markPrice:live.markPrice},
          execution:execSnap
        });
        return send(res,200,{ok:true,symbol,interval,apex,phase401to500:phase401to500.VERSION,generatedAt:Date.now()},{'cache-control':'no-store, max-age=0'});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e),phase401to500:phase401to500.VERSION})}
    }
    if(req.method==='GET'&&u.pathname==='/api/autotrader'){
      try{
        return send(res,200,await execution.getBotSnapshot(),{"cache-control":"no-store, max-age=0"});
      }catch(e){
        return send(res,503,{ok:false,error:e.message,transient:true});
      }
    }
    if(req.method==='GET'&&u.pathname==='/api/autotrader/history'){
      try{
        const limit=Math.max(1,Math.min(Number(u.searchParams.get("limit")||100),500));
        return send(res,200,await execution.getBotTradeHistory(limit),{"cache-control":"no-store, max-age=0"});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/autotrader/config'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{
        const cfg=autotrader.normalizeConfig(body);
        if(cfg.mode==="LIVE"&&String(process.env.LIVE_TRADING_ENABLED||"false").toLowerCase()!=="true")return send(res,400,{ok:false,error:"LIVE_TRADING_ENABLED is OFF"});
        const execMode=cfg.mode==="PAPER"?"SIMULATION":cfg.mode;
        const ex=await execution.snapshot();
        if(ex.positions?.length&&String(ex.mode)!==execMode)return send(res,409,{ok:false,error:"Cannot change bot execution mode while positions are open."});
        await execution.setConfig({mode:execMode});
        return send(res,200,await execution.setBotConfig(cfg));
      }catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/autotrader/arm'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{
        const mode=String(body.mode||"TESTNET").toUpperCase();
        if(mode==="PAPER"){
          await execution.killSwitch(false);
          const bot=await execution.setBotConfig({mode:"PAPER",enabled:true});
          return send(res,200,{ok:true,mode,autotrader:bot});
        }
        if(mode==="TESTNET"){
          await execution.setConfig({mode:"TESTNET"});
          await execution.armTestnet();
          const bot=await execution.setBotConfig({mode:"TESTNET",enabled:true});
          return send(res,200,{ok:true,mode,autotrader:bot});
        }
        if(mode==="LIVE"){
          await execution.setConfig({mode:"LIVE"});
          await execution.armLive();
          const bot=await execution.setBotConfig({mode:"LIVE",enabled:true});
          return send(res,200,{ok:true,mode,autotrader:bot});
        }
        throw new Error("Unsupported AutoTrader mode");
      }catch(e){return send(res,400,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/autotrader/pause'){
      try{return send(res,200,await execution.setBotConfig({enabled:false,lastAction:"PAUSED"}))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/autotrader/kill'){
      try{await execution.setBotConfig({enabled:false,lastAction:"KILLED"});return send(res,200,await execution.killSwitch(true))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/execution'){
      try{return send(res,200,await execution.snapshot())}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/config'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await execution.setConfig({mode:body.mode,account:body.account,riskPct:body.riskPct,maxOpenRiskPct:body.maxOpenRiskPct,maxDailyLossPct:body.maxDailyLossPct,maxPositions:body.maxPositions,maxSymbolExposurePct:body.maxSymbolExposurePct,maxOrdersPerMinute:body.maxOrdersPerMinute,maxSlippageBps:body.maxSlippageBps,maxIntentAgeMs:body.maxIntentAgeMs,allowMarketOrders:false,requireReconciliation:true}))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/arm'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{
        const mode=String(body.mode||"TESTNET").toUpperCase();
        return send(res,200,{ok:true,mode,execution:mode==="LIVE"?await execution.armLive():await execution.armTestnet()});
      }catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/kill'){
      try{return send(res,200,await execution.killSwitch(true))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/reconcile'){
      try{return send(res,200,await execution.reconcile())}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/prepare'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const symbol=(body.symbol||'BTCUSDT').toUpperCase(),interval=body.interval||'1h';
      try{
        const finalDecision=await buildDecisionSnapshot(symbol,interval,u.searchParams,requestDevice(req));
        if(!finalDecision?.liveSignalEligible||finalDecision?.state!=="READY"||!["LONG","SHORT"].includes(String(finalDecision?.action||"").toUpperCase())){
          return send(res,409,{ok:false,error:"FINAL_SIGNAL_NOT_ELIGIBLE",message:"Execution preparation is allowed only from a final gated LONG/SHORT decision.",decision:finalDecision});
        }
        const signal={
          symbol,interval,side:finalDecision.action,status:"READY",score:finalDecision.market?.confluenceScore||0,
          entryLow:finalDecision.levels?.entryLow,entryHigh:finalDecision.levels?.entryHigh,entry:finalDecision.levels?.entry,
          stop:finalDecision.levels?.stop,target:finalDecision.levels?.tp1,tp2:finalDecision.levels?.tp2,rr:finalDecision.levels?.rr,
          type:finalDecision.market?.type,regime:finalDecision.market?.regime,tradeStyle:finalDecision.tradeStyle
        };
        return send(res,200,{ok:true,order:await execution.prepareFromSignal(signal),decision:finalDecision});
      }catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/intent'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.createIntent(body)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/submit'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.submitIntent(body.id)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/cancel'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,{ok:true,order:await execution.cancelOrder(body.id)})}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/execution/close-sim'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await execution.closeSimulationPosition(body.positionId,body.exitPrice))}catch(e){return send(res,400,{error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/portfolio'){
      const interval=u.searchParams.get('interval')||'1h';
      const lookback=Math.min(180,Math.max(20,Number(u.searchParams.get('lookback')||60)));
      try{
        const [sets,ex,p6]=await Promise.all([
          Promise.all(SYMBOLS.map(async sym=>({symbol:sym,candles:await klines(sym,interval)}))),
          execution.snapshot(),
          phase6.snapshot()
        ]);
        const series={};const assets=[];
        for(const row of sets){
          series[row.symbol]=row.candles||[];
          const a=analyze(row.candles||[],{interval});
          const pos=(ex.positions||[]).filter(x=>x.symbol===row.symbol);
          const ord=(ex.orders||[]).filter(x=>x.symbol===row.symbol&&!["CANCELLED","REJECTED","EXPIRED","CLOSED"].includes(x.status));
          assets.push({
            symbol:row.symbol,label:labels[row.symbol]||row.symbol,price:a.price,change24h:a.change24h,regime:a.regime,
            side:a.side,status:a.status,score:a.score,positionQty:pos.reduce((s,x)=>s+(Number(x.qty)||0),0),
            activeOrders:ord.length,exposurePct:null,riskPct:null
          });
        }
        const cfg=Object.assign({},p6.config,{account:ex.config?.account??p6.config.account});
        let portfolio=phase6.buildPortfolio(cfg,ex.positions||[],ex.orders||[],Object.fromEntries(Object.entries(series).map(([s,v])=>[s,v.slice(-(lookback+1))])));
        assets.forEach(x=>{x.exposurePct=portfolio.exposureBySymbol[x.symbol]||0;x.riskPct=portfolio.riskBySymbol[x.symbol]||0});
        portfolio=await phase6.savePortfolio(Object.assign(portfolio,{interval,lookback,assets}));
        return send(res,200,{ok:true,interval,lookback,config:cfg,assets,portfolio:portfolio.portfolio,events:portfolio.events,updatedAt:Date.now()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/portfolio/config'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      try{return send(res,200,await phase6.setConfig({
        account:body.account,maxPortfolioRiskPct:body.maxPortfolioRiskPct,maxSymbolExposurePct:body.maxSymbolExposurePct,
        maxCorrelatedClusterRiskPct:body.maxCorrelatedClusterRiskPct,correlationLookback:body.correlationLookback,
        correlationBlockThreshold:body.correlationBlockThreshold,stressMovePct:body.stressMovePct
      }))}catch(e){return send(res,400,{error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/portfolio/health'){
      try{const x=await phase6.snapshot();return send(res,200,{ok:true,config:x.config,portfolio:x.portfolio,events:x.events,updatedAt:x.updatedAt})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }

    if(req.method==='GET'&&u.pathname==='/api/replay'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h',points=Math.min(120,Math.max(12,Number(u.searchParams.get('points')||60))),bars=Math.min(4200,Math.max(240,Number(u.searchParams.get('bars')||(interval==="1d"?1800:420))));
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{return send(res,200,await buildReplayDataset(symbol,interval,{points,bars}))}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/dna/refresh'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const requestedSymbol=(body.symbol||"ALL").toUpperCase(),interval=body.interval||"1h",points=Math.min(160,Math.max(20,Number(body.points||80))),bars=Math.min(4200,Math.max(240,Number(body.bars||(interval==="1d"?1800:420))));
      const symbols=requestedSymbol==="ALL"?SYMBOLS:[requestedSymbol];
      if(symbols.some(s=>!SYMBOLS.includes(s)))return send(res,400,{error:"Unsupported symbol"});
      try{
        const datasets=await Promise.all(symbols.map(async symbol=>buildReplayDataset(symbol,interval,{points,bars}))),records=datasets.flatMap(d=>dnaRecordsFromReplay(d));
        const stored=await storage.saveSignalDNA(records);
        return send(res,200,{ok:true,symbol:requestedSymbol,interval,stored:stored.stored,storage:stored.storage,coverage:datasets.map(d=>d.coverage),summary:summarizeDNA(records),records:records.slice(-250).reverse()});
      }catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='GET'&&u.pathname==='/api/dna'){
      const symbol=u.searchParams.get('symbol')||"",interval=u.searchParams.get('interval')||"",limit=Math.min(500,Math.max(20,Number(u.searchParams.get('limit')||200)));
      try{const records=await storage.getSignalDNA({symbol: symbol||undefined,interval:interval||undefined,limit});return send(res,200,{ok:true,records,summary:summarizeDNA(records),storage:storage.status()})}catch(e){return send(res,503,{ok:false,error:e.message})}
    }
    if(req.method==='POST'&&u.pathname==='/api/dna/clear'){
      let raw="";raw=await readLimitedBody(req);let body={};try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      await storage.clearSignalDNA({symbol:body.symbol||undefined,interval:body.interval||undefined});return send(res,200,{ok:true})
    }
    if(req.method==='GET'&&u.pathname==='/api/research'){
      const symbol=u.searchParams.get('symbol')||"",interval=u.searchParams.get('interval')||"",limit=Math.min(2000,Math.max(50,Number(u.searchParams.get('limit')||800)));
      try{
        let records=await storage.getSignalDNA({symbol:symbol||undefined,interval:interval||undefined,limit});
        if(records.length<50){
          const symbols=symbol?[symbol]:SYMBOLS;
          const sets=await Promise.all(symbols.map(async sym=>{
            try{
              const ds=await buildReplayDataset(sym,interval||"1h",{points:50,bars:(interval||"1h")==="1d"?1800:420});
              return dnaRecordsFromReplay(ds);
            }catch{return[]}
          }));
          records=sets.flat();
          try{await storage.saveSignalDNA(records)}catch{}
        }
        try{await learning.trainFromReplay(records)}catch{}
        return send(res,200,{
          ok:true,
          filters:{symbol:symbol||"ALL",interval:interval||"ALL"},
          summary:summarizeDNA(records),
          records:records.slice(0,limit),
          learning:await learning.status(),
          updatedAt:Date.now()
        });
      }catch(e){
        return send(res,503,{ok:false,error:e.message});
      }
    }

    if(req.method==='GET'&&u.pathname==='/api/system-check'){
      const checks={server:true,marketEngine:true,learning:false,memory:false,marketData:false,derivatives:false,oi:false,cvd:false,liquidations:false,execution:false,portfolio:false,phase7:false,coreAnalytics:true,decisionEngine:false,phase11_13:false};
      const bounded=async(fn,ms)=>{
        try{
          const value=await Promise.race([
            Promise.resolve().then(fn),
            new Promise(resolve=>setTimeout(()=>resolve({__timeout:true}),ms))
          ]);
          if(value&&value.__timeout)return {ok:false,timeout:true,value:null,error:"Timed out after "+ms+"ms"};
          return {ok:true,timeout:false,value,error:null};
        }catch(e){
          return {ok:false,timeout:false,value:null,error:String(e?.message||e)};
        }
      };

      const [
        learningCheck,memoryCheck,marketCheck,derivativesCheck,
        executionCheck,portfolioCheck,phase7Check,decisionCheck,validationCheck,phaseAuditCheck
      ]=await Promise.all([
        bounded(()=>learning.status(),2500),
        bounded(()=>storage.status(),1500),
        bounded(()=>klines('BTCUSDT','1h'),5000),
        bounded(()=>derivatives('BTCUSDT','15m'),3000),
        bounded(()=>execution.snapshot(),2500),
        bounded(()=>phase6.snapshot(),2500),
        bounded(()=>phase7.selfTest(),2500),
        bounded(()=>phase910.selfTest(),3500),
        bounded(()=>phase1113.selfTest(),4500),
        bounded(()=>phaseAudit.run(),5000)
      ]);

      checks.learning=Boolean(learningCheck.value);
      checks.memory=Boolean(memoryCheck.value);
      checks.marketData=Boolean(marketCheck.value&&marketCheck.value.length>=50);

      const d=derivativesCheck.value;
      checks.derivatives=Boolean(d&&d.available);
      checks.oi=Boolean(Number.isFinite(Number(d?.oi)));
      checks.cvd=Boolean(Number.isFinite(Number(d?.cvdDelta))||["BUYERS PRESSURE","SELLERS PRESSURE","BALANCED"].includes(d?.cvdState));
      checks.liquidations=Boolean(
        d&&(
          d.liveConnected||
          Number(d.livePointCount)>0||
          Array.isArray(d?.series?.liq)&&d.series.liq.length>1
        )
      );

      checks.execution=Boolean(executionCheck.value);
      checks.portfolio=Boolean(portfolioCheck.value);
      checks.phase7=Boolean(phase7Check.value&&phase7Check.value.ok);
      checks.decisionEngine=Boolean(decisionCheck.value&&decisionCheck.value.ok);
      checks.phase11_13=Boolean(validationCheck.value&&validationCheck.value.ok);
      checks.phaseAudit=Boolean(phaseAuditCheck.value&&phaseAuditCheck.value.ok);

      const marketError=marketCheck.error||null;
      const derivativesError=derivativesCheck.error||(d&&!d.available?"No derivatives provider returned usable data":null);
      const result={
        ok:Object.values(checks).every(Boolean),
        checks,
        marketError,
        derivativesError,
        timing:{
          learningMs:learningCheck.timeout?"timeout":null,
          marketDataMs:marketCheck.timeout?"timeout":null,
          derivativesMs:derivativesCheck.timeout?"timeout":null,
          executionMs:executionCheck.timeout?"timeout":null,
          portfolioMs:portfolioCheck.timeout?"timeout":null,
          phase7Ms:phase7Check.timeout?"timeout":null,
          decisionEngineMs:decisionCheck.timeout?"timeout":null,
          phase11_13Ms:validationCheck.timeout?"timeout":null
        },
        phase2:PHASE2_VERSION,phase3:PHASE3_VERSION,phase4:PHASE4_VERSION,
        phase5:PHASE5_VERSION,phase6:PHASE6_VERSION,phase7:PHASE7_VERSION,
        phase9:PHASE9_VERSION,phase10:PHASE10_VERSION,phase11:PHASE11_VERSION,
        phase12:PHASE12_VERSION,phase13:PHASE13_VERSION,phaseAudit:phaseAudit.VERSION,
        routes:{
          core:true,chart:true,coreAnalytics:true,decision:true,validation:true,
          coreScan:true,coreFlow:true,cycle:true,ai:true,memory:true,learning:true,
          replay:true,dna:true,research:true,edge:true,edgeHealth:true,
          edgeConfig:true,edgeJournal:true,execution:true,executionConfig:true,
          executionArm:true,executionKill:true,executionReconcile:true,
          portfolio:true,portfolioConfig:true,phase7Analytics:true,phase7Health:true
        },
        timestamp:Date.now()
      };
      await auditAdmin(req,"Ran full system check","system",null,{ok:result.ok,checks});
      return send(res,200,result);
    }

    if(req.method==='GET'&&u.pathname==='/api/live'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      try{
        const candles=await klines(symbol,interval);
        if(!candles||candles.length<220)throw Error('Not enough market candles yet.');
        const lowerPromise=interval==='15m'?Promise.resolve(null):Promise.race([klines(symbol,'15m'),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null);
        const higherPromise=interval==='4h'?Promise.resolve(null):Promise.race([klines(symbol,'4h'),new Promise(resolve=>setTimeout(()=>resolve(null),1500))]).catch(()=>null);
        const [lower,higher]=await Promise.all([lowerPromise,higherPromise]);
        const deriv=await Promise.race([derivatives(symbol,interval),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]).catch(()=>null);
        let analysis=analyze(candles,{interval,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,deriv});
        try{const learned=await Promise.race([learning.process(symbol,interval,candles,analysis,{observe:false}),new Promise(resolve=>setTimeout(()=>resolve(null),700))]);if(learned?.analysis)analysis=learned.analysis}catch{}
        return send(res,200,{ok:true,symbol,interval,candles,analysis,derivatives:deriv,learning:{phase:2,state:'COLLECTING',durable:storage.status().durable}});
      }catch(e){return send(res,503,{ok:false,error:String(e.message||e)})}
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner-live'){
      const interval=u.searchParams.get('interval')||'1h';
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await klines(symbol,interval);
          if(!candles||candles.length<220)throw Error('insufficient candles');
          const a=analyze(candles,{interval});
          return {symbol,label:labels[symbol]||symbol,price:a.price,change24h:a.change24h,regime:a.regime,side:a.side,type:a.type,status:a.status,score:a.score,bias:a.bias,probabilityLabel:a.probabilityLabel,structure:a.structure};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message,status:'WAITING',side:'WAIT',score:0}}
      }));
      return send(res,200,{ok:true,interval,rows});
    }
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const [candles,lower,higher]=await Promise.all([
        klines(symbol,interval),
        interval==='15m'?Promise.resolve(null):klines(symbol,'15m').catch(()=>null),
        interval==='4h'?Promise.resolve(null):klines(symbol,'4h').catch(()=>null)
      ]);
      const lowerA=lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null;
      const higherA=higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null;
      const deriv=await Promise.race([
        derivatives(symbol,interval),
        new Promise(resolve=>setTimeout(()=>resolve(null),1800))
      ]).catch(()=>null);
      let analysis=analyze(candles,{interval,higher:higherA,lower:lowerA,deriv});
      let learningResult=null;
      try{learningResult=await Promise.race([learning.process(symbol,interval,candles,analysis,{observe:false}),new Promise(resolve=>setTimeout(()=>resolve(null),1500))])}catch{}
      if(learningResult?.analysis)analysis=learningResult.analysis;
      const learningStatus=await Promise.race([learning.status(),new Promise(resolve=>setTimeout(()=>resolve({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}),700))]).catch(()=>({phase:2,state:'COLLECTING',durable:storage.status().durable,resolved:0}));
      return send(res,200,{symbol,interval,candles,analysis,derivatives:deriv,learning:learningStatus,backtest:backtest(candles),validation:walkForwardBacktest(candles),setupStats:require("./market-engine").backtestBySetup(candles)});
    }
    if(req.method==='GET'&&u.pathname==='/api/cycle'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase();
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const candles=await longDailyHistory(symbol,4200);
      return send(res,200,{symbol,interval:'1d',candles,updatedAt:Date.now(),source:candles?.[0]?.source||'binance'});
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner'){
      const interval=u.searchParams.get('interval')||'1h';
      const [marketMeta,rows]=await Promise.all([
        getMarketMetadata(SYMBOLS),
        Promise.all(SYMBOLS.map(async symbol=>{
          try{
            const candles=await klines(symbol,interval);
            const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
            const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
            const deriv=await Promise.race([
              derivatives(symbol,interval),
              new Promise(resolve=>setTimeout(()=>resolve(null),2200))
            ]).catch(()=>null);
            let a=analyze(candles,{interval,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,deriv});
            a=(await learning.process(symbol,interval,candles,a,{observe:false})).analysis;
            return {symbol,label:labels[symbol]||symbol,market:marketMeta[symbol]||null,derivatives:deriv,...a};
          }catch(e){return {symbol,label:labels[symbol]||symbol,market:marketMeta[symbol]||null,error:e.message,type:"DATA ERROR",side:"WAIT",score:0,regime:"UNKNOWN"}}
        }))
      ]);
      return send(res,200,{interval,rows,marketSource:'coingecko',updatedAt:Date.now()});
    }
    return staticFile(req,res);
  }catch(e){
    if(res.headersSent){try{res.end()}catch{};return}
    const code=e?.statusCode===413?413:500;
    return send(res,code,{ok:false,error:code===413?"Request too large":"Internal server error"});
  }
});
const liveSyncWss=new WebSocket.Server({noServer:true});

server.on("upgrade",(req,socket,head)=>{
  try{
    const u=new URL(req.url||"/","http://localhost");
    if(req.headers.origin){
      const origin=new URL(req.headers.origin);
      if(origin.host!==req.headers.host){socket.destroy();return}
    }
    if(LIVE_SYNC_CLIENTS.size>=500){socket.destroy();return}
    if(u.pathname!=="/api/live-stream"){
      socket.destroy();
      return;
    }
    const symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase();
    if(!SYMBOLS.includes(symbol)){
      socket.destroy();
      return;
    }

    liveSyncWss.handleUpgrade(req,socket,head,(client)=>{
      client.symbol=symbol;
      client.connectedAt=Date.now();
      LIVE_SYNC_CLIENTS.add(client);

      try{client.send(JSON.stringify(liveSyncPushSnapshot(symbol)))}catch{}

      client.on("close",()=>LIVE_SYNC_CLIENTS.delete(client));
      client.on("error",()=>LIVE_SYNC_CLIENTS.delete(client));
      client.on("message",()=>{});
    });
  }catch{
    try{socket.destroy()}catch{}
  }
});

storage.init().then(()=>storage.dedupeDevTraderLearning()).catch(()=>{});learning.init().catch(()=>{});
server.listen(PORT,()=>{
  console.log('MarketPulse OS listening on :'+PORT);
  setTimeout(()=>{runResearchWarmup().catch(()=>{})},12000);
});