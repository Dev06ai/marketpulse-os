const crypto=require("crypto");
const storage=require("./storage");

const SESSION_DAYS=30;
const COOKIE="mp_session";

function normalizeEmail(email){
  return String(email||"").trim().toLowerCase();
}
function validEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function passwordRules(password){
  const p=String(password||"");
  if(p.length<8)return "Password must be at least 8 characters.";
  if(p.length>128)return "Password is too long.";
  return null;
}
function hashPassword(password,salt){
  return crypto.scryptSync(String(password),Buffer.from(salt,"hex"),64).toString("hex");
}
function newPassword(password){
  const salt=crypto.randomBytes(16).toString("hex");
  return {salt,hash:hashPassword(password,salt)};
}
function token(){
  return crypto.randomBytes(32).toString("hex");
}
function hashToken(raw){
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}
function parseCookies(header){
  const out={};
  String(header||"").split(";").forEach(part=>{
    const i=part.indexOf("=");
    if(i<0)return;
    const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();
    if(k)out[k]=decodeURIComponent(v);
  });
  return out;
}
function cookie(raw,maxAge=SESSION_DAYS*86400){
  return COOKIE+"="+encodeURIComponent(raw)+"; Path=/; HttpOnly; SameSite=Lax; Max-Age="+maxAge;
}
function clearCookie(){return cookie("",0)}
async function register(email,password){
  const e=normalizeEmail(email),err=passwordRules(password);
  if(!validEmail(e))throw new Error("Enter a valid email address.");
  if(err)throw new Error(err);
  const existing=await storage.findUserByEmail(e);if(existing)throw new Error("EMAIL_EXISTS");
  const id=crypto.randomUUID(),p=newPassword(password);
  const user=await storage.createUser({id,email:e,passwordHash:p.hash,passwordSalt:p.salt});
  return user;
}
async function login(email,password){
  const e=normalizeEmail(email),user=await storage.findUserByEmail(e);
  if(!user)throw new Error("INVALID_CREDENTIALS");
  const hash=hashPassword(password,user.passwordSalt);
  if(!crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(user.passwordHash,"hex")))throw new Error("INVALID_CREDENTIALS");
  const raw=token(),expiresAt=new Date(Date.now()+SESSION_DAYS*86400000);
  await storage.saveSession(hashToken(raw),user.id,expiresAt.toISOString());
  await storage.touchUserLogin(user.id);
  return {user:{id:user.id,email:user.email,createdAt:user.createdAt,lastLoginAt:expiresAt.toISOString()},setCookie:cookie(raw)};
}
async function userFromRequest(req){
  const raw=parseCookies(req.headers.cookie||"")[COOKIE];
  if(!raw)return null;
  const session=await storage.getSession(hashToken(raw));
  if(!session)return null;
  return {id:session.userId,email:session.email,expiresAt:session.expiresAt};
}
async function logout(req){
  const raw=parseCookies(req.headers.cookie||"")[COOKIE];
  if(raw)await storage.deleteSession(hashToken(raw));
  return {setCookie:clearCookie()};
}
module.exports={register,login,userFromRequest,logout,validEmail,passwordRules,CookieName:COOKIE};
