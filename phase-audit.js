/**
 * MarketPulse Phase 1-500 Deep Audit
 * Pure repository/runtime audit for phase wiring, self-tests and registry consistency.
 */
const fs=require("fs");
const path=require("path");

const VERSION="1.0.0";

function safeRequire(file){
  try{return {ok:true,module:require(file),error:null};}
  catch(e){return {ok:false,module:null,error:String(e?.message||e)}}
}

async function run(){
  const root=__dirname;
  const history=safeRequire(path.join(root,"phase-history.js"));
  const phases=history.ok&&typeof history.module.getPhaseHistory==="function"?history.module.getPhaseHistory():[];
  const ids=phases.map(x=>Number(x.phase));
  const unique=new Set(ids);
  const registry={
    count:phases.length===500,
    unique:unique.size===500,
    range:ids.length===500&&ids.every((v,i)=>v===i+1),
    status401to499:phases.slice(400,499).every(x=>x.status==="COMPLETE"),
    phase500Validated:phases[499]?.status==="VALIDATED",
    engineeringPhase:history.ok&&typeof history.module.getEngineeringPhase==="function"?history.module.getEngineeringPhase()===500:false,
    latestComplete:history.ok&&typeof history.module.getCurrentPhase==="function"?history.module.getCurrentPhase()===499:false
  };

  const phaseFiles=fs.readdirSync(root)
    .filter(name=>/^phase.*\.js$/i.test(name))
    .filter(name=>!/^phase-history\.js$/i.test(name))
    .filter(name=>!/-selftest\.js$/i.test(name))
    .filter(name=>!/^phase-audit\.js$/i.test(name))
    .sort();

  const modules=[];
  for(const name of phaseFiles){
    const full=path.join(root,name);
    const required=safeRequire(full);
    const hasSelfTest=Boolean(required.ok&&typeof required.module?.selfTest==="function");
    let selfTest={status:hasSelfTest?"NOT_RUN":"NO_SELF_TEST"};
    if(hasSelfTest){
      try{
        const result=await Promise.resolve().then(()=>required.module.selfTest());
        selfTest={status:result?.ok===true?"PASS":"FAIL",result:result??null};
      }catch(e){selfTest={status:"ERROR",error:String(e?.message||e)}}
    }
    modules.push({
      file:name,
      load:required.ok?"PASS":"FAIL",
      loadError:required.error,
      hasSelfTest,
      selfTest
    });
  }

  const consolidated={
    phase21to50:safeRequire(path.join(root,"phase21-50-stack.js")),
    phase51to100:safeRequire(path.join(root,"phase51-100-stack.js")),
    phase101to200:safeRequire(path.join(root,"phase101-200-intelligence.js")),
    phase201to300:safeRequire(path.join(root,"phase201-300-profit-engine.js")),
    phase301to400:safeRequire(path.join(root,"phase301-400-adaptive-intelligence.js")),
    phase401to500:safeRequire(path.join(root,"phase401-500-apex-engine.js"))
  };

  const groupChecks={};
  for(const [key,r] of Object.entries(consolidated)){
    groupChecks[key]={
      load:r.ok,
      selfTest:typeof r.module?.selfTest==="function"?(()=>{try{const v=r.module.selfTest();return v?.ok===true?"PASS":"FAIL"}catch{return "ERROR"}})():"MISSING"
    };
  }
  groupChecks.phase101to200Specs=Boolean(consolidated.phase101to200.module?.moduleSpecs?.length===100);
  groupChecks.phase301to400Specs=Boolean(consolidated.phase301to400.module?.specs?.length===100);
  groupChecks.phase401to500Specs=Boolean(consolidated.phase401to500.module?.specs?.length===100);

  const weakSelfTests=modules.filter(x=>{
    if(!x.hasSelfTest)return false;
    const src=fs.readFileSync(path.join(root,x.file),"utf8")||"";
    const s=src.indexOf("function selfTest");
    const e=s>=0?src.indexOf("module.exports",s):-1;
    const body=s>=0?(e>0?src.slice(s,e):src.slice(s)):"";
    return /return\s*\{\s*ok\s*:\s*true\s*,?/.test(body);
  }).map(x=>x.file);
  const modulesWithoutSelfTest=modules.filter(x=>x.selfTest.status==="NO_SELF_TEST").map(x=>x.file);
  const coreChecks={
    phase1_2:Boolean(fs.existsSync(path.join(root,"market-engine.js"))),
    phase3:Boolean(fs.existsSync(path.join(root,"trade-levels.js"))),
    phase4:Boolean(history.ok&&fs.existsSync(path.join(root,"phase4.js"))),
    phase5:Boolean(history.ok&&fs.readFileSync(path.join(root,"server.js"),"utf8").includes("function derivatives")),
    phase6:Boolean(fs.existsSync(path.join(root,"phase6.js"))),
    phase7:Boolean(fs.existsSync(path.join(root,"phase7.js"))),
    phase8:Boolean(fs.existsSync(path.join(root,"auth.js"))&&fs.readFileSync(path.join(root,"auth.js"),"utf8").includes("requireAdmin")),
    phase9_10:Boolean(fs.existsSync(path.join(root,"phase9-10.js"))),
    phase11_13:Boolean(fs.existsSync(path.join(root,"phase11-13.js"))),
    phase14:Boolean(fs.existsSync(path.join(root,"phase14-signal-intelligence.js"))),
    phase15:Boolean(fs.existsSync(path.join(root,"phase15.js"))),
    phase16:Boolean(fs.existsSync(path.join(root,"phase16.js"))),
    phase17:Boolean(fs.existsSync(path.join(root,"autotrader.js"))),
    phase18:Boolean(fs.existsSync(path.join(root,"phase18-market-state.js"))&&fs.existsSync(path.join(root,"phase18-execution-router.js"))),
    phase19:Boolean(fs.readFileSync(path.join(root,"server.js"),"utf8").includes("DECISION_LAST_GOOD")),
    phase20:Boolean(fs.existsSync(path.join(root,"phase20-scenario-matrix.js")))
  };
  const failures=modules.filter(x=>x.load!=="PASS"||x.selfTest.status==="FAIL"||x.selfTest.status==="ERROR");
  const groupFailures=Object.entries(groupChecks).filter(([k,v])=>v===false||v==="FAIL"||v==="ERROR"||v.selfTest==="FAIL"||v.selfTest==="ERROR"||v.selfTest==="MISSING");

  return {
    ok:Object.values(registry).every(Boolean)&&failures.length===0&&groupFailures.length===0,
    version:VERSION,
    generatedAt:Date.now(),
    registry,
    coreChecks,
    moduleCount:modules.length,
    moduleFailures:failures,
    weakSelfTests,
    modulesWithoutSelfTest,
    consolidated:groupChecks,
    checkedFiles:modules.map(x=>x.file),
  };
}

module.exports={VERSION,run};
