const http=require('http'),fs=require('fs'),path=require('path'),{analyze,backtest}=require('./market-engine');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=25000;
const OPENAI_API_KEY=process.env.OPENAI_API_KEY||"";
const OPENAI_MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
const AI_LIMIT_MS=8000; const AI_CALLS=new Map();

function mins(interval){return ({'15m':15,'1h':60,'4h':240,'1d':1440})[interval]||60}
async function getBinance(symbol,interval){
  const bases=['https://api.binance.com','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
  for(const base of bases){try{const u=new URL(base+'/api/v3/klines');u.searchParams.set('symbol',symbol);u.searchParams.set('interval',interval);u.searchParams.set('limit',String(Math.min(KLINE_LIMIT,1000)));const r=await fetch(u);if(r.ok){const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:'binance'}))}}catch{}}
  return null;
}
async function getKraken(symbol,interval){
  const pair=KRAKEN_PAIRS[symbol]; if(!pair)throw new Error('No Kraken mapping for '+symbol);
  const u=new URL('https://api.kraken.com/0/public/OHLC');u.searchParams.set('pair',pair);u.searchParams.set('interval',String(mins(interval)));
  const r=await fetch(u);if(!r.ok)throw new Error('Kraken returned '+r.status);const body=await r.json();if(body.error?.length)throw new Error(body.error.join(', '));
  const key=Object.keys(body.result||{}).find(k=>k!=='last');if(!key)throw new Error('Kraken returned no OHLC data');
  return (body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720)).map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:'kraken'}));
}
async function klines(symbol,interval){
  const key=symbol+'|'+interval,hit=CACHE.get(key);if(hit&&Date.now()-hit.ts<TTL)return hit.rows;
  const rows=await getBinance(symbol,interval)||await getKraken(symbol,interval);CACHE.set(key,{ts:Date.now(),rows});return rows;
}
const DERIV_CACHE=new Map(); const DERIV_TTL=15000;
function bybitInterval(interval){return ({'15m':'15min','1h':'1h','4h':'4h','1d':'1d'})[interval]||'1h'}
async function bybitGet(path,params){
  const u=new URL('https://api.bybit.com'+path); for(const [k,v] of Object.entries(params||{}))u.searchParams.set(k,String(v));
  const r=await fetch(u); if(!r.ok) throw new Error('Bybit returned '+r.status); const j=await r.json();
  if(j.retCode!==0) throw new Error(j.retMsg||('Bybit error '+j.retCode)); return j.result;
}
async function derivatives(symbol,interval){
  const key=symbol+'|'+interval,hit=DERIV_CACHE.get(key); if(hit&&Date.now()-hit.ts<DERIV_TTL)return hit.data;
  const oiPromise=bybitGet('/v5/market/open-interest',{category:'linear',symbol,intervalTime:bybitInterval(interval),limit:50});
  const tradesPromise=bybitGet('/v5/market/recent-trade',{category:'linear',symbol,limit:1000});
  const [oi,tradeResult]=await Promise.all([oiPromise,tradesPromise]);
  const oiList=(oi.list||[]).slice().reverse().map(x=>({ts:+x.timestamp,oi:+x.openInterest}));
  const trades=(tradeResult.list||[]).slice().sort((a,b)=>+a.time-+b.time).map(x=>({ts:+x.time,price:+x.price,size:+x.size,side:x.side}));
  let cvd=0,total=0; for(const t of trades){const q=t.price*t.size; cvd+=(t.side==='Buy'?q:-q);total+=q}
  const first=trades[0]?.price,lastT=trades[trades.length-1]?.price;
  const priceChangePct=Number.isFinite(first)&&first?((lastT-first)/first)*100:null;
  const oiFirst=oiList[0]?.oi,oiLast=oiList[oiList.length-1]?.oi;
  const oiChangePct=Number.isFinite(oiFirst)&&oiFirst?((oiLast-oiFirst)/oiFirst)*100:null;
  const cvdRatio=total?cvd/total:null;
  let cvdState='MIXED';
  if(priceChangePct!=null&&cvdRatio!=null){
    if(priceChangePct>0.15&&cvdRatio<-0.01)cvdState='BEARISH DIVERGENCE';
    else if(priceChangePct<-0.15&&cvdRatio>0.01)cvdState='BULLISH DIVERGENCE';
    else if(priceChangePct>0.15&&cvdRatio>0.01)cvdState='BUYERS CONFIRM';
    else if(priceChangePct<-0.15&&cvdRatio<-0.01)cvdState='SELLERS CONFIRM';
  }
  let positioning='MIXED';
  if(priceChangePct!=null&&oiChangePct!=null){
    if(priceChangePct>0.15&&oiChangePct>1)positioning='PRICE + OI: LONG PARTICIPATION';
    else if(priceChangePct>0.15&&oiChangePct<-1)positioning='PRICE UP + OI DOWN: SHORT COVERING';
    else if(priceChangePct<-0.15&&oiChangePct>1)positioning='PRICE DOWN + OI UP: SHORT PARTICIPATION';
    else if(priceChangePct<-0.15&&oiChangePct<-1)positioning='PRICE DOWN + OI DOWN: LONG LIQUIDATION';
  }
  const data={provider:'Bybit linear futures',oi:oiLast,oiChangePct,cvd,cvdRatio,cvdState,positioning,tradeCount:trades.length,tradePriceChangePct:priceChangePct,updatedAt:Date.now()};
  DERIV_CACHE.set(key,{ts:Date.now(),data}); return data;
}

