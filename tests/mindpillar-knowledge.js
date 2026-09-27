const assert=require("assert");
const {DOMAINS,PLAYBOOK_CATALOG,PUBLIC_SOURCES,buildKnowledgeContext}=require("../mindpillar-knowledge");

assert(Object.keys(DOMAINS).length>=16,"knowledge domains should be broad");
assert(PLAYBOOK_CATALOG.length>=30,"playbook catalog should cover the visible library");
assert(PUBLIC_SOURCES.length>=10,"public source registry should be populated");

const sfp=buildKnowledgeContext({setupKind:"SFP",side:"LONG",interval:"15m"});
assert(sfp.domains.some(x=>x.id==="sfp"),"SFP context should include SFP knowledge");
assert(sfp.domains.some(x=>x.id==="cvd"),"SFP context should include CVD knowledge");
assert(sfp.domains.some(x=>x.id==="risk"),"all directional setups should include risk knowledge");

const dline=buildKnowledgeContext({setupKind:"D_LINE_BREAKOUT",side:"LONG",interval:"15m"});
assert(dline.domains.some(x=>x.id==="d-line"),"D-Line context should include D-Line knowledge");
assert(dline.domains.some(x=>x.id==="order-flow"),"D-Line context should include order-flow knowledge");

console.log("MindPillar knowledge-core checks passed:",{
  domains:Object.keys(DOMAINS).length,
  sessions:PLAYBOOK_CATALOG.length,
  publicSources:PUBLIC_SOURCES.length,
  sfpDomains:sfp.domains.length,
  dlineDomains:dline.domains.length
});
