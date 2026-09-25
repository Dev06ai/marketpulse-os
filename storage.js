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
function status(){return {mode,configured:Boolean(DB_URL&&Pool),durable:mode==="postgres"}}
module.exports={init,get,save,clear,status};
