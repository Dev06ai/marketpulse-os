const http=require('http'),fs=require('fs'),path=require('path'),{analyze,backtest}=require('./market-engine');
const PORT=Number(process.env.PORT||3000);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT').split(',').map(s=>s.trim()).filter(Boolean);
const KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);
const labels={BTCUSDT:'BTC',ETHUSDT:'ETH',SOLUSDT:'SOL',BNBUSDT:'BNB',XRPUSDT:'XRP',DOGEUSDT:'DOGE',ADAUSDT:'ADA'};
const KRAKEN_PAIRS={BTCUSDT:'XBTUSD',ETHUSDT:'ETHUSD',SOLUSDT:'SOLUSD',BNBUSDT:'BNBUSD',XRPUSDT:'XRPUSD',DOGEUSDT:'DOGEUSD',ADAUSDT:'ADAUSD'};
const CACHE=new Map(); const TTL=25000;

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
function send(res,code,p){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(p))}
function staticFile(req,res){const reqPath=req.url==='/'?'/index.html':req.url.split('?')[0],file=path.join(__dirname,'public',reqPath),root=path.join(__dirname,'public');if(!file.startsWith(root))return send(res,403,{error:'Forbidden'});fs.readFile(file,(e,d)=>{if(e)return send(res,404,{error:'Not found'});const ext=path.extname(file);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8'});res.end(d)})}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'marketpulse-os',time:Date.now()});
    if(req.method==='GET'&&u.pathname==='/api/config')return send(res,200,{symbols:SYMBOLS,labels,intervals:['15m','1h','4h','1d']});
    if(req.method==='GET'&&u.pathname==='/api/market'){
      const symbol=(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase(),interval=u.searchParams.get('interval')||'1h';
      if(!SYMBOLS.includes(symbol))return send(res,400,{error:'Unsupported symbol'});
      const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
      const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
      const candles=await klines(symbol,interval);
      const lowerA=lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null;
      const higherA=higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null;
      const analysis=analyze(candles,{interval,higher:higherA,lower:lowerA});
      return send(res,200,{symbol,interval,candles,analysis,backtest:backtest(candles)});
    }
    if(req.method==='GET'&&u.pathname==='/api/scanner'){
      const interval=u.searchParams.get('interval')||'1h';
      const rows=await Promise.all(SYMBOLS.map(async symbol=>{
        try{
          const candles=await klines(symbol,interval);
          const higher=interval==='4h'?null:await klines(symbol,'4h').catch(()=>null);
          const lower=interval==='15m'?null:await klines(symbol,'15m').catch(()=>null);
          const a=analyze(candles,{interval,higher:higher&&higher.length>=220?analyze(higher,{interval:'4h'}):null,lower:lower&&lower.length>=220?analyze(lower,{interval:'15m'}):null});
          return {symbol,label:labels[symbol]||symbol,...a};
        }catch(e){return {symbol,label:labels[symbol]||symbol,error:e.message}}
      }));
      return send(res,200,{interval,rows,updatedAt:Date.now()});
    }
    return staticFile(req,res);
  }catch(e){return send(res,500,{error:e.message||'Server error'})}
});
server.listen(PORT,()=>console.log('MarketPulse OS listening on :'+PORT));