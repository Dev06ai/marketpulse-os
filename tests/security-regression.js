"use strict";
// Integration regression checks for the real HTTP boundary. Run with "node tests/security-regression.js".
const assert=require("node:assert/strict");
const http=require("node:http");
const path=require("node:path");
const os=require("node:os");
const fs=require("node:fs");
const {spawn}=require("node:child_process");
const {setTimeout:delay}=require("node:timers/promises");
const crypto=require("node:crypto");

async function main(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"mp-sec-"));
  const port=22000+Math.floor(Math.random()*20000);
  const emergency=setTimeout(()=>{console.error("security regression: timed out");process.exit(1)},90000);
  const child=spawn(process.execPath,["server.js"],{
    cwd:path.join(__dirname,".."),
    env:{...process.env,PORT:String(port),DATABASE_URL:"",NODE_ENV:"test",
      MP_MEMORY_FILE:path.join(temp,"memory.json"),
      MARKETPULSE_ADMIN_EMAIL:"owner@example.invalid",
      MARKETPULSE_ADMIN_TOTP_SECRET:"",
      MARKETPULSE_TRUST_PROXY:"false"},
    stdio:["ignore","pipe","pipe"]
  });
  let output="";
  child.stdout.on("data",d=>{output+=d.toString().slice(0,1000)});
  child.stderr.on("data",d=>{output+=d.toString().slice(0,1000)});
  const base="http://127.0.0.1:"+port;
  const device="11111111-1111-4111-8111-111111111111";
  async function req(url,opts={}){
    const response=await fetch(base+url,{signal:AbortSignal.timeout(8000),...opts});
    const body=await response.text();
    let parsed;try{parsed=JSON.parse(body)}catch{parsed={}};
    return {response,data:parsed};
  }
  try{
    let live=false;
    for(let i=0;i<20;i++){
      if(child.exitCode!==null)break;
      try{const h=await req("/health",{signal:AbortSignal.timeout(1000)});if(h.response.status===200){live=true;break}}catch{}
      await delay(100);
    }
    assert(live,"server did not start: "+output.slice(0,1000));
    const page=await req("/");
    assert.equal(page.response.status,200);
    assert(page.response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert.equal(page.response.headers.get("x-content-type-options"),"nosniff");
    assert.equal((await req("/api/admin/security")).response.status,401);
    assert.equal((await req("/api/edge")).response.status,401);
    assert.equal((await req("/api/ai",{method:"POST",body:"{}"})).response.status,401);
    assert.equal((await req("/api/memory?device="+device)).response.status,401);
    assert.equal((await req("/api/analytics?device="+device)).response.status,401);
    assert.equal((await req("/api/dev-trader/learning/status")).response.status,401);
    const crossed=await req("/api/auth/presence",{method:"POST",headers:{"sec-fetch-site":"cross-site"}});
    assert.equal(crossed.response.status,403);
    const password="correct horse battery staple 2026!";

    async function register(email){
      const result=await req("/api/auth/register",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({email,password})
      });
      assert.equal(result.response.status,201,email+" registration: "+JSON.stringify(result.data));
      const cookie=result.response.headers.get("set-cookie");
      assert(cookie?.includes("HttpOnly"),"missing HttpOnly session cookie");
      return cookie.split(";")[0];
    }

    const alice=await register("alice@example.invalid");
    const bob=await register("bob@example.invalid");
    const resAdmin=await req("/api/admin/users",{headers:{cookie:alice}});
    assert.equal(resAdmin.response.status,403);

    const memoryUrl="/api/memory?device="+device;
    const saved=await req(memoryUrl,{
      method:"POST",headers:{"content-type":"application/json",cookie:alice},
      body:JSON.stringify({journal:[{note:"owner-only"}]})
    });
    assert.equal(saved.response.status,200,"alice memory save");
    const aliceMemory=await req(memoryUrl,{headers:{cookie:alice}});
    assert.equal(aliceMemory.data.payload.journal[0].note,"owner-only");
    const bobMemory=await req(memoryUrl,{headers:{cookie:bob}});
    assert.equal(bobMemory.response.status,200);
    assert.equal((bobMemory.data.payload?.journal||[]).length,0,"cross-account memory leak");

    const malformed=await req("/api/auth/me",{headers:{cookie:"mp_session=%GG"}});
    assert.equal(malformed.response.status,200);
    assert.equal(malformed.data.authenticated,false);

    const owner=await req("/api/auth/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"owner@example.invalid",password})
    });
    assert.notEqual(owner.response.status,201,"owner must not receive a session with missing TOTP");

    // Send a chunked body without Content-Length, bypassing naive header-only limits.
    let oversizedRejected=false;
    await new Promise(resolve=>{
      const r=http.request({hostname:"127.0.0.1",port,path:"/api/telemetry/event",method:"POST",
        headers:{"Content-Type":"application/json","Transfer-Encoding":"chunked"}},
      resp=>{oversizedRejected=resp.statusCode===413;resp.resume();resp.on("end",resolve)});
      r.on("error",()=>{oversizedRejected=true;resolve()});
      for(let i=0;i<6;i++)r.write("x".repeat(52000));
      r.end();
    });
    assert(oversizedRejected,"oversized streamed request accepted");
    assert.equal((await req("/health")).response.status,200,"server unhealthy after oversized body");

    console.log("security regression: PASS (admin isolation, memory isolation, MFA, XSS headers, CSRF, streamed body)");
  }finally{
    clearTimeout(emergency);
    child.kill("SIGTERM");
    await delay(100);
    try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
  }
}

main().catch(e=>{console.error("security regression: FAIL",e);process.exitCode=1});
