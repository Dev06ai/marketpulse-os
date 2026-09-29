const engine=require("./phase401-500-apex-engine");
const x=engine.selfTest();
if(!x.ok)throw new Error("Phase 401-500 self-test failed");
if(engine.specs.length!==100)throw new Error("Phase 401-500 module count mismatch");
if(engine.specs[0].phase!==401||engine.specs[99].phase!==500)throw new Error("Phase range mismatch");
console.log(JSON.stringify(x));
