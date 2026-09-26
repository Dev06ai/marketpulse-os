const fs=require("fs");
const path=require("path");
let Pool=null;try{Pool=require("pg").Pool}catch{}
const DB_URL=process.env.DATABASE_URL||"";
const FALLBACK_FILE=process.env.MP_MEMORY_FILE||path.join("/tmp","marketpulse-memory.json");
let pool=null;
let mode=DB_URL&&Pool?"postgres":"local";
let initPromise=null;

function validDeviceId(id){return typeof id==="string"&&/^[a-f0-9-]{16,128}$/i.test(id)}
function sanitizeMemory(m){
  const x=m&&typeof m==="object"?m:{};
  return {
    journal:Array.isArray(x.journal)?x.journal.slice(-100):[],
    signals:Array.isArray(x.signals)?x.signals.slice(-100):[],
    watch:Array.isArray(x.watch)?x.watch.slice(0,50):[],
    alertState:x.alertState&&typeof x.alertState==="object"?x.alertState:{},
    lastSignal:x.lastSignal||null,
    activeSignal:x.activeSignal||null,
    updatedAt:Date.now()
  };
}
function readLocal(){try{if(!fs.existsSync(FALLBACK_FILE))return {};return JSON.parse(fs.readFileSync(FALLBACK_FILE,"utf8"))||{}}catch{return {}}}
function writeLocal(data){try{fs.mkdirSync(path.dirname(FALLBACK_FILE),{recursive:true});fs.writeFileSync(FALLBACK_FILE,JSON.stringify(data))}catch{}}

