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

  const css = String.raw`
  :root{--apex-text:#f4f8fc;--apex-muted:#8190a1;--apex-dim:#536173;--apex-cyan:#54f7e0;--apex-lime:#c9ff43;--apex-violet:#a98aff;--apex-green:#35e7a5;--apex-red:#ff5577;--apex-amber:#ffcc66;--apex-shadow:0 24px 90px rgba(0,0,0,.34)}
  body.apexV2Active{background:#030408!important;color:var(--apex-text)!important} body.apexV2Active:before{display:none!important}
  #apexV2Root{position:fixed;inset:0;z-index:9999;overflow:auto;background:radial-gradient(900px 500px at 8% -12%,rgba(84,247,224,.10),transparent 58%),radial-gradient(800px 520px at 96% 0%,rgba(201,255,67,.07),transparent 55%),linear-gradient(180deg,#04070c,#070b11 46%,#030509);color:var(--apex-text);font:12px Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #apexV2Root *{box-sizing:border-box} #apexV2Root .apex-shell{min-height:100%;padding:12px 16px 38px}
  #apexV2Root .apex-top{position:sticky;top:10px;z-index:30;display:grid;grid-template-columns:260px minmax(360px,1fr) auto;gap:14px;align-items:center;padding:9px 11px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(5,8,13,.80);backdrop-filter:blur(24px) saturate(140%);box-shadow:0 14px 55px rgba(0,0,0,.38)}
  #apexV2Root .apex-brand{display:flex;align-items:center;gap:10px} #apexV2Root .apex-logo{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;color:#05100d;font-size:10px;font-weight:1000;background:linear-gradient(145deg,var(--apex-lime),var(--apex-cyan) 48%,var(--apex-violet));box-shadow:0 0 30px rgba(84,247,224,.18)}
  #apexV2Root .apex-brand b{font-size:16px;letter-spacing:-.045em} #apexV2Root .apex-brand small{display:block;color:#667486;font-size:7px;margin-top:3px;letter-spacing:.16em;text-transform:uppercase}
  #apexV2Root .apex-nav{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;overflow:auto;scrollbar-width:none} #apexV2Root .apex-nav::-webkit-scrollbar{display:none}
  #apexV2Root .apex-nav button{border:1px solid transparent;background:transparent;color:#6f7e90;padding:8px 12px;border-radius:9px;cursor:pointer;font-size:9px;font-weight:900;letter-spacing:.03em;white-space:nowrap}
  #apexV2Root .apex-nav button:hover{color:#e9f4f2;background:rgba(255,255,255,.035)} #apexV2Root .apex-nav button.on{color:#04110d;background:linear-gradient(135deg,var(--apex-lime),#a6ffe8);box-shadow:0 8px 24px rgba(201,255,67,.12)}
  #apexV2Root .apex-tools{display:flex;align-items:center;gap:6px;justify-content:flex-end} #apexV2Root .apex-select,#apexV2Root .apex-btn{border:1px solid rgba(255,255,255,.09);background:#0a1017;color:#eaf1f7;border-radius:9px;padding:8px 10px;font-size:9px;font-weight:900}
  #apexV2Root .apex-btn{cursor:pointer} #apexV2Root .apex-btn:hover{border-color:rgba(84,247,224,.28)}
  #apexV2Root .apex-live{display:inline-flex;align-items:center;gap:6px;padding:7px 9px;border:1px solid rgba(53,231,165,.19);border-radius:999px;color:#8ff0c5;background:rgba(53,231,165,.035);font-size:8px;font-weight:950} #apexV2Root .apex-live i{width:7px;height:7px;border-radius:50%;background:var(--apex-green);box-shadow:0 0 14px var(--apex-green)}
  #apexV2Root .apex-banner{margin:10px 0 8px;padding:8px 12px;border:1px solid rgba(84,247,224,.10);border-radius:12px;background:linear-gradient(90deg,rgba(84,247,224,.035),rgba(169,138,255,.03),rgba(201,255,67,.025));display:flex;align-items:center;justify-content:space-between;gap:12px}
  #apexV2Root .apex-banner b{font-size:8px;letter-spacing:.14em;text-transform:uppercase} #apexV2Root .apex-banner span{font-size:8px;color:#718093} #apexV2Root .apex-state{font-weight:950}
  #apexV2Root .ok{color:var(--apex-green)!important} #apexV2Root .bad{color:var(--apex-red)!important} #apexV2Root .warn{color:var(--apex-amber)!important} #apexV2Root .violet{color:var(--apex-violet)!important}
  #apexV2Root .apex-kpis{display:grid;grid-template-columns:1.3fr repeat(6,1fr);gap:1px;padding:1px;border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;background:rgba(255,255,255,.07)}
  #apexV2Root .apex-kpi{padding:11px 12px;background:rgba(6,10,15,.92);min-width:0} #apexV2Root .apex-kpi:first-child{background:linear-gradient(135deg,rgba(84,247,224,.08),rgba(6,10,15,.96))}
  #apexV2Root .apex-k{font-size:7px;color:#617083;text-transform:uppercase;letter-spacing:.13em} #apexV2Root .apex-v{margin-top:4px;font-size:17px;font-weight:1000;letter-spacing:-.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #apexV2Root .apex-sub{margin-top:3px;color:#617083;font-size:7px}
  #apexV2Root .apex-layout{display:grid;grid-template-columns:minmax(0,1.68fr) minmax(360px,.72fr);gap:10px;margin-top:10px} #apexV2Root .apex-col{min-width:0}
  #apexV2Root .apex-card{position:relative;border:1px solid rgba(255,255,255,.075);border-radius:14px;background:linear-gradient(180deg,rgba(10,15,21,.95),rgba(5,8,13,.97));box-shadow:var(--apex-shadow);overflow:hidden}
  #apexV2Root .apex-card:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(120deg,rgba(84,247,224,.025),transparent 26%,transparent 72%,rgba(201,255,67,.018))}
  #apexV2Root .apex-cardHead{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-bottom:1px solid rgba(255,255,255,.055)} #apexV2Root .apex-title{font-size:9px;font-weight:1000;letter-spacing:.10em;text-transform:uppercase} #apexV2Root .apex-headRight{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
  #apexV2Root .apex-chip{padding:5px 7px;border-radius:7px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.018);color:#7f8d9e;font-size:7px;font-weight:950;letter-spacing:.05em}
  #apexV2Root .apex-chartTools{display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:7px 9px;background:rgba(4,7,11,.64);border-bottom:1px solid rgba(255,255,255,.045)}
  #apexV2Root .apex-chartTools button{border:1px solid rgba(255,255,255,.065);background:#0a1017;color:#738297;padding:6px 8px;border-radius:7px;font-size:8px;font-weight:900;cursor:pointer} #apexV2Root .apex-chartTools button.on{color:#08110e;background:linear-gradient(135deg,var(--apex-lime),var(--apex-cyan));border-color:transparent}
  #apexV2Root .apex-chartWrap{height:585px;position:relative;background:radial-gradient(500px 280px at 60% 36%,rgba(84,247,224,.035),transparent 65%),linear-gradient(180deg,#070b11,#03060b)}
  #apexV2Root .apex-chartWrap:after{content:"";position:absolute;inset:0;pointer-events:none;opacity:.28;background-image:linear-gradient(rgba(130,154,180,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(130,154,180,.035) 1px,transparent 1px);background-size:34px 34px;mix-blend-mode:screen}
  #apexV2Root .apex-canvas{display:block;width:100%;height:100%;touch-action:none;position:relative;z-index:1} #apexV2Root .apex-crossLabel{position:absolute;display:none;pointer-events:none;padding:6px 8px;border-radius:7px;background:rgba(5,10,15,.94);border:1px solid rgba(84,247,224,.20);font-size:8px;color:#e7f4f1;white-space:nowrap;z-index:4}
  #apexV2Root .apex-decision{padding:0} #apexV2Root .apex-decision .apex-cardHead{padding:13px 14px} #apexV2Root .apex-decision:after{content:"DECISION ENGINE";position:absolute;right:12px;top:-8px;padding:3px 7px;border-radius:5px;font-size:6px;font-weight:1000;letter-spacing:.15em;color:#06100e;background:var(--apex-lime)}
  #apexV2Root .apex-signal{position:relative;margin:12px;padding:16px 14px;border-radius:14px;border:1px solid rgba(84,247,224,.14);background:radial-gradient(circle at 80% 0%,rgba(84,247,224,.12),transparent 30%),linear-gradient(145deg,rgba(84,247,224,.045),rgba(169,138,255,.045));overflow:hidden}
  #apexV2Root .apex-signal:before{content:"";position:absolute;inset:-35px auto auto -35px;width:120px;height:120px;border-radius:50%;border:1px solid rgba(84,247,224,.18);box-shadow:0 0 0 10px rgba(84,247,224,.025),0 0 0 22px rgba(84,247,224,.016)}
  #apexV2Root .apex-signalState{font-size:40px;font-weight:1000;letter-spacing:-.07em;line-height:.95} #apexV2Root .apex-signalMeta{font-size:8px;color:#8190a1;line-height:1.55;text-align:right}
  #apexV2Root .apex-bars{display:grid;gap:8px;margin:2px 12px 14px} #apexV2Root .apex-barRow{display:grid;grid-template-columns:50px 1fr 44px;gap:7px;align-items:center;font-size:8px;color:#758397}
  #apexV2Root .apex-track{height:8px;background:#121a22;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,.035)} #apexV2Root .apex-fill{height:100%;border-radius:999px;box-shadow:0 0 14px rgba(84,247,224,.10)}
  #apexV2Root .apex-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:10px} #apexV2Root .apex-mini{min-height:145px} #apexV2Root .apex-mini canvas{display:block;width:100%;height:116px}
  #apexV2Root .apex-split{display:grid;grid-template-columns:1.1fr .9fr;gap:8px;margin-top:10px} #apexV2Root .apex-panelBody{padding:12px}
  #apexV2Root .apex-rows{display:grid;gap:6px} #apexV2Root .apex-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:8px 9px;border:1px solid rgba(255,255,255,.055);border-radius:8px;background:rgba(255,255,255,.012);font-size:8px}
  #apexV2Root .apex-row span{color:#718094} #apexV2Root .apex-row b{text-align:right;font-weight:950}
  #apexV2Root .apex-integrity{display:grid;grid-template-columns:repeat(3,1fr);gap:6px} #apexV2Root .apex-integrity div{padding:9px;border:1px solid rgba(255,255,255,.055);border-radius:9px;background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,.006))}
  #apexV2Root .apex-integrity small,#apexV2Root .apex-plan small{display:block;color:#566579;font-size:6.5px;text-transform:uppercase;letter-spacing:.10em} #apexV2Root .apex-integrity b,#apexV2Root .apex-plan b{display:block;margin-top:5px;font-size:9px}
  #apexV2Root .apex-plan{display:grid;grid-template-columns:repeat(4,1fr);gap:6px} #apexV2Root .apex-plan div{padding:10px;border:1px solid rgba(255,255,255,.055);border-radius:9px;background:linear-gradient(145deg,rgba(84,247,224,.024),rgba(255,255,255,.006))}
  #apexV2Root .apex-feed{display:grid;gap:4px;max-height:180px;overflow:auto} #apexV2Root .apex-feedRow{display:grid;grid-template-columns:58px 48px 1fr;gap:7px;padding:6px 7px;font-size:8px;border-bottom:1px solid rgba(255,255,255,.045)} #apexV2Root .apex-feedRow span{color:#6f7e92}
  #apexV2Root .apex-book{display:grid;gap:2px} #apexV2Root .apex-bookRow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;font-size:8px;padding:4px 6px;border-radius:6px} #apexV2Root .apex-bookRow span:nth-child(2){text-align:center} #apexV2Root .apex-bookRow b{text-align:right}
  #apexV2Root .apex-ask{background:linear-gradient(90deg,transparent,rgba(255,85,119,.07))} #apexV2Root .apex-bid{background:linear-gradient(90deg,transparent,rgba(53,231,165,.07))}
  #apexV2Root .apex-bottomGrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px} #apexV2Root .apex-note{font-size:8px;line-height:1.5;color:#8997a8} #apexV2Root .apex-bigMetric{font-size:24px;font-weight:1000} #apexV2Root .apex-list{display:grid;gap:6px}
  #apexV2Root .apex-listItem{padding:9px 10px;border:1px solid rgba(255,255,255,.05);border-radius:8px;font-size:8px;color:#dbe5ec;background:rgba(255,255,255,.008)}
  #apexV2Root .apex-command{display:grid;grid-template-columns:1fr 1fr;gap:7px} #apexV2Root .apex-command button{border:1px solid rgba(255,255,255,.08);background:#0b1118;color:#e2ebf3;padding:10px;border-radius:8px;cursor:pointer;font-size:8px;font-weight:950}
  #apexV2Root .apex-command button:hover{border-color:rgba(84,247,224,.30);background:#0d151d}
  #apexV2Root .apex-view{display:none} #apexV2Root .apex-view.on{display:block}
  #apexV2Root .apex-modal{position:fixed;inset:0;background:rgba(0,0,0,.68);backdrop-filter:blur(12px);display:none;align-items:center;justify-content:center;z-index:40} #apexV2Root .apex-modal.on{display:flex}
  #apexV2Root .apex-modalCard{width:min(580px,calc(100vw - 28px));border:1px solid rgba(84,247,224,.16);border-radius:16px;background:#090e14;box-shadow:0 30px 120px rgba(0,0,0,.62);padding:18px}
  #apexV2Root .apex-modalCard h3{margin:0 0 7px;font-size:15px} #apexV2Root .apex-modalCard p{font-size:9px;color:#92a0b0;line-height:1.6}
  @media(max-width:1250px){#apexV2Root .apex-top{grid-template-columns:230px 1fr}#apexV2Root .apex-tools{grid-column:1/-1;justify-content:flex-start}#apexV2Root .apex-kpis{grid-template-columns:repeat(4,1fr)}#apexV2Root .apex-layout{grid-template-columns:1fr}#apexV2Root .apex-chartWrap{height:540px}}
  @media(max-width:760px){#apexV2Root .apex-shell{padding:8px 8px 28px}#apexV2Root .apex-top{grid-template-columns:1fr;top:0;border-radius:12px}#apexV2Root .apex-nav{justify-content:flex-start}#apexV2Root .apex-tools{flex-wrap:wrap}#apexV2Root .apex-kpis{grid-template-columns:repeat(2,1fr)}#apexV2Root .apex-chartWrap{height:430px}#apexV2Root .apex-grid,#apexV2Root .apex-split,#apexV2Root .apex-bottomGrid{grid-template-columns:1fr}#apexV2Root .apex-plan{grid-template-columns:1fr 1fr}#apexV2Root .apex-integrity{grid-template-columns:1fr 1fr}}
`;
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
    root.innerHTML=`
      <div class="apex-shell">
        <header class="apex-top">
          <div class="apex-brand"><div class="apex-logo">MP</div><div><b>MarketPulse NEXUS</b><small>real-time decision workspace</small></div></div>
          <nav class="apex-nav" id="apexNav">
            <button class="on" data-view="command">Command</button><button data-view="markets">Markets</button><button data-view="flow">Flow</button><button data-view="risk">Risk</button><button data-view="replay">Replay</button><button data-view="research">Research</button><button data-view="admin">Admin</button>
          </nav>
          <div class="apex-tools">
            <select id="apexSymbol" class="apex-select"><option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option><option>BNBUSDT</option><option>XRPUSDT</option><option>DOGEUSDT</option><option>ADAUSDT</option></select>
            <select id="apexTf" class="apex-select"><option>15m</option><option>30m</option><option>1h</option><option>4h</option><option>1d</option></select>
            <span class="apex-live"><i></i>LIVE DATA</span><button id="apexAccount" class="apex-btn">ACCOUNT</button>
          </div>
        </header>

        <div class="apex-banner"><div><b id="apexBannerTitle">MARKET COMMAND</b> <span id="apexBannerText">One synchronized market frame feeds the chart, signal engine and execution surfaces.</span></div><div id="apexBannerState" class="apex-state">SYNC —</div></div>

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
                <div class="apex-cardHead"><div><div class="apex-title">PRICE / LIQUIDITY MAP</div><div class="apex-sub">candles · 20/50 EMA · volume · signal & integrity markers</div></div><div class="apex-headRight"><span id="chartModeChip" class="apex-chip">CANDLES</span><span class="apex-chip">CANONICAL</span></div></div>
                <div class="apex-chartTools" id="chartTools">
                  <button data-tf="15m">15m</button><button data-tf="30m">30m</button><button data-tf="1h">1h</button><button data-tf="4h">4h</button><button data-tf="1d">1d</button><span style="flex:1"></span>
                  <button data-mode="candles" class="on">CANDLES</button><button data-mode="line">LINE</button><button id="fitChart">FIT</button>
                </div>
                <div class="apex-chartWrap"><canvas id="mainApexChart" class="apex-canvas"></canvas><div id="crossLabel" class="apex-crossLabel"></div></div>
              </section>

              <div class="apex-grid">
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">CVD PRESSURE</div><span id="cvdBadge" class="apex-chip">—</span></div><canvas id="cvdCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">Open Interest</div><span id="oiBadge" class="apex-chip">—</span></div><canvas id="oiCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">LIQUIDATION PRESSURE</div><span id="liqBadge" class="apex-chip">—</span></div><canvas id="liqCanvas"></canvas></section>
                <section class="apex-card apex-mini"><div class="apex-cardHead"><div class="apex-title">FUNDING / POSITIONING</div><span id="fundBadge" class="apex-chip">—</span></div><canvas id="fundCanvas"></canvas></section>
              </div>

              <div class="apex-split">
                <section class="apex-card"><div class="apex-cardHead"><div class="apex-title">TRADE MAP</div><span id="planBadge" class="apex-chip">WAIT</span></div><div class="apex-panelBody"><div class="apex-plan"><div><small>Side</small><b id="planSide">WAIT</b></div><div><small>Entry</small><b id="planEntry">—</b></div><div><small>Invalidation</small><b id="planStop">—</b></div><div><small>Target</small><b id="planTp">—</b></div></div><div class="apex-note" id="planNote" style="margin-top:9px">Levels remain conditional until the execution gate authorizes them.</div></div></section>
                <section class="apex-card"><div class="apex-cardHead"><div class="apex-title">LIVE FLOW</div><span id="tapeBadge" class="apex-chip">warming</span></div><div class="apex-panelBody"><div id="tape" class="apex-feed"></div></div></section>
              </div>
            </div>

            <aside class="apex-col">
              <section class="apex-card apex-decision">
                <div class="apex-cardHead"><div class="apex-title">DECISION ENGINE</div><span id="decisionGate" class="apex-chip">WAIT</span></div>
                <div class="apex-signal"><div><div id="decisionState" class="apex-signalState">WAIT</div><div id="decisionReason" class="apex-sub">Loading canonical decision…</div></div><div id="decisionMeta" class="apex-signalMeta">—</div></div>
                <div class="apex-bars">
                  <div class="apex-barRow"><span>LONG</span><div class="apex-track"><div id="longBar" class="apex-fill" style="background:var(--apex-green);width:0"></div></div><b id="longPct">—</b></div>
                  <div class="apex-barRow"><span>SHORT</span><div class="apex-track"><div id="shortBar" class="apex-fill" style="background:var(--apex-red);width:0"></div></div><b id="shortPct">—</b></div>
                  <div class="apex-barRow"><span>WAIT</span><div class="apex-track"><div id="waitBar" class="apex-fill" style="background:var(--apex-amber);width:0"></div></div><b id="waitPct">—</b></div>
                </div>
              </section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">EXECUTION GATE</div><span id="execBadge" class="apex-chip">BLOCKED</span></div><div class="apex-panelBody"><div id="execRows" class="apex-rows"></div><div class="apex-command" style="margin-top:8px"><button id="armLive">ARM LIVE AUTO</button><button id="killLive">KILL SWITCH</button></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">SYNC LOCK</div><span id="integrityBadge" class="apex-chip">—</span></div><div class="apex-panelBody"><div class="apex-integrity"><div><small>Price</small><b id="iPrice">—</b></div><div><small>CVD</small><b id="iCvd">—</b></div><div><small>OI</small><b id="iOi">—</b></div><div><small>Funding</small><b id="iFunding">—</b></div><div><small>Book</small><b id="iBook">—</b></div><div><small>Taker</small><b id="iTaker">—</b></div></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">Order Book</div><span id="bookBadge" class="apex-chip">live</span></div><div class="apex-panelBody"><div id="orderBook" class="apex-book"></div></div></section>

              <section class="apex-card" style="margin-top:10px"><div class="apex-cardHead"><div class="apex-title">WAIT CONDITIONS</div><span id="whyBadge" class="apex-chip">ACTIVE</span></div><div class="apex-panelBody"><div id="whyNoTrade" class="apex-list"></div></div></section>
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
    `;
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
    const c=$("#mainApexChart");if(!c||!S.candles.length)return;
    const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);
    c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
    const data=S.candles.slice(S.start,S.start+S.range);if(!data.length)return;
    const highs=data.map(x=>Number(x.h)||0),lows=data.map(x=>Number(x.l)||0);let hi=Math.max(...highs),lo=Math.min(...lows),pad=(hi-lo||1)*.10;hi+=pad;lo-=pad;
    const L=18,R=92,T=16,B=46,PH=h-T-B,PW=w-L-R,px=i=>L+(i+.5)*PW/data.length,py=v=>T+(hi-v)/(hi-lo)*PH,clampN=(v,a,b)=>Math.max(a,Math.min(b,v));
    const bg=g.createLinearGradient(0,0,0,h);bg.addColorStop(0,"#081019");bg.addColorStop(.55,"#050a11");bg.addColorStop(1,"#03060b");g.fillStyle=bg;g.fillRect(0,0,w,h);
    g.font="8px Inter,system-ui";g.lineWidth=1;
    for(let i=0;i<=9;i++){const y=T+PH*i/9;g.strokeStyle=i===4?"rgba(84,247,224,.10)":"rgba(140,165,190,.045)";g.beginPath();g.moveTo(L,y);g.lineTo(L+PW,y);g.stroke();g.fillStyle="#667589";g.fillText(n(hi-(hi-lo)*i/9,2),L+PW+10,y+3)}
    for(let i=0;i<=8;i++){const x=L+PW*i/8;g.strokeStyle="rgba(140,165,190,.035)";g.beginPath();g.moveTo(x,T);g.lineTo(x,T+PH);g.stroke()}
    const maxVol=Math.max(...data.map(v=>Number(v.v??v.volume)||0),1);
    data.forEach((v,i)=>{const vol=Number(v.v??v.volume)||0;if(!vol)return;const bh=Math.min(52,(vol/maxVol)*52),x=px(i),up=Number(v.c)>=Number(v.o);g.fillStyle=up?"rgba(53,231,165,.16)":"rgba(255,85,119,.13)";g.fillRect(x-Math.max(1,PW/data.length*.30),T+PH-bh,Math.max(2,PW/data.length*.58),bh)});
    const bw=Math.max(2.4,PW/data.length*.58);
    data.forEach((v,i)=>{const o=Number(v.o),cl=Number(v.c),xh=Number(v.h),xl=Number(v.l),x=px(i),up=cl>=o,body=up?"#35e7a5":"#ff5577",glow=up?"rgba(53,231,165,.20)":"rgba(255,85,119,.18)";g.strokeStyle=body;g.beginPath();g.moveTo(x,py(xh));g.lineTo(x,py(xl));g.stroke();const y1=py(Math.max(o,cl)),y2=py(Math.min(o,cl));g.fillStyle=glow;g.fillRect(x-bw/2-1,y1,bw+2,Math.max(1,y2-y1));g.fillStyle=body;g.fillRect(x-bw/2,y1,bw,Math.max(1,y2-y1))});
    function ema(period){let prev=null,out=[];const k=2/(period+1);data.forEach(v=>{const cl=Number(v.c);prev=prev==null?cl:cl*k+prev*(1-k);out.push(prev)});return out}
    [["20","#a98aff",1.0],["50","#54f7e0",1.8]].forEach(([period,color,width])=>{const a=ema(Number(period));g.strokeStyle=color;g.lineWidth=width;g.shadowColor=color;g.shadowBlur=width>1?7:0;g.beginPath();a.forEach((v,i)=>{const x=px(i),y=py(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();g.shadowBlur=0});
    const gate=S.apex?.executionGate||{},levels=[["TP1",Number(gate.target??S.apex?.tp1),"#c9ff43","dash"],["ENTRY",Number(gate.entry??S.apex?.entry),"#54f7e0","solid"],["SL",Number(gate.stop??S.apex?.stop),"#ff5577","dash"]];
    levels.forEach(([label,val,color,style])=>{if(!Number.isFinite(val)||val<lo||val>hi)return;const y=py(val);g.save();g.strokeStyle=color;g.lineWidth=1;if(style==="dash")g.setLineDash([6,5]);g.beginPath();g.moveTo(L,y);g.lineTo(L+PW,y);g.stroke();g.setLineDash([]);const tw=label.length*7+38;g.fillStyle=color;g.globalAlpha=.92;g.fillRect(L+8,y-10,tw,19);g.globalAlpha=1;g.fillStyle="#04100d";g.font="900 7px Inter,system-ui";g.fillText(label+"  "+n(val,2),L+15,y+3);g.restore()});
    const last=data[data.length-1];
    if(last){const y=clampN(py(Number(last.c)),T+6,T+PH-6),line=g.createLinearGradient(L+PW-120,0,L+PW+28,0);line.addColorStop(0,"rgba(84,247,224,0)");line.addColorStop(1,"rgba(84,247,224,.65)");g.strokeStyle=line;g.lineWidth=1;g.beginPath();g.moveTo(L+PW-120,y);g.lineTo(L+PW,y);g.stroke();g.fillStyle="#54f7e0";g.fillRect(L+PW-1,y-7,10,14);g.fillStyle="#03100e";g.font="900 8px Inter,system-ui";g.fillText(n(last.c,2),L+PW+13,y+3)}
    for(let i=0;i<7;i++){const idx=Math.min(data.length-1,Math.floor(i*data.length/6)),v=data[idx];if(!v)continue;g.fillStyle="#607188";g.font="8px Inter,system-ui";g.fillText(new Date(v.t).toLocaleString([], {day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}),L+idx*PW/data.length,T+PH+25)}
    const command=String(S.apex?.command||S.decision?.action||"WAIT").toUpperCase();g.fillStyle=command==="LONG"?"#35e7a5":command==="SHORT"?"#ff5577":"#ffcc66";g.font="1000 9px Inter,system-ui";g.fillText("BIAS · "+command,L+18,T+4);
  }

  function drawMini(canvasId,vals,color,fill=false){
    const c=$("#"+canvasId);if(!c)return;const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
    g.fillStyle="#03060b";g.fillRect(0,0,w,h);const a=vals.filter(v=>Number.isFinite(Number(v)));if(a.length<2)return;let hi=Math.max(...a),lo=Math.min(...a);if(hi===lo){hi+=1;lo-=1}
    const pad=(hi-lo)*.14;hi+=pad;lo-=pad;const X=i=>8+i*(w-16)/(a.length-1),Y=v=>6+(hi-v)/(hi-lo)*(h-16);
    g.strokeStyle="rgba(174,196,218,.08)";for(let i=1;i<5;i++){const y=i*h/5;g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke()}
    if(fill){g.beginPath();a.forEach((v,i)=>{const x=X(i),y=Y(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.lineTo(X(a.length-1),h);g.lineTo(X(0),h);g.closePath();g.fillStyle=color.replace(")"," / .10)").replace("rgb","rgba");try{g.fill()}catch{}}
    g.beginPath();a.forEach((v,i)=>{const x=X(i),y=Y(v);i?g.lineTo(x,y):g.moveTo(x,y)});g.strokeStyle=color;g.lineWidth=1.6;g.stroke();
  }
  function drawMiniBars(canvasId,buy,sell){
    const c=$("#"+canvasId);if(!c)return;const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);const g=c.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle="#03060b";g.fillRect(0,0,w,h);const a=Math.max(1,Math.max(...buy,...sell));const N=Math.max(buy.length,sell.length),bw=Math.max(2,(w-12)/N*.65);for(let i=0;i<N;i++){const x=6+i*(w-12)/N;const b=(Number(buy[i])||0)/a*(h-12),s=(Number(sell[i])||0)/a*(h-12);g.fillStyle="rgba(69,227,157,.58)";g.fillRect(x,h-6-b,bw/2,b);g.fillStyle="rgba(255,102,122,.58)";g.fillRect(x+bw/2,h-6-s,bw/2,s)}}
  function drawMiniCharts(){
    const h=S.history;if(!h.length)return;
    drawMini("cvdCanvas",h.map(x=>x.cvd),"#63f7df",false);drawMini("oiCanvas",h.map(x=>x.oi),"#9f7bff",false);
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
