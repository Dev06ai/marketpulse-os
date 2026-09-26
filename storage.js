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
    preferences:x.preferences&&typeof x.preferences==="object"?x.preferences:{},
    lastSignal:x.lastSignal||null,
    activeSignal:x.activeSignal||null,
    updatedAt:Date.now()
  };
}
function readLocal(){try{if(!fs.existsSync(FALLBACK_FILE))return {};return JSON.parse(fs.readFileSync(FALLBACK_FILE,"utf8"))||{}}catch{return {}}}
function defaultAdminConfig(){
  return {
    mode:"normal",
    maintenanceMode:false,
    readOnlyMode:false,
    registrationsEnabled:true,
    aiEnabled:true,
    executionEnabled:true,
    marketDataEnabled:true,
    writesEnabled:true,
    maintenanceMessage:"MarketPulse is temporarily undergoing maintenance. Please check back shortly.",
    updatedAt:Date.now()
  };
}
function defaultFeatureFlags(){
  return {
    broadcasts_enabled:{enabled:true,rolloutPct:100,description:"User-facing admin announcements."},
    support_enabled:{enabled:true,rolloutPct:100,description:"Support and feedback workflow."},
    copilot_enabled:{enabled:true,rolloutPct:100,description:"AI Copilot access."},
    research_enabled:{enabled:true,rolloutPct:100,description:"Research workspace."},
    replay_enabled:{enabled:true,rolloutPct:100,description:"Historical replay workspace."}
  };
}
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
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_dna_lookup ON marketpulse_signal_dna(symbol,interval,candle_ts DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_dna_regime ON marketpulse_signal_dna(regime,status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_learning_open ON marketpulse_learning_predictions(symbol,interval,outcome) WHERE outcome IS NULL');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_phase4 (
        device_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_phase6 (
        id INTEGER PRIMARY KEY DEFAULT 1,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_execution (
        id INTEGER PRIMARY KEY DEFAULT 1,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        failed_login_count INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        banned_at TIMESTAMPTZ,
        banned_reason TEXT,
        restricted_until TIMESTAMPTZ,
        restriction_reason TEXT,
        last_seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS banned_reason TEXT');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS restricted_until TIMESTAMPTZ');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS restriction_reason TEXT');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE marketpulse_users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES marketpulse_users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        admin_mfa_at TIMESTAMPTZ
      )`);
      await pool.query('ALTER TABLE marketpulse_sessions ADD COLUMN IF NOT EXISTS admin_mfa_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE marketpulse_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_marketpulse_sessions_active ON marketpulse_sessions(last_seen_at,expires_at)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_marketpulse_sessions_user ON marketpulse_sessions(user_id)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_admin_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_feature_flags (
        key TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        rollout_pct NUMERIC NOT NULL DEFAULT 100,
        description TEXT NOT NULL DEFAULT '',
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_admin_audit (
        id BIGSERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'admin',
        target_user_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON marketpulse_admin_audit(created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_security_events (
        id BIGSERIAL PRIMARY KEY,
        severity TEXT NOT NULL DEFAULT 'info',
        event_type TEXT NOT NULL,
        email TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_security_events_time ON marketpulse_security_events(created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_usage_events (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID,
        feature TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'view',
        symbol TEXT,
        "interval" TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_usage_events_feature_time ON marketpulse_usage_events(feature,created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_usage_events_user_time ON marketpulse_usage_events(user_id,created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_broadcasts (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        audience TEXT NOT NULL DEFAULT 'all',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_broadcasts_active ON marketpulse_broadcasts(active,created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_support_tickets (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES marketpulse_users(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'question',
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        admin_reply TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_support_time ON marketpulse_support_tickets(status,updated_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_admin_snapshots (
        id BIGSERIAL PRIMARY KEY,
        label TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS marketpulse_account_memory (
        user_id UUID PRIMARY KEY REFERENCES marketpulse_users(id) ON DELETE CASCADE,
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
    if(symbol){params.push(symbol);where.push(`symbol=$${params.length}`)}
    if(interval){params.push(interval);where.push(`interval=$${params.length}`)}
    params.push(lim);
    const q=`SELECT signal_key AS "signalKey",symbol,interval,candle_ts AS "candleTs",status,side,setup_type AS type,regime,score,snapshot,outcome,created_at AS "createdAt"
      FROM marketpulse_signal_dna ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY candle_ts DESC LIMIT $${params.length}`;
    const r=await pool.query(q,params);return r.rows;
  }
  const all=readLocal(),rows=Array.isArray(all.__signal_dna__)?all.__signal_dna__:[];
  return rows.filter(x=>(!symbol||x.symbol===symbol)&&(!interval||x.interval===interval)).sort((a,b)=>Number(b.candleTs||0)-Number(a.candleTs||0)).slice(0,lim);
}
async function clearSignalDNA({symbol,interval}={}){
  await init();
  if(mode==="postgres"){
    const params=[];let where=[];
    if(symbol){params.push(symbol);where.push(`symbol=$${params.length}`)}
    if(interval){params.push(interval);where.push(`interval=$${params.length}`)}
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

async function getPhase6State(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_phase6 WHERE id=1");
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all.__phase6__?.updatedAt||null,payload:all.__phase6__?.payload||null};
}
async function savePhase6State(state){
  await init();
  const payload=state&&typeof state==="object"?state:{};
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_phase6(id,payload,updated_at)
      VALUES(1,$1,NOW())
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all.__phase6__={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all.__phase6__.updatedAt,payload};
}

async function getExecutionState(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_execution WHERE id=1");
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all.__execution__?.updatedAt||null,payload:all.__execution__?.payload||null};
}
async function saveExecutionState(state){
  await init();
  const payload=state&&typeof state==="object"?state:{};
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_execution(id,payload,updated_at)
      VALUES(1,$1,NOW())
      ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all.__execution__={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all.__execution__.updatedAt,payload};
}

async function createUser(user){
  await init();
  const p=user||{};
  if(mode==="postgres"){
    const r=await pool.query(
      `INSERT INTO marketpulse_users(id,email,password_hash,password_salt)
       VALUES($1,$2,$3,$4) RETURNING id,email,created_at AS "createdAt",last_login_at AS "lastLoginAt"`,
      [p.id,p.email,p.passwordHash,p.passwordSalt]
    );
    return r.rows[0];
  }
  const all=readLocal();all.__users__=all.__users__||{};
  if(Object.values(all.__users__).some(x=>String(x.email).toLowerCase()===String(p.email).toLowerCase()))throw new Error("EMAIL_EXISTS");
  const row={id:p.id,email:p.email,passwordHash:p.passwordHash,passwordSalt:p.passwordSalt,failedLoginCount:0,lockedUntil:null,createdAt:new Date().toISOString(),lastLoginAt:null,passwordUpdatedAt:new Date().toISOString()};
  all.__users__[p.id]=row;writeLocal(all);
  return {id:row.id,email:row.email,createdAt:row.createdAt,lastLoginAt:null};
}
async function findUserByEmail(email){
  await init();const e=String(email||"").toLowerCase();
  if(mode==="postgres"){
    const r=await pool.query(`SELECT id,email,password_hash AS "passwordHash",password_salt AS "passwordSalt",failed_login_count AS "failedLoginCount",locked_until AS "lockedUntil",banned_at AS "bannedAt",banned_reason AS "bannedReason",restricted_until AS "restrictedUntil",restriction_reason AS "restrictionReason",last_seen_at AS "lastSeenAt",created_at AS "createdAt",last_login_at AS "lastLoginAt",password_updated_at AS "passwordUpdatedAt" FROM marketpulse_users WHERE lower(email)=lower($1)`,[e]);
    return r.rows[0]||null;
  }
  const all=readLocal(),rows=Object.values(all.__users__||{});return rows.find(x=>String(x.email).toLowerCase()===e)||null;
}
async function recordLoginFailure(id,lockThreshold=7,lockMinutes=15){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`UPDATE marketpulse_users
      SET failed_login_count=failed_login_count+1,
          locked_until=CASE WHEN failed_login_count+1 >= $2 THEN NOW()+($3 || ' minutes')::interval ELSE locked_until END
      WHERE id=$1
      RETURNING failed_login_count AS "failedLoginCount",locked_until AS "lockedUntil"`,[id,lockThreshold,String(lockMinutes)]);
    return r.rows[0]||null;
  }
  const all=readLocal(),u=all.__users__?.[id];if(!u)return null;
  u.failedLoginCount=Number(u.failedLoginCount||0)+1;
  if(u.failedLoginCount>=lockThreshold)u.lockedUntil=new Date(Date.now()+lockMinutes*60000).toISOString();
  writeLocal(all);return {failedLoginCount:u.failedLoginCount,lockedUntil:u.lockedUntil||null};
}
async function resetLoginFailures(id){
  await init();
  if(mode==="postgres"){await pool.query("UPDATE marketpulse_users SET failed_login_count=0,locked_until=NULL,last_login_at=NOW() WHERE id=$1",[id]);return}
  const all=readLocal(),u=all.__users__?.[id];if(u){u.failedLoginCount=0;u.lockedUntil=null;u.lastLoginAt=new Date().toISOString();writeLocal(all)}
}
async function savePassword(id,passwordHash,passwordSalt){
  await init();
  if(mode==="postgres"){await pool.query("UPDATE marketpulse_users SET password_hash=$2,password_salt=$3,password_updated_at=NOW() WHERE id=$1",[id,passwordHash,passwordSalt]);return}
  const all=readLocal(),u=all.__users__?.[id];if(u){u.passwordHash=passwordHash;u.passwordSalt=passwordSalt;u.passwordUpdatedAt=new Date().toISOString();writeLocal(all)}
}
async function getUserById(id){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`SELECT id,email,created_at AS "createdAt",last_login_at AS "lastLoginAt" FROM marketpulse_users WHERE id=$1`,[id]);
    return r.rows[0]||null;
  }
  const all=readLocal(),x=all.__users__?.[id];return x?{id:x.id,email:x.email,createdAt:x.createdAt,lastLoginAt:x.lastLoginAt}:null;
}
async function touchUserLogin(id){
  await resetLoginFailures(id);
}
async function saveSession(tokenHash,userId,expiresAt,adminMfaAt=null){
  await init();
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_sessions(token_hash,user_id,expires_at,last_seen_at,admin_mfa_at) VALUES($1,$2,$3,NOW(),$4)`,[tokenHash,userId,expiresAt,adminMfaAt]);return
  }
  const all=readLocal();all.__sessions__=all.__sessions__||{};all.__sessions__[tokenHash]={userId,expiresAt,adminMfaAt,lastSeenAt:new Date().toISOString()};writeLocal(all);
  return
}
async function saveSessionLegacy(tokenHash,userId,expiresAt){
  await init();
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`,[tokenHash,userId,expiresAt]);return
  }
  const all=readLocal();all.__sessions__=all.__sessions__||{};all.__sessions__[tokenHash]={userId,expiresAt};writeLocal(all);
}
async function getSession(tokenHash){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`SELECT s.user_id AS "userId",s.expires_at AS "expiresAt",s.last_seen_at AS "lastSeenAt",s.admin_mfa_at AS "adminMfaAt",u.email,u.banned_at AS "bannedAt",u.banned_reason AS "bannedReason",u.restricted_until AS "restrictedUntil",u.restriction_reason AS "restrictionReason",u.last_seen_at AS "userLastSeenAt" FROM marketpulse_sessions s JOIN marketpulse_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`,[tokenHash]);
    return r.rows[0]||null;
  }
  const all=readLocal(),x=all.__sessions__?.[tokenHash];if(!x)return null;
  if(new Date(x.expiresAt).getTime()<=Date.now()){delete all.__sessions__[tokenHash];writeLocal(all);return null}
  const user=all.__users__?.[x.userId];return user?{userId:user.id,email:user.email,expiresAt:x.expiresAt,lastSeenAt:x.lastSeenAt||null,adminMfaAt:x.adminMfaAt||null,bannedAt:user.bannedAt||null,bannedReason:user.bannedReason||null,restrictedUntil:user.restrictedUntil||null,restrictionReason:user.restrictionReason||null,userLastSeenAt:user.lastSeenAt||null}:null;
}
async function revokeUserSessions(id){
  await init();
  if(mode==="postgres"){await pool.query("DELETE FROM marketpulse_sessions WHERE user_id=$1",[id]);return}
  const all=readLocal();for(const [k,v] of Object.entries(all.__sessions__||{}))if(v.userId===id)delete all.__sessions__[k];writeLocal(all);
}
async function deleteSession(tokenHash){
  await init();
  if(mode==="postgres"){await pool.query("DELETE FROM marketpulse_sessions WHERE token_hash=$1",[tokenHash]);return}
  const all=readLocal();if(all.__sessions__?.[tokenHash]){delete all.__sessions__[tokenHash];writeLocal(all)}
}
async function touchSessionActivity(tokenHash){
  await init();
  const now=new Date();
  if(mode==="postgres"){
    await pool.query("UPDATE marketpulse_sessions SET last_seen_at=NOW() WHERE token_hash=$1",[tokenHash]);
    await pool.query("UPDATE marketpulse_users SET last_seen_at=NOW() WHERE id=(SELECT user_id FROM marketpulse_sessions WHERE token_hash=$1)",[tokenHash]);
    return;
  }
  const all=readLocal(),x=all.__sessions__?.[tokenHash];if(!x)return;
  x.lastSeenAt=now.toISOString();
  const u=all.__users__?.[x.userId];if(u)u.lastSeenAt=now.toISOString();
  writeLocal(all);
}
async function listUsers(limit=200){
  await init();const capped=Math.min(500,Math.max(1,Number(limit)||200));
  if(mode==="postgres"){
    const r=await pool.query(`SELECT id,email,created_at AS "createdAt",last_login_at AS "lastLoginAt",last_seen_at AS "lastSeenAt",
      banned_at AS "bannedAt",banned_reason AS "bannedReason",restricted_until AS "restrictedUntil",restriction_reason AS "restrictionReason",
      failed_login_count AS "failedLoginCount"
      FROM marketpulse_users ORDER BY created_at DESC LIMIT $1`,[capped]);
    return r.rows;
  }
  const all=readLocal(),rows=Object.values(all.__users__||{}).map(u=>({id:u.id,email:u.email,createdAt:u.createdAt,lastLoginAt:u.lastLoginAt||null,lastSeenAt:u.lastSeenAt||null,bannedAt:u.bannedAt||null,bannedReason:u.bannedReason||null,restrictedUntil:u.restrictedUntil||null,restrictionReason:u.restrictionReason||null,failedLoginCount:Number(u.failedLoginCount||0)}));
  return rows.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,capped);
}
async function userStats(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`SELECT
      COUNT(*)::int AS "allTime",
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS "today",
      COUNT(*) FILTER (WHERE created_at >= date_trunc('week',NOW()))::int AS "week",
      COUNT(*) FILTER (WHERE created_at >= date_trunc('month',NOW()))::int AS "month",
      (SELECT COUNT(DISTINCT s.user_id)::int FROM marketpulse_sessions s JOIN marketpulse_users u ON u.id=s.user_id
        WHERE s.expires_at>NOW() AND s.last_seen_at >= NOW()-INTERVAL '2 minutes'
          AND u.banned_at IS NULL AND (u.restricted_until IS NULL OR u.restricted_until<=NOW())) AS "liveNow"
      FROM marketpulse_users`);
    return r.rows[0];
  }
  const all=readLocal(),users=Object.values(all.__users__||{}),now=Date.now();
  const start=new Date();start.setHours(0,0,0,0);
  const dayStart=start.getTime(),weekStart=dayStart-((start.getDay()+6)%7)*86400000,monthStart=new Date(start.getFullYear(),start.getMonth(),1).getTime();
  const live=new Set();
  Object.values(all.__sessions__||{}).forEach(s=>{if(new Date(s.expiresAt).getTime()>now&&new Date(s.lastSeenAt||0).getTime()>=now-120000)live.add(s.userId)});
  return {allTime:users.length,today:users.filter(u=>new Date(u.createdAt).getTime()>=dayStart).length,week:users.filter(u=>new Date(u.createdAt).getTime()>=weekStart).length,month:users.filter(u=>new Date(u.createdAt).getTime()>=monthStart).length,liveNow:Array.from(live).filter(id=>{const u=all.__users__?.[id];return u&&!u.bannedAt&&(!u.restrictedUntil||new Date(u.restrictedUntil).getTime()<=now)}).length};
}
async function moderateUser(userId,action,durationMinutes,reason){
  await init();
  const id=String(userId||""),act=String(action||"").toLowerCase(),msg=String(reason||"").slice(0,300)||null;
  if(mode==="postgres"){
    if(act==="ban"){
      await pool.query("UPDATE marketpulse_users SET banned_at=NOW(),banned_reason=$2,restricted_until=NULL,restriction_reason=NULL WHERE id=$1",[id,msg]);
      await pool.query("DELETE FROM marketpulse_sessions WHERE user_id=$1",[id]);
    }else if(act==="restrict"){
      const mins=Math.max(5,Math.min(43200,Number(durationMinutes)||60));
      await pool.query("UPDATE marketpulse_users SET restricted_until=NOW()+($2 || ' minutes')::interval,restriction_reason=$3,banned_at=NULL,banned_reason=NULL WHERE id=$1",[id,String(mins),msg]);
      await pool.query("DELETE FROM marketpulse_sessions WHERE user_id=$1",[id]);
    }else if(act==="unban"||act==="unrestrict"||act==="restore"){
      await pool.query("UPDATE marketpulse_users SET banned_at=NULL,banned_reason=NULL,restricted_until=NULL,restriction_reason=NULL WHERE id=$1",[id]);
    }else throw new Error("Unsupported moderation action");
    return;
  }
  const all=readLocal(),u=all.__users__?.[id];if(!u)throw new Error("User not found");
  if(act==="ban"){u.bannedAt=new Date().toISOString();u.bannedReason=msg;u.restrictedUntil=null;u.restrictionReason=null}
  else if(act==="restrict"){const mins=Math.max(5,Math.min(43200,Number(durationMinutes)||60));u.restrictedUntil=new Date(Date.now()+mins*60000).toISOString();u.restrictionReason=msg;u.bannedAt=null;u.bannedReason=null}
  else if(act==="unban"||act==="unrestrict"||act==="restore"){u.bannedAt=null;u.bannedReason=null;u.restrictedUntil=null;u.restrictionReason=null}
  else throw new Error("Unsupported moderation action");
  for(const [k,v] of Object.entries(all.__sessions__||{}))if(v.userId===id)delete all.__sessions__[k];
  writeLocal(all);
}
async function getAccountMemory(userId){
  await init();
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_account_memory WHERE user_id=$1",[userId]);
    return r.rows[0]?{storage:"postgres",updatedAt:r.rows[0].updated_at,payload:r.rows[0].payload}:{storage:"postgres",updatedAt:null,payload:null};
  }
  const all=readLocal();return {storage:"local",updatedAt:all.__account_memory__?.[userId]?.updatedAt||null,payload:all.__account_memory__?.[userId]?.payload||null};
}
async function saveAccountMemory(userId,memory){
  await init();const payload=sanitizeMemory(memory);
  if(mode==="postgres"){
    await pool.query(`INSERT INTO marketpulse_account_memory(user_id,payload,updated_at) VALUES($1,$2,NOW())
      ON CONFLICT(user_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[userId,payload]);
    return {storage:"postgres",updatedAt:new Date().toISOString(),payload};
  }
  const all=readLocal();all.__account_memory__=all.__account_memory__||{};all.__account_memory__[userId]={payload,updatedAt:new Date().toISOString()};writeLocal(all);
  return {storage:"local",updatedAt:all.__account_memory__[userId].updatedAt,payload};
}