function send(res,code,p){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(p))}
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
  const ip=req.headers["x-forwarded-for"]?.split(",")[0]?.trim()||req.socket.remoteAddress||"unknown";
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
  const m=market||{}, call=String(m.call||"NO TRADE"), regime=String(m.regime||"UNKNOWN"), mtf=String(m.multitimeframe||"");
  const score=Number(m.confluence||0), rsi=String(m.rsiAdx||"—"), structure=String(m.structure||"—");
  if(mode==="trade"){
    const entry=Number(trade?.entry),stop=Number(trade?.stop),target=Number(trade?.target),side=String(trade?.side||"");
    const risk=Number.isFinite(entry)&&Number.isFinite(stop)?Math.abs(entry-stop):NaN;
    const reward=Number.isFinite(entry)&&Number.isFinite(target)?Math.abs(target-entry):NaN;
    const rr=Number.isFinite(risk)&&risk?reward/risk:NaN;
    const lines=[
      "MarketPulse Lite review",
      "",
      "Market context: "+regime+" · "+call+" · confluence "+score+"/100.",
      "Momentum: RSI/ADX "+rsi+" · structure "+structure+".",
      mtf?"Timeframe context: "+mtf+".":""
    ].filter(Boolean);
    if(side)lines.push("Your plan: "+side+(Number.isFinite(rr)?" · planned R:R "+rr.toFixed(2)+"R.":""));
    if(call==="NO TRADE")lines.push("The dashboard currently sees insufficient alignment. That matters more than whether the trade eventually wins or loses.");
    else if(Number.isFinite(rr)&&rr<1.5)lines.push("Your planned R:R is below 1.5R. That makes the setup less forgiving before fees/slippage.");
    else if(Number.isFinite(rr))lines.push("Your planned R:R is "+rr.toFixed(2)+"R. Check that the invalidation is structural rather than arbitrary.");
    lines.push("Question: "+(question||"Review this trade."));
    lines.push("Note: Lite mode uses deterministic MarketPulse rules. Add API credits to unlock the full AI Copilot.");
    return lines.join("\n");
  }
  const lines=[
    "MarketPulse Lite",
    "",
    "BTC/asset context: "+regime+" · "+call+" · confluence "+score+"/100.",
    "RSI/ADX: "+rsi+" · structure: "+structure+".",
    mtf?"Multi-timeframe: "+mtf+".":"",
    call==="NO TRADE"?"Read: wait for alignment instead of forcing a trade.":"Read: treat this as a setup to validate, not a guarantee.",
    "Question: "+(question||"What is the market doing?"),
    "Full AI Copilot will be available when API credits are added."
  ].filter(Boolean);
  return lines.join("\n");
}

function staticFile(req,res){const reqPath=req.url==='/'?'/index.html':req.url.split('?')[0],file=path.join(__dirname,'public',reqPath),root=path.join(__dirname,'public');if(!file.startsWith(root))return send(res,403,{error:'Forbidden'});fs.readFile(file,(e,d)=>{if(e)return send(res,404,{error:'Not found'});const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8'});res.end(d)})}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'marketpulse-os',time:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/config')return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','1h','4h','1d']});if(req.method==='POST'&&u.pathname==='/api/ai'){
      if(!aiAllowed(req)) return send(res,429,{error:"Slow down for a few seconds."});
      let raw=""; for await(const chunk of req) raw+=chunk; let body={}; try{body=JSON.parse(raw||"{}")}catch{return send(res,400,{error:"Invalid JSON"})}
      const mode=body.mode==="trade"?"trade":"market";
      const q=String(body.question||"").slice(0,1800);
      const market=body.market||{}; const trade=body.trade||{};
      const userPrompt=mode==="trade"
        ? ("Review this trade plan/trade.\nMARKET CONTEXT:\n"+JSON.stringify(market)+"\nTRADE:\n"+JSON.stringify(trade)+"\nUSER QUESTION:\n"+q)
        : ("Explain the current market context.\nMARKET:\n"+JSON.stringify(market)+"\nUSER QUESTION:\n"+q);
      try{return send(res,200,await callOpenAI(aiSystem(),userPrompt))}
      catch(e){
        const msg=String(e.message||"AI request failed");
        if(e.message==="AI_COPILOT_NOT_CONFIGURED"||/credit|billing|quota|insufficient/i.test(msg)){
          return send(res,200,{text:liteCopilot(mode,market,trade,q),model:"MarketPulse Lite",lite:true,ts:Date.now()});
        }
        return send(res,502,{error:msg});
      }
    }
    
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
      const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
      const candles=await klines(symbol,interval);
      const lowerA=lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null;
      const higherA=higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null;
      const deriv=await derivatives(symbol,interval).catch(e=>({error:e.message,provider:"Bybit linear futures"}));
      const analysis=analyze(candles,{interval,higher:higherA,lower:lowerA,deriv});
      return send(res,200,{symbol,interval,candles,analysis,derivatives:deriv,backtest:backtest(candles),setupStats:require("./market-engine").backtestBySetup(candles)});
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner'){
      const interval=u.searchParams.get('interval')||'1h';
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await klines(symbol,interval);
          const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
          const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
          const deriv=await derivatives(symbol,interval).catch(e=>({error:e.message,provider:"Bybit linear futures"}));
          const a=analyze(candles,{interval,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null,deriv});
          return {symbol,label:labels[symbol]||symbol,derivatives:deriv,...a};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message}}
      }));
      return send(res,200,{interval,rows,updatedAt:Date.now()});
    }
    return staticFile(req,res);
  }catch(e){return send(res,500,{error:e.message||'Server error'})}
});
server.listen(PORT,()=>console.log('MarketPulse OS listening on :'+PORT));