async function init(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    if(!DB_URL||!Pool){mode="local";return}
    try{
      pool=new Pool({connectionString:DB_URL,ssl:{rejectUnauthorized:false},max:5,idleTimeoutMillis:10000});
      await pool.query("SELECT 1");
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_memory (
        device_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_learning (
        id INTEGER PRIMARY KEY DEFAULT 1,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_learning_predictions (
        fingerprint TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        candle_ts BIGINT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        score NUMERIC NOT NULL,
        price NUMERIC,
        stop NUMERIC,
        target NUMERIC,
        regime TEXT,
        features JSONB NOT NULL DEFAULT '{}'::jsonb,
        horizon_bars INTEGER NOT NULL DEFAULT 12,
        outcome TEXT,
        result_r NUMERIC,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_signal_dna (
        signal_key TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        interval TEXT NOT NULL,
        candle_ts BIGINT NOT NULL,
        status TEXT NOT NULL,
        side TEXT,
        setup_type TEXT,
        regime TEXT,
        score NUMERIC,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_dna_lookup ON marketpulse_signal_dna(symbol,interval,candle_ts DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_dna_regime ON marketpulse_signal_dna(regime,status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_learning_open ON marketpulse_learning_predictions(symbol,interval,outcome) WHERE outcome IS NULL');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_phase4 (
        device_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      mode="postgres";
    }catch(err){
      mode="local";try{await pool?.end()}catch{}pool=null;
      console.error("MarketPulse memory DB unavailable; using local fallback:",err.message);
    }
  })();
  return initPromise;
}
async function get(deviceId){
  await init();if(!validDeviceId(deviceId))throw new Error("Invalid device id");
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_memory WHERE device_id=$1",[deviceId]);
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all[deviceId]?.updatedAt||null,payload:all[deviceId]?.payload||null};
}
async function save(deviceId,memory){
  await init();if(!validDeviceId(deviceId))throw new Error("Invalid device id");
  const payload=sanitizeMemory(memory);
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_memory(device_id,payload,updated_at)
      VALUES($1,$2,NOW())
      ON CONFLICT(device_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[deviceId,payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all[deviceId]={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all[deviceId].updatedAt,payload};
}
async function clear(deviceId){
  await init();if(!validDeviceId(deviceId))throw new Error("Invalid device id");
  if(mode==="postgres"){await pool.query("DELETE FROM marketpulse_memory WHERE device_id=$1",[deviceId]);return}
  const all=readLocal();delete all[deviceId];writeLocal(all);
}
async function getLearningState(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_learning WHERE id=1");
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all.__learning__?.updatedAt||null,payload:all.__learning__?.payload||null};
}
async function saveLearningState(state){
  await init();
  const payload=state&&typeof state==="object"?state:{};
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_learning(id,payload,updated_at)
      VALUES(1,$1,NOW())
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all.__learning__={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all.__learning__.updatedAt,payload};
}
async function recordLearningPrediction(pred){
  await init();
  const p=pred||{};
  if(mode==="postgres"){
    const r=await pool.query(`INSERT INTO marketpulse_learning_predictions
      (fingerprint,symbol,interval,candle_ts,side,type,status,score,price,stop,target,regime,features,horizon_bars)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(fingerprint) DO NOTHING
      RETURNING fingerprint`,
      [p.fingerprint,p.symbol,p.interval,p.candleTs,p.side,p.type,p.status,Number(p.score)||0,p.price??null,p.stop??null,p.target??null,p.regime??null,p.features||{},Number(p.horizonBars)||12]);
    return {recorded:Boolean(r.rowCount)};
  }
  const all=readLocal(),rows=Array.isArray(all.__learning_predictions__)?all.__learning_predictions__:[];
  if(rows.some(x=>x.fingerprint===p.fingerprint))return {recorded:false};
  rows.push(Object.assign({},p,{outcome:null,resultR:null,createdAt:new Date().toISOString()}));
  all.__learning_predictions__=rows.slice(-5000);writeLocal(all);return {recorded:true};
}
async function getOpenLearningPredictions(symbol,interval,limit=200){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`SELECT fingerprint,symbol,interval,candle_ts,side,type,status,score,price,stop,target,regime,features,horizon_bars,created_at
      FROM marketpulse_learning_predictions
      WHERE outcome IS NULL AND symbol=$1 AND interval=$2
      ORDER BY candle_ts ASC LIMIT $3`,[symbol,interval,limit]);
    return r.rows;
  }
  const all=readLocal();return (Array.isArray(all.__learning_predictions__)?all.__learning_predictions__:[]).filter(x=>!x.outcome&&x.symbol===symbol&&x.interval===interval).slice(-limit);
}
async function resolveLearningPrediction(fingerprint,outcome,resultR){
  await init();
  if(mode==="postgres"){
    await pool.query(`UPDATE marketpulse_learning_predictions
      SET outcome=$2,result_r=$3,resolved_at=NOW()
      WHERE fingerprint=$1 AND outcome IS NULL`,[fingerprint,outcome,resultR]);
    return;
  }
  const all=readLocal(),rows=Array.isArray(all.__learning_predictions__)?all.__learning_predictions__:[];
  for(const x of rows)if(x.fingerprint===fingerprint&&!x.outcome){x.outcome=outcome;x.resultR=resultR;x.resolvedAt=new Date().toISOString()}
  all.__learning_predictions__=rows.slice(-5000);writeLocal(all);
}
async function saveSignalDNA(records){
  await init();const rows=Array.isArray(records)?records:[];
  if(mode==="postgres"){
    for(const p of rows){
      if(!p?.signalKey)continue;
      await pool.query(`INSERT INTO marketpulse_signal_dna
        (signal_key,symbol,interval,candle_ts,status,side,setup_type,regime,score,snapshot,outcome)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(signal_key) DO UPDATE SET snapshot=EXCLUDED.snapshot,outcome=EXCLUDED.outcome,status=EXCLUDED.status,score=EXCLUDED.score`,
        [p.signalKey,p.symbol,p.interval,Number(p.candleTs),p.status||"WAITING",p.side||null,p.type||null,p.regime||null,Number(p.score)||0,p.snapshot||{},p.outcome||{}]);
    }
    return {stored:rows.length,storage:"postgres"};
  }
  const all=readLocal(),existing=Array.isArray(all.__signal_dna__)?all.__signal_dna__:[];
  const map=new Map(existing.map(x=>[x.signalKey,x]));
  rows.forEach(x=>{if(x?.signalKey)map.set(x.signalKey,x)});
  const merged=Array.from(map.values()).sort((a,b)=>Number(b.candleTs||0)-Number(a.candleTs||0)).slice(0,20000);
  all.__signal_dna__=merged;writeLocal(all);return {stored:rows.length,storage:"local"};
}
async function getSignalDNA({symbol,interval,limit=500}={}){
  await init();const lim=Math.max(1,Math.min(Number(limit)||500,5000));
  if(mode==="postgres"){
    const params=[];let where=[];
    if(symbol){params.push(symbol);where.push(`symbol=${params.length}`)}
    if(interval){params.push(interval);where.push(`interval=${params.length}`)}
    params.push(lim);
    const q=`SELECT signal_key AS "signalKey",symbol,interval,candle_ts AS "candleTs",status,side,setup_type AS type,regime,score,snapshot,outcome,created_at AS "createdAt"
      FROM marketpulse_signal_dna ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY candle_ts DESC LIMIT ${params.length}`;
    const r=await pool.query(q,params);return r.rows;
  }
  const all=readLocal(),rows=Array.isArray(all.__signal_dna__)?all.__signal_dna__:[];
  return rows.filter(x=>(!symbol||x.symbol===symbol)&&(!interval||x.interval===interval)).sort((a,b)=>Number(b.candleTs||0)-Number(a.candleTs||0)).slice(0,lim);
}
async function clearSignalDNA({symbol,interval}={}){
  await init();
  if(mode==="postgres"){
    const params=[];let where=[];
    if(symbol){params.push(symbol);where.push(`symbol=${params.length}`)}
    if(interval){params.push(interval);where.push(`interval=${params.length}`)}
    await pool.query(`DELETE FROM marketpulse_signal_dna ${where.length?"WHERE "+where.join(" AND "):""}`,params);return;
  }
  const all=readLocal();let rows=Array.isArray(all.__signal_dna__)?all.__signal_dna__:[];rows=rows.filter(x=>(symbol&&x.symbol!==symbol)||(interval&&x.interval!==interval));all.__signal_dna__=rows;writeLocal(all);
}
async function getPhase4State(deviceId){
  await init();if(!validDeviceId(deviceId))throw new Error("Invalid device id");
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_phase4 WHERE device_id=$1",[deviceId]);
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all.__phase4__?.[deviceId]?.updatedAt||null,payload:all.__phase4__?.[deviceId]?.payload||null};
}
async function savePhase4State(deviceId,state){
  await init();if(!validDeviceId(deviceId))throw new Error("Invalid device id");
  const payload=state&&typeof state==="object"?state:{};
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_phase4(device_id,payload,updated_at)
      VALUES($1,$2,NOW())
      ON CONFLICT(device_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[deviceId,payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all.__phase4__=all.__phase4__||{};all.__phase4__[deviceId]={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all.__phase4__[deviceId].updatedAt,payload};
}

function status(){return {mode,configured:Boolean(DB_URL&&Pool),durable:mode==="postgres"}}
module.exports={init,get,save,clear,getLearningState,saveLearningState,recordLearningPrediction,getOpenLearningPredictions,resolveLearningPrediction,saveSignalDNA,getSignalDNA,clearSignalDNA,getPhase4State,savePhase4State,status};