async function health(){
  await init();
  if(mode==="postgres"&&pool){
    try{
      await pool.query("SELECT 1");
      return {ok:true,mode:"postgres",configured:true,durable:true,connected:true,source:"PostgreSQL"};
    }catch(e){
      mode="local";
      try{await pool?.end()}catch{}
      pool=null;
      return {ok:false,mode:"local",configured:Boolean(DB_URL&&Pool),durable:false,connected:false,source:"Local fallback",error:String(e.message||e)};
    }
  }
  return {ok:true,mode:"local",configured:Boolean(DB_URL&&Pool),durable:false,connected:false,source:"Local fallback"};
}
function status(){return {mode,configured:Boolean(DB_URL&&Pool),durable:mode==="postgres"}}
async function getAdminConfig(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query("SELECT payload,updated_at FROM marketpulse_admin_config WHERE id=1");
    return r.rows[0]?(r.rows[0].payload||{}):defaultAdminConfig();
  }
  const all=readLocal();return all.__admin_config__?.payload||defaultAdminConfig();
}
async function saveAdminConfig(payload){
  await init();const next=Object.assign(defaultAdminConfig(),payload||{}, {updatedAt:Date.now()});
  if(mode==="postgres"){await pool.query(`INSERT INTO marketpulse_admin_config(id,payload,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`,[next]);return next}
  const all=readLocal();all.__admin_config__={payload:next,updatedAt:new Date().toISOString()};writeLocal(all);return next;
}
async function getFeatureFlags(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query('SELECT key,enabled,"rollout_pct" AS "rolloutPct",description,"updated_by" AS "updatedBy",updated_at AS "updatedAt" FROM marketpulse_feature_flags ORDER BY key');
    const out=defaultFeatureFlags();for(const row of r.rows)out[row.key]=row;return out;
  }
  const all=readLocal(),out=defaultFeatureFlags();Object.assign(out,all.__feature_flags__||{});return out;
}
async function saveFeatureFlag(key,value,adminEmail){
  await init();const k=String(key||"").trim().slice(0,80);if(!/^[a-z0-9_.-]+$/i.test(k))throw new Error("Invalid feature flag key");
  const row={enabled:Boolean(value?.enabled),rolloutPct:Math.max(0,Math.min(100,Number(value?.rolloutPct??100))),description:String(value?.description||"").slice(0,300),updatedBy:String(adminEmail||"").slice(0,200),updatedAt:new Date().toISOString()};
  if(mode==="postgres"){await pool.query(`INSERT INTO marketpulse_feature_flags(key,enabled,rollout_pct,description,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(key) DO UPDATE SET enabled=EXCLUDED.enabled,rollout_pct=EXCLUDED.rollout_pct,description=EXCLUDED.description,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[k,row.enabled,row.rolloutPct,row.description,row.updatedBy]);return {key,...row}}
  const all=readLocal();all.__feature_flags__=all.__feature_flags__||{};all.__feature_flags__[k]={key,...row};writeLocal(all);return {key,...row};
}
async function recordAdminAudit(adminEmail,action,category="admin",targetUserId=null,metadata={}){
  await init();
  const safe={...metadata};delete safe.password;delete safe.passwordHash;delete safe.passwordSalt;delete safe.totp;delete safe.secret;
  if(mode==="postgres"){await pool.query("INSERT INTO marketpulse_admin_audit(admin_email,action,category,target_user_id,metadata) VALUES($1,$2,$3,$4,$5)",[String(adminEmail||"").slice(0,200),String(action||"").slice(0,200),String(category||"admin").slice(0,80),targetUserId||null,safe]);return}
  const all=readLocal();all.__admin_audit__=Array.isArray(all.__admin_audit__)?all.__admin_audit__:[];all.__admin_audit__.push({id:Date.now()+"-"+Math.random().toString(16).slice(2),adminEmail,action,category,targetUserId,metadata:safe,createdAt:new Date().toISOString()});all.__admin_audit__=all.__admin_audit__.slice(-2000);writeLocal(all);
}
async function listAdminAudit(limit=200){
  await init();const n=Math.min(500,Math.max(1,Number(limit)||200));
  if(mode==="postgres"){const r=await pool.query(`SELECT id,admin_email AS "adminEmail",action,category,target_user_id AS "targetUserId",metadata,created_at AS "createdAt" FROM marketpulse_admin_audit ORDER BY created_at DESC LIMIT $1`,[n]);return r.rows}
  const all=readLocal();return (all.__admin_audit__||[]).slice(-n).reverse();
}
async function recordSecurityEvent(severity,eventType,email,metadata={}){
  await init();const safe={...metadata};delete safe.password;delete safe.passwordHash;delete safe.passwordSalt;delete safe.totp;delete safe.secret;
  if(mode==="postgres"){await pool.query("INSERT INTO marketpulse_security_events(severity,event_type,email,metadata) VALUES($1,$2,$3,$4)",[String(severity||"info"),String(eventType||"event"),email?String(email).slice(0,200):null,safe]);return}
  const all=readLocal();all.__security_events__=Array.isArray(all.__security_events__)?all.__security_events__:[];all.__security_events__.push({severity,eventType,email,metadata:safe,createdAt:new Date().toISOString()});all.__security_events__=all.__security_events__.slice(-2000);writeLocal(all);
}
async function listSecurityEvents(limit=200){
  await init();const n=Math.min(500,Math.max(1,Number(limit)||200));
  if(mode==="postgres"){const r=await pool.query(`SELECT id,severity,event_type AS "eventType",email,metadata,created_at AS "createdAt" FROM marketpulse_security_events ORDER BY created_at DESC LIMIT $1`,[n]);return r.rows}
  const all=readLocal();return (all.__security_events__||[]).slice(-n).reverse();
}
async function recordUsageEvent(userId,feature,action="view",symbol=null,interval=null,metadata={}){
  await init();const row={userId:userId||null,feature:String(feature||"unknown").slice(0,100),action:String(action||"view").slice(0,100),symbol:symbol?String(symbol).slice(0,32):null,interval:interval?String(interval).slice(0,16):null,metadata:metadata||{},createdAt:new Date().toISOString()};
  if(mode==="postgres"){await pool.query('INSERT INTO marketpulse_usage_events(user_id,feature,action,symbol,"interval",metadata) VALUES($1,$2,$3,$4,$5,$6)',[row.userId,row.feature,row.action,row.symbol,row.interval,row.metadata]);return}
  const all=readLocal();all.__usage_events__=Array.isArray(all.__usage_events__)?all.__usage_events__:[];all.__usage_events__.push(row);all.__usage_events__=all.__usage_events__.slice(-5000);writeLocal(all);
}
async function recentUsageEvents(limit=80){
  await init();const n=Math.min(200,Math.max(1,Number(limit)||80));
  if(mode==="postgres"){
    const r=await pool.query(`SELECT e.id,e.feature,e.action,e.symbol,e."interval",e.created_at AS "createdAt",u.email FROM marketpulse_usage_events e LEFT JOIN marketpulse_users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT $1`,[n]);return r.rows;
  }
  const all=readLocal(),users=all.__users__||{},rows=(all.__usage_events__||[]).slice(-n).reverse();
  return rows.map(x=>({...x,email:x.userId?(users[x.userId]?.email||null):null}));
}
async function adminAnalytics(){
  await init();
  if(mode==="postgres"){
    const r=await pool.query(`
      WITH totals AS (
        SELECT
          COUNT(*)::int AS "allTime",
          COUNT(*) FILTER (WHERE created_at>=CURRENT_DATE)::int AS "today",
          COUNT(*) FILTER (WHERE created_at>=date_trunc('week',NOW()))::int AS "week",
          COUNT(*) FILTER (WHERE created_at>=date_trunc('month',NOW()))::int AS "month",
          COUNT(*) FILTER (WHERE last_seen_at>=NOW()-INTERVAL '24 hours')::int AS "activeDay",
          COUNT(*) FILTER (WHERE last_seen_at>=NOW()-INTERVAL '7 days')::int AS "activeWeek",
          COUNT(*) FILTER (WHERE last_seen_at>=NOW()-INTERVAL '30 days')::int AS "activeMonth"
        FROM marketpulse_users
      ),
      feature_usage AS (
        SELECT feature, COUNT(*)::int AS "count"
        FROM marketpulse_usage_events
        WHERE created_at>=NOW()-INTERVAL '30 days'
        GROUP BY feature
        ORDER BY COUNT(*) DESC
        LIMIT 12
      ),
      symbol_usage AS (
        SELECT COALESCE(symbol,'UNKNOWN') AS "symbol", COUNT(*)::int AS "count"
        FROM marketpulse_usage_events
        WHERE created_at>=NOW()-INTERVAL '30 days' AND symbol IS NOT NULL
        GROUP BY symbol
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ),
      interval_usage AS (
        SELECT COALESCE(e."interval",'UNKNOWN') AS "interval", COUNT(*)::int AS "count"
        FROM marketpulse_usage_events e
        WHERE e.created_at>=NOW()-INTERVAL '30 days' AND e."interval" IS NOT NULL
        GROUP BY e."interval"
        ORDER BY COUNT(*) DESC
        LIMIT 10
      )
      SELECT
        (SELECT row_to_json(totals) FROM totals) AS "totals",
        (SELECT COALESCE(json_agg(feature_usage), '[]'::json) FROM feature_usage) AS "features",
        (SELECT COALESCE(json_agg(symbol_usage), '[]'::json) FROM symbol_usage) AS "symbols",
        (SELECT COALESCE(json_agg(interval_usage), '[]'::json) FROM interval_usage) AS "intervals"
    `);
    const row=r.rows[0]||{};
    return {totals:row.totals||{},features:row.features||[],symbols:row.symbols||[],intervals:row.intervals||[]};
  }
  const all=readLocal(),users=Object.values(all.__users__||{}),ev=all.__usage_events__||[],now=Date.now();
  const start=new Date();start.setHours(0,0,0,0);
  const day=start.getTime(),week=day-((start.getDay()+6)%7)*86400000,month=new Date(start.getFullYear(),start.getMonth(),1).getTime();
  const countFrom=ms=>users.filter(u=>new Date(u.createdAt).getTime()>=ms).length;
  const active=ms=>users.filter(u=>u.lastSeenAt&&new Date(u.lastSeenAt).getTime()>=ms).length;
  const aggregate=k=>Object.entries(
    ev.filter(e=>new Date(e.createdAt).getTime()>=now-30*86400000)
      .reduce((m,e)=>{const v=e[k]||"UNKNOWN";m[v]=(m[v]||0)+1;return m}, {})
  ).map(([key,count])=>({[k]:key,count})).sort((a,b)=>b.count-a.count).slice(0,12);
  return {
    totals:{
      allTime:users.length,today:countFrom(day),week:countFrom(week),month:countFrom(month),
      activeDay:active(now-86400000),activeWeek:active(now-7*86400000),activeMonth:active(now-30*86400000)
    },
    features:aggregate("feature"),
    symbols:aggregate("symbol"),
    intervals:aggregate("interval")
  };
}
async function listBroadcasts(limit=100){
  await init();const n=Math.min(200,Math.max(1,Number(limit)||100));
  if(mode==="postgres"){const r=await pool.query(`SELECT id,title,body,audience,active,expires_at AS "expiresAt",created_by AS "createdBy",created_at AS "createdAt" FROM marketpulse_broadcasts ORDER BY created_at DESC LIMIT $1`,[n]);return r.rows}
  const all=readLocal();return (all.__broadcasts__||[]).slice(-n).reverse();
}
async function createBroadcast(data,adminEmail){
  await init();const d=data||{},row={title:String(d.title||"").slice(0,140),body:String(d.body||"").slice(0,2000),audience:String(d.audience||"all").slice(0,30),active:d.active!==false,expiresAt:d.expiresAt||null,createdBy:String(adminEmail||"").slice(0,200),createdAt:new Date().toISOString()};
  if(!row.title||!row.body)throw new Error("Broadcast title and body are required");
  if(mode==="postgres"){const r=await pool.query("INSERT INTO marketpulse_broadcasts(title,body,audience,active,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,body,audience,active,expires_at AS \"expiresAt\",created_by AS \"createdBy\",created_at AS \"createdAt\"",[row.title,row.body,row.audience,row.active,row.expiresAt,row.createdBy]);return r.rows[0]}
  const all=readLocal();all.__broadcasts__=Array.isArray(all.__broadcasts__)?all.__broadcasts__:[];row.id=Date.now();all.__broadcasts__.push(row);writeLocal(all);return row;
}
async function setBroadcastActive(id,active){
  await init();
  if(mode==="postgres"){await pool.query("UPDATE marketpulse_broadcasts SET active=$2 WHERE id=$1",[id,Boolean(active)]);return}
  const all=readLocal(),b=(all.__broadcasts__||[]).find(x=>String(x.id)===String(id));if(b){b.active=Boolean(active);writeLocal(all)}
}
async function getActiveBroadcasts(){
  await init();
  if(mode==="postgres"){const r=await pool.query(`SELECT id,title,body,audience,expires_at AS "expiresAt",created_at AS "createdAt" FROM marketpulse_broadcasts WHERE active=true AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 8`);return r.rows}
  const now=Date.now(),all=readLocal();return (all.__broadcasts__||[]).filter(x=>x.active&&(!x.expiresAt||new Date(x.expiresAt).getTime()>now)).slice(-8).reverse();
}
async function createSupportTicket(userId,data){
  await init();const d=data||{},row={userId,category:String(d.category||"question").slice(0,40),subject:String(d.subject||"").slice(0,160),message:String(d.message||"").slice(0,4000)};
  if(!row.subject||!row.message)throw new Error("Subject and message are required");
  if(mode==="postgres"){const r=await pool.query(`INSERT INTO marketpulse_support_tickets(user_id,category,subject,message) VALUES($1,$2,$3,$4) RETURNING id,user_id AS "userId",category,subject,message,status,admin_reply AS "adminReply",created_at AS "createdAt",updated_at AS "updatedAt",resolved_at AS "resolvedAt"`,[row.userId,row.category,row.subject,row.message]);return r.rows[0]}
  const all=readLocal();all.__support__=Array.isArray(all.__support__)?all.__support__:[];const out={id:Date.now(),...row,status:"open",adminReply:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),resolvedAt:null};all.__support__.push(out);writeLocal(all);return out;
}
async function listSupportTickets(limit=100,status=null){
  await init();const n=Math.min(300,Math.max(1,Number(limit)||100));
  if(mode==="postgres"){const args=[],where=[];if(status){args.push(status);where.push("t.status=$"+args.length)}args.push(n);const r=await pool.query(`SELECT t.id,t.user_id AS "userId",u.email, t.category,t.subject,t.message,t.status,t.admin_reply AS "adminReply",t.created_at AS "createdAt",t.updated_at AS "updatedAt",t.resolved_at AS "resolvedAt" FROM marketpulse_support_tickets t JOIN marketpulse_users u ON u.id=t.user_id ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY t.updated_at DESC LIMIT $${args.length}`,args);return r.rows}
  const all=readLocal();let rows=(all.__support__||[]).slice().reverse();if(status)rows=rows.filter(x=>x.status===status);const users=all.__users__||{};return rows.slice(0,n).map(x=>({...x,email:users[x.userId]?.email||"Unknown"}));
}
async function replySupportTicket(id,data,adminEmail){
  await init();const reply=String(data?.reply||"").slice(0,4000),status=String(data?.status||"resolved").slice(0,30);if(!reply&&status!=="resolved")throw new Error("Reply is required");
  if(mode==="postgres"){const r=await pool.query(`UPDATE marketpulse_support_tickets SET admin_reply=CASE WHEN $2='' THEN admin_reply ELSE $2 END,status=$3,updated_at=NOW(),resolved_at=CASE WHEN $3='resolved' THEN NOW() ELSE resolved_at END WHERE id=$1 RETURNING id`,[id,reply,status]);if(!r.rowCount)throw new Error("Ticket not found");return {ok:true}}
  const all=readLocal(),t=(all.__support__||[]).find(x=>String(x.id)===String(id));if(!t)throw new Error("Ticket not found");if(reply)t.adminReply=reply;t.status=status;t.updatedAt=new Date().toISOString();if(status==="resolved")t.resolvedAt=new Date().toISOString();writeLocal(all);return{ok:true};
}
async function saveAdminSnapshot(label,payload,adminEmail){
  await init();const safe=payload&&typeof payload==="object"?payload:{};if(mode==="postgres"){const r=await pool.query("INSERT INTO marketpulse_admin_snapshots(label,payload,created_by) VALUES($1,$2,$3) RETURNING id,label,created_by AS \"createdBy\",created_at AS \"createdAt\",payload",[String(label||"Snapshot").slice(0,120),safe,String(adminEmail||"").slice(0,200)]);return r.rows[0]}const all=readLocal();all.__admin_snapshots__=Array.isArray(all.__admin_snapshots__)?all.__admin_snapshots__:[];const row={id:Date.now(),label:String(label||"Snapshot"),payload:safe,createdBy:adminEmail,createdAt:new Date().toISOString()};all.__admin_snapshots__.push(row);writeLocal(all);return row;
}
async function listAdminSnapshots(limit=50){
  await init();const n=Math.min(100,Math.max(1,Number(limit)||50));if(mode==="postgres"){const r=await pool.query(`SELECT id,label,created_by AS "createdBy",created_at AS "createdAt" FROM marketpulse_admin_snapshots ORDER BY created_at DESC LIMIT $1`,[n]);return r.rows}
  const all=readLocal();return (all.__admin_snapshots__||[]).slice(-n).reverse().map(x=>({id:x.id,label:x.label,createdBy:x.createdBy,createdAt:x.createdAt}));
}
async function getAdminSnapshot(id){
  await init();if(mode==="postgres"){const r=await pool.query("SELECT id,label,payload,created_by AS \"createdBy\",created_at AS \"createdAt\" FROM marketpulse_admin_snapshots WHERE id=$1",[id]);return r.rows[0]||null}
  const all=readLocal();return (all.__admin_snapshots__||[]).find(x=>String(x.id)===String(id))||null;
}
async function restoreAdminConfig(snapshot){
  const payload=snapshot?.payload||{};if(payload.adminConfig)await saveAdminConfig(payload.adminConfig);
  if(payload.featureFlags)for(const [k,v] of Object.entries(payload.featureFlags))await saveFeatureFlag(k,v,payload.createdBy||"restore");
  return true;
}

module.exports={init,health,get,save,clear,getLearningState,saveLearningState,recordLearningPrediction,getOpenLearningPredictions,resolveLearningPrediction,saveSignalDNA,getSignalDNA,clearSignalDNA,getPhase4State,savePhase4State,getExecutionState,saveExecutionState,getPhase6State,savePhase6State,createUser,findUserByEmail,getUserById,touchUserLogin,recordLoginFailure,resetLoginFailures,savePassword,saveSession,getSession,touchSessionActivity,revokeUserSessions,deleteSession,listUsers,userStats,moderateUser,getAccountMemory,saveAccountMemory,status,getAdminConfig,saveAdminConfig,getFeatureFlags,saveFeatureFlag,recordAdminAudit,listAdminAudit,recordSecurityEvent,listSecurityEvents,recordUsageEvent,adminAnalytics,listBroadcasts,createBroadcast,setBroadcastActive,getActiveBroadcasts,createSupportTicket,recentUsageEvents,listSupportTickets,replySupportTicket,saveAdminSnapshot,listAdminSnapshots,getAdminSnapshot,restoreAdminConfig};
