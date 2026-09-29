(function(){
  "use strict";

  const S = {
    symbol:"BTCUSDT",
    interval:"15m",
    candles:[],
    live:null,
    apex:null,
    decision:null,
    exec:null,
    history:[],
    loading:false,
    range:120,
    start:0,
    timer:null,
    chartMode:"candles",
    activeView:"command"
  };

  const css = String.raw\`
  :root{
    --apex-bg:#05070a;--apex-panel:#0a0e13;--apex-panel2:#0e141b;--apex-line:rgba(174,196,218,.12);
    --apex-text:#edf4fb;--apex-muted:#8191a3;--apex-dim:#536171;--apex-cyan:#55e6d0;--apex-blue:#6ea8ff;
    --apex-violet:#aa8cff;--apex-green:#45e39d;--apex-red:#ff667a;--apex-amber:#f3bf4f;
    --apex-shadow:0 24px 80px rgba(0,0,0,.32)
  }
  body.apexV2Active{background:#030507!important;color:var(--apex-text)!important}
  body.apexV2Active:before{display:none!important}
  #apexV2Root{position:fixed;inset:0;z-index:9999;background:
    radial-gradient(circle at 8% 0%,rgba(85,230,208,.07),transparent 22%),
    radial-gradient(circle at 88% 0%,rgba(170,140,255,.07),transparent 22%),
    linear-gradient(180deg,#030507 0%,#06090e 50%,#020305 100%);
    color:var(--apex-text);font:12px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:auto
  }
  #apexV2Root *{box-sizing:border-box}
  .apex-shell{min-height:100%;padding:14px 16px 28px}
  .apex-top{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:250px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;
    background:rgba(3,5,8,.90);backdrop-filter:blur(18px);border:1px solid rgba(174,196,218,.10);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22)}
  .apex-brand{display:flex;align-items:center;gap:10px}
  .apex-logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:10px;font-weight:1000;color:#081014;
    background:conic-gradient(from 200deg,var(--apex-cyan),var(--apex-blue),var(--apex-violet),var(--apex-cyan));box-shadow:0 0 28px rgba(85,230,208,.16)}
  .apex-brand b{font-size:15px;letter-spacing:-.04em}.apex-brand small{display:block;color:var(--apex-muted);font-size:8px;margin-top:2px;letter-spacing:.11em;text-transform:uppercase}
  .apex-nav{display:flex;gap:5px;min-width:0;overflow:auto;scrollbar-width:none}.apex-nav::-webkit-scrollbar{display:none}
  .apex-nav button,.apex-btn{border:1px solid rgba(174,196,218,.10);background:#0b1016;color:#8393a6;padding:8px 10px;border-radius:9px;cursor:pointer;font-size:9px;font-weight:850;white-space:nowrap}
  .apex-nav button:hover,.apex-nav button.on{color:#04110f;background:linear-gradient(100deg,var(--apex-cyan),#a2ffe9);border-color:transparent}
  .apex-tools{display:flex;align-items:center;gap:6px;justify-content:flex-end}.apex-select{border:1px solid rgba(174,196,218,.12);background:#0b1016;color:#eaf1f7;border-radius:9px;padding:8px 10px;font-size:9px;font-weight:850}
  .apex-live{display:inline-flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid rgba(69,227,157,.16);border-radius:999px;color:#8be8bb;font-size:8px;font-weight:900}
  .apex-live i{width:7px;height:7px;border-radius:50%;background:var(--apex-green);box-shadow:0 0 14px var(--apex-green)}
  .apex-banner{margin:10px 0 12px;padding:9px 11px;border:1px solid rgba(85,230,208,.12);border-radius:12px;background:linear-gradient(90deg,rgba(85,230,208,.05),rgba(170,140,255,.04));display:flex;align-items:center;justify-content:space-between;gap:12px}
  .apex-banner b{font-size:9px;letter-spacing:.08em;text-transform:uppercase}.apex-banner span{font-size:9px;color:var(--apex-muted)}
  .apex-state{font-weight:900}.ok{color:var(--apex-green)!important}.bad{color:var(--apex-red)!important}.warn{color:var(--apex-amber)!important}.violet{color:var(--apex-violet)!important}
  .apex-kpis{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.apex-kpi{padding:10px 11px;border:1px solid var(--apex-line);border-radius:12px;background:linear-gradient(180deg,rgba(13,18,24,.95),rgba(7,10,14,.95));box-shadow:var(--apex-shadow)}
  .apex-k{font-size:8px;color:var(--apex-dim);text-transform:uppercase;letter-spacing:.10em}.apex-v{margin-top:5px;font-size:17px;font-weight:950;letter-spacing:-.03em}.apex-sub{margin-top:3px;color:var(--apex-muted);font-size:8px}
  .apex-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(330px,.65fr);gap:10px;margin-top:10px}.apex-col{min-width:0}
  .apex-card{border:1px solid var(--apex-line);border-radius:14px;background:linear-gradient(180deg,rgba(11,16,22,.96),rgba(6,9,13,.96));box-shadow:0 18px 60px rgba(0,0,0,.20);overflow:hidden}
  .apex-cardHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(174,196,218,.07)}
  .apex-title{font-size:10px;font-weight:950;letter-spacing:.05em;text-transform:uppercase}.apex-headRight{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
  .apex-chip{padding:5px 7px;border-radius:999px;border:1px solid rgba(174,196,218,.10);background:rgba(255,255,255,.02);color:#8293a7;font-size:7px;font-weight:900}
  .apex-chartTools{display:flex;gap:4px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid rgba(174,196,218,.07)}
  .apex-chartTools button{border:1px solid rgba(174,196,218,.10);background:#090e13;color:#7e8ea1;padding:6px 8px;border-radius:7px;font-size:8px;cursor:pointer}
  .apex-chartTools button.on{background:rgba(85,230,208,.10);color:var(--apex-cyan);border-color:rgba(85,230,208,.24)}
  .apex-chartWrap{height:520px;position:relative;background:
    linear-gradient(180deg,rgba(7,10,14,.98),rgba(3,6,9,.98));
  }
  .apex-canvas{display:block;width:100%;height:100%;touch-action:none}
  .apex-crossLabel{position:absolute;display:none;pointer-events:none;padding:6px 8px;border-radius:7px;background:rgba(7,11,16,.94);border:1px solid rgba(174,196,218,.14);font-size:8px;color:#dce6ef;white-space:nowrap}
  .apex-decision{padding:12px}.apex-command{display:grid;grid-template-columns:1fr 1fr;gap:7px}.apex-command button{border:1px solid rgba(174,196,218,.10);background:#0c1218;color:#dce7f1;padding:10px;border-radius:9px;cursor:pointer;font-size:8px;font-weight:900}
  .apex-signal{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:12px;border:1px solid rgba(85,230,208,.12);border-radius:12px;background:linear-gradient(135deg,rgba(85,230,208,.05),rgba(170,140,255,.04))}
  .apex-signalState{font-size:28px;font-weight:1000;letter-spacing:-.06em}.apex-signalMeta{font-size:8px;color:var(--apex-muted);line-height:1.45;text-align:right}
  .apex-bars{display:grid;gap:7px;margin-top:10px}.apex-barRow{display:grid;grid-template-columns:76px 1fr 48px;gap:7px;align-items:center;font-size:8px;color:var(--apex-muted)}
  .apex-track{height:6px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden}.apex-fill{height:100%;border-radius:999px}
  .apex-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}.apex-mini{min-height:120px}.apex-mini canvas{display:block;width:100%;height:118px}
  .apex-split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.apex-panelBody{padding:11px}.apex-rows{display:grid;gap:6px}.apex-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 8px;border:1px solid rgba(174,196,218,.07);border-radius:8px;background:rgba(255,255,255,.012);font-size:8px}.apex-row span{color:var(--apex-muted)}.apex-row b{text-align:right;font-weight:900}
  .apex-integrity{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.apex-integrity div{padding:8px;border:1px solid rgba(174,196,218,.08);border-radius:9px}.apex-integrity small{display:block;color:var(--apex-dim);font-size:7px;text-transform:uppercase;letter-spacing:.08em}.apex-integrity b{display:block;margin-top:5px;font-size:9px}
  .apex-plan{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.apex-plan div{padding:9px;border:1px solid rgba(174,196,218,.08);border-radius:9px}.apex-plan small{display:block;color:var(--apex-dim);font-size:7px;text-transform:uppercase}.apex-plan b{display:block;margin-top:4px;font-size:10px}
  .apex-feed{display:grid;gap:5px;max-height:180px;overflow:auto}.apex-feedRow{display:grid;grid-template-columns:56px 46px 1fr;gap:7px;padding:6px 7px;border-bottom:1px solid rgba(174,196,218,.05);font-size:8px}.apex-feedRow span{color:var(--apex-muted)}
  .apex-book{display:grid;gap:2px}.apex-bookRow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;font-size:8px;padding:4px 6px;border-radius:6px}.apex-bookRow span:nth-child(2){text-align:center}.apex-bookRow b{text-align:right}.apex-ask{background:rgba(255,102,122,.035)}.apex-bid{background:rgba(69,227,157,.035)}
  .apex-bottomGrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}.apex-note{font-size:8px;line-height:1.45;color:#a3b0bd}.apex-bigMetric{font-size:22px;font-weight:1000}.apex-list{display:grid;gap:6px}.apex-listItem{padding:8px;border:1px solid rgba(174,196,218,.07);border-radius:8px;font-size:8px;color:#dbe4eb}
  .apex-commandPanel{display:none}.apex-view{display:none}.apex-view.on{display:block}
  .apex-modal{position:fixed;inset:0;background:rgba(0,0,0,.58);backdrop-filter:blur(9px);display:none;align-items:center;justify-content:center;z-index:40}.apex-modal.on{display:flex}
  .apex-modalCard{width:min(560px,calc(100vw - 28px));border:1px solid rgba(174,196,218,.14);border-radius:16px;background:#0a0f14;box-shadow:0 30px 100px rgba(0,0,0,.55);padding:16px}.apex-modalCard h3{margin:0 0 7px;font-size:14px}.apex-modalCard p{font-size:9px;color:#96a6b7;line-height:1.6}
  @media(max-width:1200px){.apex-kpis{grid-template-columns:repeat(4,1fr)}.apex-layout{grid-template-columns:1fr}.apex-chartWrap{height:480px}.apex-top{grid-template-columns:210px minmax(0,1fr)}.apex-tools{grid-column:1/-1;justify-content:flex-start}}
  @media(max-width:760px){.apex-shell{padding:8px}.apex-top{grid-template-columns:1fr;gap:8px}.apex-tools{justify-content:flex-start;flex-wrap:wrap}.apex-kpis{grid-template-columns:repeat(2,1fr)}.apex-grid{grid-template-columns:1fr 1fr}.apex-split,.apex-bottomGrid{grid-template-columns:1fr}.apex-plan{grid-template-columns:1fr 1fr}.apex-integrity{grid-template-columns:1fr 1fr}.apex-chartWrap{height:420px}}
  \`;
  function style(){if(document.getElementById("apexV2Style"))return;const s=document.createElement("style");s.id="apexV2Style";s.textContent=css;document.head.appendChild(s)}

  const $=(s,r=document)=>r.querySelector(s);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
  const n=(x,d=2)=>Number.isFinite(Number(x))?Number(x).toLocaleString(undefined,{maximumFractionDigits:d}):"—";
  const p=x=>Number.isFinite(Number(x))?(Number(x)*100).toFixed(1)+"%":"—";
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const api=async(path,opts={})=>{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),opts.timeout||10000);
    try{const r=await fetch(path,{cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"},signal:c.signal});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||("HTTP "+r.status));return j}
    finally{clearTimeout(t)}
  };

  function mount(){
    style();document.body.classList.add("apexV2Active");
    document.querySelectorAll(".header,.wrap,#mp401Terminal").forEach(x=>{if(x)x.style.display="none"});
    const root=document.createElement("div");root.id="apexV2Root";
    root.innerHTML=\`
      <div class="apex-shell">
        <header class="apex-top">
          <div class="apex-brand"><div class="apex-logo">MP</div><div><b>MarketPulse APEX</b><small>canonical market command terminal</small></div></div>
          <nav class="apex-nav" id="apexNav">
            <button class="on" data-view="command">Command</button><button data-view="markets">Markets</button><button data-view="flow">Flow</button><button data-view="risk">Risk</button><button data-view="replay">Replay</button><button data-view="research">Research</button><button data-view="admin">Admin</button>
          </nav>
          <div class="apex-tools">
            <select id="apexSymbol" class="apex-select"><option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option><option>BNBUSDT</option><option>XRPUSDT</option><option>DOGEUSDT</option><option>ADAUSDT</option></select>
            <select id="apexTf" class="apex-select"><option>15m</option><option>30m</option><option>1h</option><option>4h</option><option>1d</option></select>
            <span class="apex-live"><i></i>LIVE DATA</span><button id="apexAccount" class="apex-btn">ACCOUNT</button>
          </div>
        </header>

        <div class="apex-banner"><div><b id="apexBannerTitle">COMMAND DECK</b> <span id="apexBannerText">One canonical frame drives every panel, chart and decision surface.</span></div><div id="apexBannerState" class="apex-state">SYNC —</div></div>

        <div class="apex-kpis">
          <div class="apex-kpi"><div class="apex-k">Last Price</div><div id="kPrice" class="apex-v">—</div><div id="kPriceSub" class="apex-sub">canonical</div></div>
          <div class="apex-kpi"><div class="apex-k">24H Change</div><div id="kChange" class="apex-v">—</div><div class="apex-sub">exchange ticker</div></div>
          <div class="apex-kpi"><div class="apex-k">CVD</div><div id="kCvd" class="apex-v">—</div><div id="kCvdSub" class="apex-sub">flow pressure</div></div>
          <div class="apex-kpi"><div class="apex-k">Open Interest</div><div id="kOi" class="apex-v">—</div><div id="kOiSub" class="apex-sub">positioning</div></div>
          <div class="apex-kpi"><div class="apex-k">Funding</div><div id="kFunding" class="apex-v">—</div><div class="apex-sub">perpetual</div></div>
          <div class="apex-kpi"><div class="apex-k">Order Book</div><div id="kOb" class="apex-v">—</div><div class="apex-sub">imbalance</div></div>
          <div class="apex-kpi"><div class="apex-k">Data Health</div><div id="kHealth" class="apex-v">—</div><div id="kHealthSub" class="apex-sub">canonical frame</div></div>
        </div>

        <section class="apex-view on" data-panel="command">
          <div class="apex-layout">
            <div class="apex-col">
              <section class="apex-card">
                <div class="apex-cardHead"><div><div class="apex-title">Price Action Command Chart</div><div class="apex-sub">candles · 20/50 EMA · volume · signal & integrity markers</div></div><div class="apex-headRight"><span id="chartModeChip" class="apex-chip">CANDLES</span><span class="apex-chip">CANONICAL</span></div></div>
                <div class="apex-chartTools" id="chartTools">
                  <button data-tf="15m">15m</button><button data-tf="30m">30m</button><button data-tf="1h">1h</button><button data-tf="4h">4h</button><button data-tf="1d">1d</button><span style="flex:1"></span>
                  <button data-mode="candles" class="on">CANDLES</button><button data-mode="line">LINE</button><button id="fitChart">FIT</button>
                </div>
                <div class="apex-chartWrap"><canvas id="mainApexChart" class="apex-canvas"></canvas><div id="crossLabel" class="apex-crossLabel"></div></div>
              </section>

              <div class="apex-grid">
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">CVD Flow</div><span id="cvdBadge" class="apex-chip">—</span></div><canvas id="cvdCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">Open Interest</div><span id="oiBadge" class="apex-chip">—</span></div><canvas id="oiCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">Liquidations</div><span id="liqBadge" class="apex-chip">—</span></div><canvas id="liqCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">Funding / Positioning</div><span id="fundBadge" class="apex-chip">—</span></div><canvas id="fundCanvas"></canvas></section>
              </div>

              <div class="apex-split">
                <section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Trade Plan Surface</div><span id="planBadge" class="apex-chip">WAIT</span></div><div class="apex-panelBody"><div class="apex-plan"><div><small>Side</small><b id="planSide">WAIT</b></div><div><small>Entry</small><b id="planEntry">—</b></div><div><small>Invalidation</small><b id="planStop">—</b></div><div><small>Target</small><b id="planTp">—</b></div></div><div class="apex-note" id="planNote" style="margin-top:9px">Levels remain conditional until the execution gate authorizes them.</div></div></section>
                <section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Market Tape</div><span id="tapeBadge" class="apex-chip">warming</span></div><div class="apex-panelBody"><div id="tape" class="apex-feed"></div></div></section>
              </div>
            </div>

            <aside class="apex-col">
              <section class="apex-card apex-decision">
                <div class="apex-cardHead"><div class="apex-title">Decision Center / APEX State</div><span id="decisionGate" class="apex-chip">WAIT</span></div>
                <div class="apex-signal"><div><div id="decisionState" class="apex-signalState">WAIT</div><div id="decisionReason" class="apex-sub">Loading canonical decision…</div></div><div id="decisionMeta" class="apex-signalMeta">—</div></div>
                <div class="apex-bars">
                  <div class="apex-barRow"><span>LONG</span><div class="apex-track"><div id="longBar" class="apex-fill" style="background:var(--apex-green);width:0"></div></div><b id="longPct">—</b></div>
                  <div class="apex-barRow"><span>SHORT</span><div class="apex-track"><div id="shortBar" class="apex-fill" style="background:var(--apex-red);width:0"></div></div><b id="shortPct">—</b></div>
                  <div class="apex-barRow"><span>WAIT</span><div class="apex-track"><div id="waitBar" class="apex-fill" style="background:var(--apex-amber);width:0"></div></div><b id="waitPct">—</b></div>
                </div>
              </section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">Execution & Safety</div><span id="execBadge" class="apex-chip">BLOCKED</span></div><div class="apex-panelBody"><div id="execRows" class="apex-rows"></div><div class="apex-command" style="margin-top:8px"><button id="armLive">ARM LIVE AUTO</button><button id="killLive">KILL SWITCH</button></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">Canonical Integrity</div><span id="integrityBadge" class="apex-chip">—</span></div><div class="apex-panelBody"><div class="apex-integrity"><div><small>Price</small><b id="iPrice">—</b></div><div><small>CVD</small><b id="iCvd">—</b></div><div><small>OI</small><b id="iOi">—</b></div><div><small>Funding</small><b id="iFunding">—</b></div><div><small>Book</small><b id="iBook">—</b></div><div><small>Taker</small><b id="iTaker">—</b></div></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">Order Book</div><span id="bookBadge" class="apex-chip">live</span></div><div class="apex-panelBody"><div id="orderBook" class="apex-book"></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">Why No Trade / Next Change</div><span id="whyBadge" class="apex-chip">ACTIVE</span></div><div class="apex-panelBody"><div id="whyNoTrade" class="apex-list"></div></div></section>
            </aside>
          </div>
        </section>

        <section class="apex-view" data-panel="markets"><div class="apex-card"><div class="apex-cardHead"><div><div class="apex-title">Market Command Matrix</div><div class="apex-sub">quick switch between instruments while keeping one interface and one canonical schema</div></div></div><div class="apex-panelBody"><div class="apex-list" id="marketMatrix"></div></div></div></section>
        <section class="apex-view" data-panel="flow"><div class="apex-bottomGrid"><section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Flow State</div></div><div class="apex-panelBody" id="flowSummary"></div></section><section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Liquidity Context</div></div><div class="apex-panelBody" id="liqSummary"></div></section><section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Positioning</div></div><div class="apex-panelBody" id="positionSummary"></div></section></div></section>
        <section class="apex-view" data-panel="risk"><div class="apex-split"><section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Risk Surface</div></div><div class="apex-panelBody" id="riskSurface"></div></section><section class="apex-card"><div class="apex-cardHead"><div class="apex-title">Failure Modes</div></div><div class="apex-panelBody" id="failureModes"></div></section></div></section>
        <section class="apex-view" data-panel="replay"><div class="apex-card"><div class="apex-cardHead"><div><div class="apex-title">Replay Lab</div><div class="apex-sub">reuse the same chart visual language for historical setup review</div></div><span class="apex-chip">NO LIVE ACTIONS</span></div><div class="apex-panelBody"><div class="apex-bigMetric" id="replayStatus">Ready</div><div class="apex-note" style="margin-top:7px">Historical replay remains a research surface. It does not mutate live execution state.</div></div></div></section>
        <section class="apex-view" data-panel="research"><div class="apex-card"><div class="apex-cardHead"><div class="apex-title">Research Console</div></div><div class="apex-panelBody"><div class="apex-list" id="researchRows"></div></div></div></section>
        <section class="apex-view" data-panel="admin"><div class="apex-card"><div class="apex-cardHead"><div class="apex-title">System / Admin Health</div><span class="apex-chip">diagnostic</span></div><div class="apex-panelBody"><div class="apex-list" id="adminRows"></div></div></div></section>
      </div>
      <div id="apexModal" class="apex-modal"><div class="apex-modalCard"><h3>Live Execution Safety</h3><p id="apexModalText">Loading…</p><div class="apex-command"><button id="closeModal">Close</button><button id="modalKill">KILL SWITCH</button></div></div></div>
    \`;
    root.querySelector("#apexSymbol").value=S.symbol;root.querySelector("#apexTf").value=S.interval;document.body.appendChild(root);

    $("#apexNav",root).onclick=e=>{const b=e.target.closest("button[data-view]");if(!b)return;S.activeView=b.dataset.view;$("#apexNav",root).querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b));root.querySelectorAll(".apex-view").forEach(x=>x.classList.toggle("on",x.dataset.panel===S.activeView));if(S.activeView==="markets")renderMarkets()};    
    $("#apexSymbol",root).onchange=e=>{S.symbol=e.target.value;refresh(true)};
    $("#apexTf",root).onchange=e=>{S.interval=e.target.value;refresh(true)};
    $("#chartTools",root).onclick=e=>{
      const b=e.target.closest("button");if(!b)return;
      if(b.dataset.tf){S.interval=b.dataset.tf;$("#apexTf",root).value=S.interval;refresh(true)}
      if(b.dataset.mode){S.chartMode=b.dataset.mode;$("#chartModeChip",root).textContent=S.chartMode.toUpperCase();$("#chartTools",root).querySelectorAll("button[data-mode]").forEach(x=>x.classList.toggle("on",x===b));drawMain()}
      if(b.id==="fitChart"){S.range=120;S.start=Math.max(0,S.candles.length-S.range);drawMain()}
    };
    $("#apexAccount",root).onclick=()=>{if(typeof openAccount==="function")openAccount()};
    $("#armLive",root).onclick=async()=>{if(!confirm("Arm MarketPulse LIVE automatic execution?"))return;try{await api("/api/autotrader/arm",{method:"POST"});await refreshExec()}catch(e){alert(e.message)}};
    $("#killLive",root).onclick=async()=>{try{await api("/api/autotrader/kill",{method:"POST"});await refreshExec()}catch(e){alert(e.message)}};
    $("#closeModal",root).onclick=()=>$("#apexModal",root).classList.remove("on");$("#modalKill",root).onclick=async()=>{try{await api("/api/autotrader/kill",{method:"POST"});$("#apexModal",root).classList.remove("on");await refreshExec()}catch(e){alert(e.message)}};

    bindMainChart();window.addEventListener("resize",()=>{drawMain();drawMiniCharts()});
    refresh(true);
  }

  function bindMainChart(){
    const c=$("#mainApexChart");if(!c)return;let drag=null;
    c.addEventListener("pointerdown",e=>{drag={x:e.clientX,start:S.start};c.setPointerCapture(e.pointerId)});
    c.addEventListener("pointerup",()=>drag=null);c.addEventListener("pointercancel",()=>drag=null);
    c.addEventListener("pointermove",e=>{if(drag){const r=c.getBoundingClientRect();const dx=e.clientX-r.left;S.start=clamp(Math.round(drag.start-dx/r.width*S.range),0,Math.max(0,S.candles.length-S.range));drawMain()}crosshair(e)});
    c.addEventListener("pointerleave",()=>{$("#crossLabel").style.display="none"});
    c.addEventListener("wheel",e=>{e.preventDefault();const old=S.range,f=Math.exp(e.deltaY*.0015),r=c.getBoundingClientRect(),rel=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1),anchor=S.start+rel*old;S.range=clamp(Math.round(old*f),50,240);S.start=clamp(Math.round(anchor-rel*S.range),0,Math.max(0,S.candles.length-S.range));drawMain()},{passive:false});
  }
  function crosshair(e){
    const c=$("#mainApexChart"),r=c.getBoundingClientRect();if(!r.width)return;const data=S.candles.slice(S.start,S.start+S.range);if(!data.length)return;const idx=clamp(Math.floor((e.clientX-r.left)/r.width*data.length),0,data.length-1),k=data[idx];if(!k)return;const label=$("#crossLabel");label.textContent=new Date(k.t).toLocaleString()+" · O "+n(k.o)+" H "+n(k.h)+" L "+n(k.l)+" C "+n(k.c);label.style.display="block";label.style.left=clamp(e.clientX-r.left+10,10,r.width-260)+"px";label.style.top=clamp(e.clientY-r.top+8,8,r.height-34)+"px";
  }

  async function refresh(force){
    if(S.loading&&!force)return;S.loading=true;
    try{
      if(force||!S.candles.length||Date.now()-(S.chartRefreshAt||0)>12000){
        const chart=await api("/api/chart?symbol="+encodeURIComponent(S.symbol)+"&interval="+encodeURIComponent(S.interval),{timeout:12000});
        S.candles=chart.candles||[];S.chartRefreshAt=Date.now();
        S.start=clamp(S.start,0,Math.max(0,S.candles.length-S.range));if(!S.start)S.start=Math.max(0,S.candles.length-S.range);
      }
      const live=await api("/api/live-sync?symbol="+encodeURIComponent(S.symbol),{timeout:8000});
      S.live=live;pushHistory(live);
      // Deep decision/execution state is refreshed on a slower cadence so the
      // one-second canonical stream stays responsive without request storms.
      if(force||!S.apex||Date.now()-(S.deepRefreshAt||0)>4500){
        const [apex,decision,exec]=await Promise.all([
          api("/api/phase401-500?symbol="+encodeURIComponent(S.symbol)+"&interval="+encodeURIComponent(S.interval),{timeout:15000}),
          api("/api/decision?symbol="+encodeURIComponent(S.symbol)+"&interval="+encodeURIComponent(S.interval),{timeout:15000}),
          api("/api/execution",{timeout:7000})
        ]);
        S.apex=apex;S.decision=decision;S.exec=exec;S.deepRefreshAt=Date.now();
      }else{
        // Execution status is independently cheap enough to refresh frequently.
        try{S.exec=await api("/api/execution",{timeout:7000})}catch{}
      }
      renderAll();drawMain();drawMiniCharts();if(S.activeView==="markets")renderMarkets();
    }catch(e){$("#apexBannerText").textContent="Data refresh issue: "+e.message}
    finally{S.loading=false}
  }
  function pushHistory(l){
    if(!l||!Number.isFinite(Number(l.price)))return;
    const ts=Number(l.dataTs||l.updatedAt||Date.now());
    const prev=S.history[S.history.length-1];const row={ts,price:Number(l.price),cvd:Number(l.cvdRatio??l.cvdDelta??0),oi:Number(l.oi??0),funding:Number(l.fundingRate??0),liq:Number(l.liquidationTotal??0),longLiq:Number(l.longLiquidations??0),shortLiq:Number(l.shortLiquidations??0),taker:Number(l.takerImbalance??0)};
    if(prev&&prev.ts===row.ts)S.history[S.history.length-1]=row;else S.history.push(row);if(S.history.length>180)S.history.shift();
  }
  async function refreshExec(){try{S.exec=await api("/api/execution",{timeout:7000});renderExec()}catch(e){alert(e.message)}}

  function renderAll(){
    const l=S.live||{},a=S.apex||{},d=S.decision||{},g=a.executionGate||d.canonicalExecutionIntegrity||{};const sync=a.synchronization||g.synchronization||{};const flow=a.canonical||l||{};
    $("#kPrice").textContent=n(flow.price??flow.lastPrice??d.price,2);
    $("#kChange").textContent=Number.isFinite(Number(l.change24h))?Number(l.change24h).toFixed(2)+"%":"—";$("#kChange").className="apex-v "+(Number(l.change24h)>=0?"ok":"bad");
    $("#kCvd").textContent=n(flow.cvdRatio??flow.cvd??l.cvdRatio,3);$("#kCvdSub").textContent=String(flow.cvdState||l.cvdState||"flow pressure");
    $("#kOi").textContent=n(flow.oi??l.oi,0);$("#kOiSub").textContent=(Number.isFinite(Number(flow.oiChangePct??l.oiChangePct))?Number(flow.oiChangePct??l.oiChangePct).toFixed(2)+"% delta":"positioning");
    $("#kFunding").textContent=Number.isFinite(Number(flow.fundingRate??l.fundingRate))?(Number(flow.fundingRate??l.fundingRate)*100).toFixed(4)+"%":"—";
    $("#kOb").textContent=Number.isFinite(Number(flow.orderBookImbalance??l.orderBook?.imbalance))?(Number(flow.orderBookImbalance??l.orderBook?.imbalance)*100).toFixed(1)+"%":"—";
    const ok=sync.ok!==false&&Number(sync.badCount||0)===0;$("#kHealth").textContent=ok?"SYNCED":"MISMATCH";$("#kHealth").className="apex-v "+(ok?"ok":"bad");$("#kHealthSub").textContent=sync.updatedAt?new Date(sync.updatedAt).toLocaleTimeString():"canonical frame";
    $("#apexBannerState").textContent=ok?"CANONICAL / SYNCED":"CANONICAL / MISMATCH";$("#apexBannerState").className="apex-state "+(ok?"ok":"bad");

    const probs=a.probabilities||d.probabilities||{};const side=String(a.command||g.side||d.action||"WAIT").toUpperCase();$("#decisionState").textContent=side;$("#decisionState").className="apex-signalState "+(side==="LONG"?"ok":side==="SHORT"?"bad":"warn");
    const status=g.status||a.status||"WAIT";$("#decisionGate").textContent=status;$("#decisionGate").className="apex-chip "+(g.automaticExecutionReady?"ok":status==="BLOCKED"?"bad":"warn");
    const long=Number(probs.long||0),short=Number(probs.short||0),wait=Number(probs.wait||Math.max(0,1-long-short));$("#longPct").textContent=p(long);$("#shortPct").textContent=p(short);$("#waitPct").textContent=p(wait);$("#longBar").style.width=(long*100)+"%";$("#shortBar").style.width=(short*100)+"%";$("#waitBar").style.width=(wait*100)+"%";
    $("#decisionReason").textContent=(a.ux&&a.ux.whyNoTrade&&a.ux.whyNoTrade[0])||g.reasons?.[0]||d.thesis||"Decision surface is waiting for confirmed evidence.";
    $("#decisionMeta").innerHTML="Q "+p(a.quality)+"<br>R:R "+n(g.rr??d.rr,2)+"R<br>"+(sync.ok===false?"SYNC BLOCK":"CANONICAL");
    renderExec();renderIntegrity(a,l);renderPlan(a,d);renderWhy(a,g);renderBook(l.orderBook||a.canonical?.orderBook||{});renderTape(l.liveHistory||a.canonical?.liveHistory||[]);
    $("#cvdBadge").textContent=String(flow.cvdState||"—");$("#oiBadge").textContent=n(flow.oiChangePct??l.oiChangePct,2)+"%";$("#liqBadge").textContent=String(flow.liquidationBias||"—");$("#fundBadge").textContent=Number.isFinite(Number(flow.fundingRate??l.fundingRate))?(Number(flow.fundingRate??l.fundingRate)*100).toFixed(4)+"%":"—";
    renderFlowViews();
  }

  function renderExec(){
    const e=S.exec||{},g=S.apex?.executionGate||{},c=e.control||{};const ready=Boolean(g.automaticExecutionReady);$("#execBadge").textContent=ready?"LIVE READY":"BLOCKED";$("#execBadge").className="apex-chip "+(ready?"ok":"warn");
    const rows=[["Mode",e.mode||"PAPER"],["Armed",c.armed?"YES":"NO"],["Kill switch",c.killSwitch?"ON":"OFF"],["Reconciliation",c.reconciliation?.ok?"OK":"REQUIRED"],["Live trading",g.liveCapability?.liveTradingEnabled?"ON":"OFF"],["Auto execution",g.liveCapability?.liveAutoExecutionEnabled?"ON":"OFF"]];
    $("#execRows").innerHTML=rows.map(r=>'<div class="apex-row"><span>'+esc(r[0])+'</span><b class="'+(String(r[1])==="YES"||String(r[1])==="OK"||String(r[1])==="ON"?"ok":String(r[1])==="NO"?"warn":"bad")+'">'+esc(r[1])+'</b></div>').join("");
  }
  function renderIntegrity(a,l){
    const s=a.synchronization||{};const vals=[["iPrice",s.ok!==false?"SYNCED":"MISMATCH"],["iCvd",s.ok!==false?"SYNCED":"MISMATCH"],["iOi",s.ok!==false?"SYNCED":"MISMATCH"],["iFunding",s.ok!==false?"SYNCED":"MISMATCH"],["iBook",s.ok!==false?"SYNCED":"MISMATCH"],["iTaker",s.ok!==false?"SYNCED":"MISMATCH"]];
    vals.forEach(([id,v])=>{$("#"+id).textContent=v;$("#"+id).className=v==="SYNCED"?"ok":"bad"});$("#integrityBadge").textContent=s.ok!==false?"ALL PINNED":"REPAIR REQUIRED";$("#integrityBadge").className="apex-chip "+(s.ok!==false?"ok":"bad");
  }
  function renderPlan(a,d){
    const g=a.executionGate||{},side=String(a.command||g.side||d.action||"WAIT").toUpperCase();const entry=g.entry??d.entry??a.entry,stop=g.stop??d.stop??a.stop,tp=g.target??d.tp1??a.tp1;
    $("#planSide").textContent=side;$("#planEntry").textContent=n(entry,2);$("#planStop").textContent=n(stop,2);$("#planTp").textContent=n(tp,2);$("#planBadge").textContent=g.automaticExecutionReady?"AUTHORIZED":"CONDITIONAL";$("#planBadge").className="apex-chip "+(g.automaticExecutionReady?"ok":"warn");
    $("#planNote").textContent=g.automaticExecutionReady?"Execution gate reports an authorized path. Order submission remains subject to live controls and reconciliation.":"Levels are informational/conditional while the execution gate is blocked.";
  }
  function renderWhy(a,g){
    const reasons=(a.ux?.whyNoTrade||g.reasons||["No current blocking reason published."]).slice(0,8);$("#whyNoTrade").innerHTML=reasons.map(x=>'<div class="apex-listItem">'+esc(x)+'</div>').join("");$("#whyBadge").textContent=reasons.length?"ACTIVE":"CLEAR";
  }
  function renderBook(ob){
    const asks=Array.isArray(ob.asks)?ob.asks.slice(0,6).reverse():[],bids=Array.isArray(ob.bids)?ob.bids.slice(0,6):[];const rows=[];
    asks.forEach(x=>rows.push('<div class="apex-bookRow apex-ask"><span>ASK</span><b>'+n(x[1],3)+'</b><span>'+n(x[0],2)+'</span></div>'));
    if(ob.midPrice)rows.push('<div class="apex-bookRow"><span>MID</span><b>'+n(ob.midPrice,2)+'</b><span>'+n(ob.spreadBps,1)+' bps</span></div>');
    bids.forEach(x=>rows.push('<div class="apex-bookRow apex-bid"><span>BID</span><b>'+n(x[1],3)+'</b><span>'+n(x[0],2)+'</span></div>'));
    $("#orderBook").innerHTML=rows.length?rows.join(""):'<div class="apex-note">Order book unavailable.</div>';
  }
  function renderTape(rows){
    const a=Array.isArray(rows)?rows.slice(-16).reverse():[];$("#tapeBadge").textContent=a.length?a.length+" updates":"warming";
    $("#tape").innerHTML=a.length?a.map(x=>'<div class="apex-feedRow"><span>'+new Date(x.ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})+'</span><b class="'+(Number(x.cvd)>=0?"ok":"bad")+'">'+(Number(x.cvd)>=0?"BUY":"SELL")+'</b><span>'+n(x.markPrice??x.lastPrice,2)+'</span></div>').join(""):'<div class="apex-note">Waiting for live trade flow…</div>';
  }

  function drawMain(){
    const c=$("#mainApexChart");if(!c||!S.candles.length)return;const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
    const data=S.candles.slice(S.start,S.start+S.range);if(!data.length)return;const highs=data.map(x=>Number(x.h)||0),lows=data.map(x=>Number(x.l)||0);let hi=Math.max(...highs),lo=Math.min(...lows),pad=(hi-lo||1)*.08;hi+=pad;lo-=pad;
    const L=14,R=78,T=12,B=34,PH=h-T-B,PW=w-L-R,px=i=>L+(i+.5)*PW/data.length,py=v=>T+(hi-v)/(hi-lo)*PH;
    g.fillStyle="#06090d";g.fillRect(0,0,w,h);
    g.font="9px Inter,system-ui";g.strokeStyle="rgba(174,196,218,.08)";g.lineWidth=1;
    for(let i=0;i<=8;i++){const y=T+PH*i/8;g.beginPath();g.moveTo(L,y);g.lineTo(L+PW,y);g.stroke();g.fillStyle="#637184";g.fillText(n(hi-(hi-lo)*i/8,2),L+PW+8,y+3)}
    for(let i=0;i<=7;i++){const x=L+PW*i/7;g.strokeStyle="rgba(174,196,218,.055)";g.beginPath();g.moveTo(x,T);g.lineTo(x,T+PH);g.stroke()}
    const bw=Math.max(2.5,PW/data.length*.64);
    if(S.chartMode==="line"){g.strokeStyle="#55e6d0";g.lineWidth=1.7;g.beginPath();data.forEach((v,i)=>{const y=py(Number(v.c)),x=px(i);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()}
    else data.forEach((v,i)=>{const o=Number(v.o),cl=Number(v.c),xh=Number(v.h),xl=Number(v.l),x=px(i),up=cl>=o,cc=up?"#45e39d":"#ff667a";g.strokeStyle=cc;g.fillStyle=cc;g.beginPath();g.moveTo(x,py(xh));g.lineTo(x,py(xl));g.stroke();const y1=py(Math.max(o,cl)),y2=py(Math.min(o,cl));g.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1))});
    function ema(period){let prev=null,out=[];const k=2/(period+1);data.forEach(v=>{const cl=Number(v.c);prev=prev==null?cl:cl*k+prev*(1-k);out.push(prev)});return out}
    [["20","#f3bf4f"],["50","#6ea8ff"]].forEach(([period,color])=>{const a=ema(Number(period));g.strokeStyle=color;g.lineWidth=1.25;g.beginPath();a.forEach((v,i)=>{const x=px(i),y=py(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke()});
    const maxVol=Math.max(...data.map(v=>Number(v.v)||Number(v.volume)||0),1);data.forEach((v,i)=>{const vol=Number(v.v??v.volume)||0;if(!vol)return;const bh=Math.min(42,vol/maxVol*42),x=px(i);g.fillStyle=Number(v.c)>=Number(v.o)?"rgba(69,227,157,.24)":"rgba(255,102,122,.20)";g.fillRect(x-bw/2,T+PH-bh,bw,bh)});
    for(let i=0;i<7;i++){const idx=Math.min(data.length-1,Math.floor(i*data.length/6)),v=data[idx];if(!v)continue;g.fillStyle="#667486";g.fillText(new Date(v.t).toLocaleString([], {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}),L+idx*PW/data.length,T+PH+20)}
    const last=data[data.length-1];if(last){g.fillStyle="#55e6d0";g.fillRect(L+PW-1,py(Number(last.c))-5,7,10);g.fillStyle="#07110f";g.font="800 8px Inter";g.fillText(n(last.c,2),L+PW+10,py(Number(last.c))+3)}
  }

  function drawMini(canvasId,vals,color,fill=false){
    const c=$("#"+canvasId);if(!c)return;const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
    g.fillStyle="#06090d";g.fillRect(0,0,w,h);const a=vals.filter(v=>Number.isFinite(Number(v)));if(a.length<2)return;let hi=Math.max(...a),lo=Math.min(...a);if(hi===lo){hi+=1;lo-=1}
    const pad=(hi-lo)*.14;hi+=pad;lo-=pad;const X=i=>8+i*(w-16)/(a.length-1),Y=v=>6+(hi-v)/(hi-lo)*(h-16);
    g.strokeStyle="rgba(174,196,218,.08)";for(let i=1;i<5;i++){const y=i*h/5;g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke()}
    if(fill){g.beginPath();a.forEach((v,i)=>{const x=X(i),y=Y(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.lineTo(X(a.length-1),h);g.lineTo(X(0),h);g.closePath();g.fillStyle=color.replace(")"," / .10)").replace("rgb","rgba");try{g.fill()}catch{}}
    g.beginPath();a.forEach((v,i)=>{const x=X(i),y=Y(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.strokeStyle=color;g.lineWidth=1.6;g.stroke();
  }
  function drawMiniBars(canvasId,buy,sell){
    const c=$("#"+canvasId);if(!c)return;const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle="#06090d";g.fillRect(0,0,w,h);const a=Math.max(1,Math.max(...buy,...sell));const N=Math.max(buy.length,sell.length),bw=Math.max(2,(w-12)/N*.65);for(let i=0;i<N;i++){const x=6+i*(w-12)/N;const b=(Number(buy[i])||0)/a*(h-12),s=(Number(sell[i])||0)/a*(h-12);g.fillStyle="rgba(69,227,157,.58)";g.fillRect(x,h-6-b,bw/2,b);g.fillStyle="rgba(255,102,122,.58)";g.fillRect(x+bw/2,h-6-s,bw/2,s)}}
  function drawMiniCharts(){
    const h=S.history;if(!h.length)return;
    drawMini("cvdCanvas",h.map(x=>x.cvd),"#55e6d0",false);drawMini("oiCanvas",h.map(x=>x.oi),"#6ea8ff",false);
    drawMiniBars("liqCanvas",h.map(x=>x.longLiq),h.map(x=>x.shortLiq));drawMini("fundCanvas",h.map(x=>x.funding),"#aa8cff",false);
  }

  function renderFlowViews(){
    const l=S.live||{},a=S.apex||{},c=a.canonical||{},d=S.decision||{},flow=l||c||d.derivatives||{};
    $("#flowSummary").innerHTML=[["CVD state",flow.cvdState||"—"],["CVD ratio",n(flow.cvdRatio,4)],["Taker imbalance",Number.isFinite(Number(flow.takerImbalance))?n(Number(flow.takerImbalance)*100,2)+"%":"—"],["OI change",Number.isFinite(Number(flow.oiChangePct))?n(flow.oiChangePct,2)+"%":"—"]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
    $("#liqSummary").innerHTML=[["Liquidation bias",flow.liquidationBias||"—"],["Long liq",n(flow.longLiquidations,0)],["Short liq",n(flow.shortLiquidations,0)],["Total",n(flow.liquidationTotal,0)]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
    $("#positionSummary").innerHTML=[["Positioning",flow.positioning||"—"],["Long %",Number.isFinite(Number(flow.longPercent))?n(flow.longPercent,2)+"%":"—"],["Short %",Number.isFinite(Number(flow.shortPercent))?n(flow.shortPercent,2)+"%":"—"],["Funding",Number.isFinite(Number(flow.fundingRate))?n(Number(flow.fundingRate)*100,4)+"%":"—"]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
    const g=a.executionGate||{};$("#riskSurface").innerHTML=[["Gate",g.status||"WAIT"],["Quality",p(a.quality)],["R:R",n(g.rr,2)+"R"],["Canonical",a.synchronization?.ok!==false?"PASS":"BLOCK"],["Kill switch",S.exec?.control?.killSwitch?"ON":"OFF"]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
    $("#failureModes").innerHTML=(g.reasons||a.ux?.whyNoTrade||["No published failure mode."]).slice(0,8).map(x=>'<div class="apex-listItem">'+esc(x)+'</div>').join("");
    $("#researchRows").innerHTML=[["Signal version",a.version||"401–500"],["Canonical hash",String(a.canonical?.hash||"—").slice(0,16)],["Decision state",a.command||"WAIT"],["Historical validation","See replay / learning surfaces"],["System cadence","1s canonical refresh target"]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
    $("#adminRows").innerHTML=[["Dashboard renderer","APEX V2"],["Canonical sync",a.synchronization?.ok!==false?"PASS":"MISMATCH"],["Live execution",S.exec?.mode||"PAPER"],["Auto execution gate",g.automaticExecutionReady?"READY":"BLOCKED"],["Last refresh",new Date().toLocaleTimeString()]].map(r=>'<div class="apex-row"><span>'+r[0]+'</span><b>'+esc(r[1])+'</b></div>').join("");
  }

  function renderMarkets(){
    const syms=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT"];$("#marketMatrix").innerHTML=syms.map((s,i)=>'<button class="apex-listItem" style="cursor:pointer;text-align:left" data-symbol="'+s+'"><b>'+s+'</b><span style="float:right;color:var(--apex-muted)">terminal switch</span></button>').join("");
    $("#marketMatrix").onclick=e=>{const b=e.target.closest("[data-symbol]");if(!b)return;S.symbol=b.dataset.symbol;$("#apexSymbol").value=S.symbol;S.activeView="command";document.querySelectorAll("#apexNav button").forEach(x=>x.classList.toggle("on",x.dataset.view==="command"));document.querySelectorAll(".apex-view").forEach(x=>x.classList.toggle("on",x.dataset.panel==="command"));refresh(true)};
  }

  setInterval(()=>{if(document.visibilityState==="visible")refresh(false)},1000);
  window.addEventListener("DOMContentLoaded",mount);
})();
