const http=require("http"),fs=require("fs"),path=require("path"),{analyze,backtest}=require("./market-engine");const PORT=Number(process.env.PORT||3000),SYMBOLS=(process.env.SYMBOLS||"BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT").split(",").map(x=>x.trim()).filter(Boolean),KLINE_LIMIT=Number(process.env.KLINE_LIMIT||420);const labels={BTCUSDT:"BTC",ETHUSDT:"ETH",SOLUSDT:"SOL",BNBUSDT:"BNB",XRPUSDT:"XRP",DOGEUSDT:"DOGE",ADAUSDT:"ADA"};const KRAKEN_PAIRS={BTCUSDT:"XBTUSD",ETHUSDT:"ETHUSD",SOLUSDT:"SOLUSD",BNBUSDT:"BNBUSD",XRPUSDT:"XRPUSD",DOGEUSDT:"DOGEUSD",ADAUSDT:"ADAUSD"};\n
function intervalMinutes(interval){return ({ "15m":15, "1h":60, "4h":240, "1d":1440 })[interval]||60}
async function getBinance(symbol,interval){
  const endpoints=["https://api.binance.com","https://api-gcp.binance.com","https://api1.binance.com","https://api2.binance.com","https://api3.binance.com","https://api4.binance.com"];
  for(const base of endpoints){
    try{
      const u=new URL(base+"/api/v3/klines");
      u.searchParams.set("symbol",symbol);u.searchParams.set("interval",interval);u.searchParams.set("limit",String(Math.min(KLINE_LIMIT,1000)));
      const r=await fetch(u);
      if(r.ok){const rows=await r.json();return rows.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],source:"binance"}))}
      if(r.status!==451) continue;
    }catch{}
  }
  return null;
}
async function getKraken(symbol,interval){
  const pair=KRAKEN_PAIRS[symbol];
  if(!pair) throw new Error("No market-data provider mapping for "+symbol);
  const u=new URL("https://api.kraken.com/0/public/OHLC");
  u.searchParams.set("pair",pair);u.searchParams.set("interval",String(intervalMinutes(interval)));
  const r=await fetch(u);
  if(!r.ok) throw new Error("Kraken returned "+r.status);
  const body=await r.json();
  if(body.error&&body.error.length) throw new Error(body.error.join(", "));
  const key=Object.keys(body.result).find(k=>k!=="last");
  const rows=(body.result[key]||[]).slice(-Math.min(KLINE_LIMIT,720));
  return rows.map(x=>({t:+x[0]*1000,o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[6],source:"kraken"}));
}
async function klines(symbol,interval){
  const binance=await getBinance(symbol,interval);
  return binance||await getKraken(symbol,interval);
}
function send(res,code,p){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*"});res.end(JSON.stringify(p))}function staticFile(req,res){const s=req.url==="/" ? "/index.html" : req.url.split("?")[0],f=path.join(__dirname,"public",s);if(!f.startsWith(path.join(__dirname,"public")))return send(res,403,{error:"Forbidden"});fs.readFile(f,(e,d)=>{if(e)return send(res,404,{error:"Not found"});res.writeHead(200,{"Content-Type":path.extname(f)===".html"?"text/html; charset=utf-8":"text/plain; charset=utf-8"});res.end(d)})}http.createServer(async(req,res)=>{try{const u=new URL(req.url,"http://localhost");if(req.method==="GET"&&u.pathname==="/health")return send(res,200,{ok:true,service:"marketpulse-os"});if(req.method==="GET"&&u.pathname==="/api/config")return send(res,200,{symbols:SYMBOLS,labels,intervals:["15m","1h","4h","1d"]});if(req.method==="GET"&&u.pathname==="/api/market"){const symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h";if(!SYMBOLS.includes(symbol))return send(res,400,{error:"Unsupported symbol"});const candles=await klines(symbol,interval);return send(res,200,{symbol,interval,candles,analysis:analyze(candles),backtest:backtest(candles)})}if(req.method==="GET"&&u.pathname==="/api/scanner"){const interval=u.searchParams.get("interval")||"1h",rows=[];for(const symbol of SYMBOLS){try{const candles=await klines(symbol,interval);rows.push({symbol,label:labels[symbol]||symbol,...analyze(candles)})}catch(e){rows.push({symbol,label:labels[symbol]||symbol,error:e.message})}}return send(res,200,{interval,rows,updatedAt:Date.now()})}return staticFile(req,res)}catch(e){send(res,500,{error:e.message||"Server error"})}}).listen(PORT,()=>console.log("MarketPulse OS listening on :"+PORT));
