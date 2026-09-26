const crypto=require("crypto");
const storage=require("./storage");
const totp=require("./totp");

const SESSION_DAYS=Math.max(1,Number(process.env.MARKETPULSE_SESSION_DAYS||30));
const ADMIN_SESSION_HOURS=Math.max(1,Number(process.env.MARKETPULSE_ADMIN_SESSION_HOURS||8));
const COOKIE="mp_session";
const ADMIN_EMAIL=String(process.env.MARKETPULSE_ADMIN_EMAIL||"").trim().toLowerCase();
const PASSWORD_PEPPER=String(process.env.MARKETPULSE_PASSWORD_PEPPER||"");
const RATE_WINDOW_MS=15*60*1000;
const RATE_LIMIT=12;
const rate=new Map();
const DUMMY_SALT=crypto.createHash("sha256").update("marketpulse-dummy-salt-v2").digest("hex");

function normalizeEmail(email){return String(email||"").trim().toLowerCase()}
function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
function passwordRules(password){
  const p=String(password||"");
  if(p.length<12)return "Password must be at least 12 characters.";
  if(p.length>256)return "Password is too long.";
  return null;
}
function isAdminEmail(email){return Boolean(ADMIN_EMAIL&&normalizeEmail(email)===ADMIN_EMAIL)}
function hashInput(password,usePepper){
  if(!usePepper||!PASSWORD_PEPPER)return Buffer.from(String(password));
  return crypto.createHmac("sha256",PASSWORD_PEPPER).update(String(password)).digest();
}
function parseSalt(salt){
  const raw=String(salt||"");
  if(!raw.startsWith("v2$"))return {version:1,N:16384,r:8,p:1,pepper:false,salt:raw};
  const parts=raw.split("$");
  return {version:2,N:Number(parts[1])||32768,r:Number(parts[2])||8,p:Number(parts[3])||3,pepper:parts[4]==="1",salt:parts[5]||""};
}
function hashPassword(password,saltMeta){
  const meta=saltMeta||{version:2,N:32768,r:8,p:3,pepper:Boolean(PASSWORD_PEPPER)};
  const buf=hashInput(password,meta.pepper);
  return crypto.scryptSync(buf,Buffer.from(meta.salt,"hex"),64,{N:meta.N,r:meta.r,p:meta.p,maxmem:256*1024*1024}).toString("hex");
}
function newPassword(password){
  const salt=crypto.randomBytes(16).toString("hex");
  const meta={version:2,N:32768,r:8,p:3,pepper:Boolean(PASSWORD_PEPPER),salt};
  return {salt:"v2$"+meta.N+"$"+meta.r+"$"+meta.p+"$"+(meta.pepper?1:0)+"$"+salt,hash:hashPassword(password,meta)};
}
function token(){return crypto.randomBytes(32).toString("hex")}
function hashToken(raw){return crypto.createHash("sha256").update(String(raw)).digest("hex")}
function parseCookies(header){
  const out={};String(header||"").split(";").forEach(part=>{const i=part.indexOf("=");if(i<0)return;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();if(k)out[k]=decodeURIComponent(v)});return out;
}
function cookie(raw,maxAge){
  const insecure=String(process.env.MARKETPULSE_ALLOW_INSECURE_HTTP||"").toLowerCase()==="true";
  const secure=insecure?"":" Secure;";
  return COOKIE+"="+encodeURIComponent(raw)+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+Math.max(0,Math.floor(maxAge||0))+";"+secure;
}
function clearCookie(){return cookie("",0)}
function rateCheck(key){
  const now=Date.now(),x=rate.get(key);
  if(!x||now-x.started>RATE_WINDOW_MS){rate.set(key,{started:now,count:1});return}
  if(x.count>=RATE_LIMIT)throw new Error("AUTH_RATE_LIMIT");
  x.count++;
}
function loginKey(reqLike,email,type){return type+":"+String(reqLike||"unknown")+":"+normalizeEmail(email)}
function lockMessage(until){
  const mins=Math.max(1,Math.ceil((new Date(until).getTime()-Date.now())/60000));
  return "Account temporarily locked after repeated failed attempts. Try again in about "+mins+" minute"+(mins===1?"":"s")+".";
}
async function register(email,password,key="register"){
  rateCheck(key);
  const e=normalizeEmail(email),err=passwordRules(password);
  if(!validEmail(e))throw new Error("Enter a valid email address.");
  if(err)throw new Error(err);
  const existing=await storage.findUserByEmail(e);if(existing)throw new Error("EMAIL_EXISTS");
  const id=crypto.randomUUID(),p=newPassword(password);
  const user=await storage.createUser({id,email:e,passwordHash:p.hash,passwordSalt:p.salt});
  return user;
}
async function login(email,password,key="login",mfaCode=""){
  rateCheck(key);
  const e=normalizeEmail(email),user=await storage.findUserByEmail(e);
  if(!user){
    try{hashPassword(String(password),{version:1,N:16384,r:8,p:1,pepper:false,salt:DUMMY_SALT})}catch{}
    storage.recordSecurityEvent("warning","login_unknown_email",e,{source:"auth"}).catch(()=>{});
    throw new Error("INVALID_CREDENTIALS");
  }
  if(user.bannedAt){storage.recordSecurityEvent("warning","banned_login_attempt",user.email).catch(()=>{});throw new Error("ACCOUNT_BANNED")}
  if(user.restrictedUntil&&new Date(user.restrictedUntil).getTime()>Date.now()){storage.recordSecurityEvent("warning","restricted_login_attempt",user.email).catch(()=>{});throw new Error("ACCOUNT_RESTRICTED")};
  if(user.restrictedUntil){await storage.moderateUser(user.id,"restore")}
  if(user.lockedUntil&&new Date(user.lockedUntil).getTime()>Date.now())throw new Error("ACCOUNT_LOCKED");
  if(user.lockedUntil){await storage.resetLoginFailures(user.id)}
  const meta=parseSalt(user.passwordSalt);
  const hash=hashPassword(password,meta);
  let valid=false;
  try{valid=crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(user.passwordHash,"hex"))}catch{valid=false}
  if(!valid){
    const lock=await storage.recordLoginFailure(user.id,7,15);
    storage.recordSecurityEvent(lock?.lockedUntil?"warning":"info",lock?.lockedUntil?"account_locked":"login_failed",user.email,{failedLoginCount:lock?.failedLoginCount||0}).catch(()=>{});
    if(lock?.lockedUntil)throw new Error("ACCOUNT_LOCKED");
    throw new Error("INVALID_CREDENTIALS");
  }
  const admin=isAdminEmail(user.email);
  const mfaEnabled=admin&&totp.configured();
  if(admin&&mfaEnabled&&!totp.verifyTotp(process.env.MARKETPULSE_ADMIN_TOTP_SECRET,mfaCode,1)){
    if(!mfaCode){storage.recordSecurityEvent("warning","admin_mfa_required",user.email).catch(()=>{});throw new Error("ADMIN_MFA_REQUIRED")}
    storage.recordSecurityEvent("alert","admin_mfa_failed",user.email).catch(()=>{});
    throw new Error("ADMIN_MFA_INVALID");
  }
  const newMetaNeeded=meta.version!==2 || meta.pepper!==Boolean(PASSWORD_PEPPER);
  if(newMetaNeeded){
    const upgraded=newPassword(password);
    await storage.savePassword(user.id,upgraded.hash,upgraded.salt);
  }
  const raw=token(),hours=admin?ADMIN_SESSION_HOURS:SESSION_DAYS*24;
  const expiresAt=new Date(Date.now()+hours*3600000),mfaAt=admin&&mfaEnabled?new Date().toISOString():null;
  if(admin)await storage.revokeUserSessions(user.id);
  await storage.saveSession(hashToken(raw),user.id,expiresAt.toISOString(),mfaAt);
  await storage.touchUserLogin(user.id);
  storage.recordSecurityEvent("info","login_success",user.email,{admin}).catch(()=>{});
  return {
    user:{id:user.id,email:user.email,createdAt:user.createdAt,lastLoginAt:new Date().toISOString(),isAdmin:admin,mfaEnabled},
    setCookie:cookie(raw,hours*3600)
  };
}
async function userFromRequest(req){
  const raw=parseCookies(req.headers.cookie||"")[COOKIE];if(!raw)return null;
  const tokenHash=hashToken(raw),session=await storage.getSession(tokenHash);if(!session)return null;
  if(session.bannedAt||session.restrictedUntil&&new Date(session.restrictedUntil).getTime()>Date.now()){await storage.deleteSession(tokenHash);return null}
  const lastSeen=session.lastSeenAt?new Date(session.lastSeenAt).getTime():0;
  if(!lastSeen||Date.now()-lastSeen>30000)storage.touchSessionActivity(tokenHash).catch(()=>{});
  return {id:session.userId,email:session.email,expiresAt:session.expiresAt,isAdmin:isAdminEmail(session.email),adminMfaAt:session.adminMfaAt||null};
}
async function requireAdmin(req){
  const user=await userFromRequest(req);
  if(!user)return {ok:false,status:401,error:"Authentication required",user:null};
  if(!user.isAdmin)return {ok:false,status:403,error:"Admin access required",user};
  if(totp.configured()){
    if(!user.adminMfaAt)return {ok:false,status:401,error:"Admin MFA required",user};
    const age=Date.now()-new Date(user.adminMfaAt).getTime();
    if(!Number.isFinite(age)||age>ADMIN_SESSION_HOURS*3600000)return {ok:false,status:401,error:"Admin MFA session expired",user};
  }
  return {ok:true,status:200,user};
}
async function logout(req){
  const raw=parseCookies(req.headers.cookie||"");const tokenValue=raw[COOKIE];
  if(tokenValue)await storage.deleteSession(hashToken(tokenValue));
  return {setCookie:clearCookie()};
}
module.exports={register,login,userFromRequest,requireAdmin,isAdminEmail,validEmail,passwordRules,CookieName:COOKIE,adminConfigured:Boolean(ADMIN_EMAIL),mfaEnabled:Boolean(ADMIN_EMAIL&&totp.configured()),passwordPepperEnabled:Boolean(PASSWORD_PEPPER)};
