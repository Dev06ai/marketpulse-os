"use strict";
/**
 * Modern MarketPulse Apex terminal contract.
 *
 * Replaces the retired inline-HTML markup tests. Exercises the actual
 * renderDecision() function with mocked DOM and final server envelopes,
 * not just the existence of a text snippet.
 *
 * Browser network and exchange execution are NEVER started by this test.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");
new vm.Script(app, { filename: "public/app.js" });
assert.match(html, /<script\b[^>]*src=["']\/app\.js(?:\?[^"']*)?["'][^>]*><\/script>/i,
  "MarketPulse must load the current standalone dashboard");
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, "Static DOM IDs must be unique");
for (const id of [
  "decision", "gate", "execution", "entry", "stop", "tp1",
  "chart", "chartWrap", "interval", "runtime", "candidateState",
  "chartStyleToggle", "reasons", "symbol"
]) assert(ids.includes(id), "Missing current terminal DOM surface: " + id);
for (const defaultState of [
  'id="decision">WAIT', 'id="execution">GATED',
  'id="entry">—', 'id="stop">—', 'id="tp1">—'
]) assert(html.includes(defaultState), "Missing fail-closed initial state: " + defaultState);

// Keep a server-side final decision authority: UI never determines whether a
// rejected final signal may execute; the server must sanitize the candidate.
for (const contract of [
  "function sanitizeFinalDecision", "candidateEvidence",
  "liveSignalEligible:false"
]) assert(server.includes(contract), "Missing server-side decision gate: " + contract);

// Verify refresh race protection and bounded, non-blocking reconnect behavior.
for (const contract of [
  "function connectLiveStream()", "state.wsRetryMs=Math.min(state.wsRetryMs*2,10000)",
  "state.marketEpoch!==epoch", "function refreshDecision(",
  "function drawChart()", "function setIntervalFromToolbar("
]) assert(app.includes(contract), "Missing current transport / chart contract: " + contract);

// Load the application without running boot or launching any requests.
const exposed = app.replace(/\}\)\(\);\s*$/, "globalThis.__apexTest = { state, renderDecision };})();");
assert.notEqual(exposed, app, "Could not isolate decision renderer");
const nodes = new Map();
function element(id) {
  if (!nodes.has(id)) nodes.set(id, {
    id, textContent: "", innerHTML: "", className: "",
    style: {}, children: [], appendChild(node) { this.children.push(node); },
    classList: { add() {}, remove() {}, toggle() {} }
  });
  return nodes.get(id);
}
const document = {
  readyState: "loading",
  addEventListener() {},
  getElementById: element,
  querySelector() { return null; },
  createElement() { return { textContent: "", className: "", style: {} }; }
};
const context = {
  document, console, requestAnimationFrame() { return 1; },
  setTimeout() { throw new Error("Unexpected timer"); },
  clearTimeout() {}
};
context.globalThis = context;
vm.runInNewContext(exposed, context, { filename: "Apex UI isolated test", timeout: 2000 });
const ui = context.__apexTest;
assert(ui && ui.renderDecision && ui.state, "Unable to access isolated decision renderer");

function show(decision) {
  nodes.clear();
  ui.state.decision = decision;
  ui.renderDecision();
  return {
    side: element("decision").textContent,
    execution: element("execution").textContent,
    candidate: element("candidateState").textContent
  };
}
const levelsLong = { entry: 100, stop: 98, tp1: 105, rr: 2.5 };
const levelsShort = { entry: 100, stop: 102, tp1: 96, rr: 2 };
const approvedLong = {
  state: "READY", action: "LONG", liveSignalEligible: true,
  levels: levelsLong
};
const approvedShort = {
  state: "READY", action: "SHORT", liveSignalEligible: true,
  levels: levelsShort
};
let r = show({});
assert.equal(r.side, "WAIT");
assert.equal(r.execution, "GATED");

r = show({ state: "NO_TRADE", market: { side: "LONG" }, levels: levelsLong });
assert.equal(r.side, "WAIT", "Unapproved market lean must remain WAIT");
assert.equal(r.execution, "GATED");
assert.match(r.candidate, /CANDIDATE|WATCH/i, "Candidate may appear only as a watch");

r = show({ ...approvedLong, liveSignalEligible: false });
assert.equal(r.side, "WAIT", "Rejected signal cannot display as final");
assert.equal(r.execution, "GATED");

r = show({ ...approvedLong, stale: true,
  apex: { executionGate: { automaticExecutionReady: true } }
});
assert.equal(r.side, "WAIT", "Stale signal must remain WAIT");
assert.equal(r.execution, "GATED");

r = show({ ...approvedLong, levels: { entry: 100, tp1: 104 } });
assert.equal(r.execution, "GATED", "Missing stop cannot show READY");
r = show({ ...approvedLong, levels: { entry: 100, stop: 101, tp1: 104 } });
assert.equal(r.execution, "GATED", "Inverted LONG stop cannot show READY");
r = show({ ...approvedShort, levels: { entry: 100, stop: 98, tp1: 96 } });
assert.equal(r.execution, "GATED", "Inverted SHORT stop cannot show READY");

r = show(approvedLong);
assert.equal(r.side, "LONG");
assert.equal(r.execution, "MANUAL READY");
r = show(approvedShort);
assert.equal(r.side, "SHORT");
assert.equal(r.execution, "MANUAL READY");

r = show({ ...approvedLong,
  apex: { executionGate: { automaticExecutionReady: true } }
});
assert.equal(r.execution, "AUTO READY",
  "Automatic display requires final approved signal plus valid risk geometry");

console.log("Current Apex UI contract: 11 risk, stale-signal and layout scenarios passed.");
