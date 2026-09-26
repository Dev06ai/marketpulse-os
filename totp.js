const crypto=require("crypto");

function normalizeSecret(value){
  return String(value||"").replace(/[ =-]/g,"").toUpperCase();
}
function base32Decode(value){
  const s=normalizeSecret(value).replace(/[^A-Z2-7]/g,"");
  let bits="",bytes=[];
  for(const ch of s){
    const v="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
    if(v<0)continue;
    bits+=v.toString(2).padStart(5,"0");
  }
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
}
function hotp(secret,counter){
  const key=base32Decode(secret);
  const b=Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(counter/0x100000000),0);
  b.writeUInt32BE(counter>>>0,4);
  const digest=crypto.createHmac("sha1",key).update(b).digest();
  const offset=digest[digest.length-1]&0x0f;
  const code=((digest[offset]&0x7f)<<24)|((digest[offset+1]&0xff)<<16)|((digest[offset+2]&0xff)<<8)|(digest[offset+3]&0xff);
  return String(code%1000000).padStart(6,"0");
}
function verifyTotp(secret,code,window=1){
  const s=normalizeSecret(secret),c=String(code||"").replace(/\D/g,"");
  if(!s||c.length!==6)return false;
  const now=Math.floor(Date.now()/30000),given=Buffer.from(c);
  for(let i=-window;i<=window;i++){
    const expected=Buffer.from(hotp(s,now+i));
    if(given.length===expected.length&&crypto.timingSafeEqual(given,expected))return true;
  }
  return false;
}
function configured(){return Boolean(normalizeSecret(process.env.MARKETPULSE_ADMIN_TOTP_SECRET))}
module.exports={verifyTotp,configured};
