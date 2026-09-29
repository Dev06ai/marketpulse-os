(function(){
"use strict";
function boot(){
  var root=document.querySelector("#apexV2Root");
  if(!root){setTimeout(boot,120);return}
  root.classList.add("nexusSkin");
  if(!document.querySelector("#nexusSideRail")){
    var rail=document.createElement("aside");rail.id="nexusSideRail";
    rail.innerHTML='<div class="railLogo">MP</div><button class="on" data-v="Command">CMD</button><button data-v="Markets">MKT</button><button data-v="Flow">FLOW</button><button data-v="Risk">RISK</button><button data-v="Replay">RPLY</button><button data-v="Research">LAB</button><button data-v="Admin">SYS</button><div class="railFoot">NEXUS<br>ONE FRAME</div>';
    document.body.appendChild(rail);
    rail.addEventListener("click",function(e){
      var b=e.target.closest("button[data-v]");if(!b)return;
      var top=Array.prototype.slice.call(root.querySelectorAll(".apex-nav button")).find(function(x){return x.textContent.trim()===b.dataset.v});
      if(top){top.click();rail.querySelectorAll("button").forEach(function(x){x.classList.toggle("on",x===b)})}
    });
  }
  if(!document.querySelector("#nexusTickerStrip")){
    var ticker=document.createElement("div");ticker.id="nexusTickerStrip";
    ticker.innerHTML='<div class="tickerBox"><small>Market state</small><b id="nxMode">—</b></div><div class="tickerBox"><small>Signal</small><b id="nxSignal">—</b></div><div class="tickerBox"><small>Canonical</small><b id="nxCanon">—</b></div><div class="tickerBox"><small>Execution</small><b id="nxExec">—</b></div><div class="tickerBox"><small>Live price</small><b id="nxFrame">—</b></div>';
    var banner=root.querySelector(".apex-banner");if(banner)banner.parentNode.insertBefore(ticker,banner);
  }
  var rename={ "Price Action Command Chart":"PRICE MATRIX","Decision Center / APEX State":"SIGNAL COCKPIT","Execution & Safety":"ORDER GATE","Canonical Integrity":"FRAME INTEGRITY","Why No Trade / Next Change":"RELEASE CONDITIONS","Market Tape":"TAPE / FLOW","Evidence Matrix":"EVIDENCE GRID","Execution Timeline":"STATE TIMELINE" };
  root.querySelectorAll("*").forEach(function(el){
    if(el.children.length===0){var t=el.textContent.trim();if(rename[t])el.textContent=rename[t]}
  });
  if(!window.__nexusTickerTimer){
    window.__nexusTickerTimer=setInterval(function(){
      var q=function(s){return root.querySelector(s)};
      var mode=q("#mp401Decision")?q("#mp401Decision").textContent:"—";
      var canon=q("#mp401SyncBadge")?q("#mp401SyncBadge").textContent:"—";
      var exec=q("#mp401AutoBadge")?q("#mp401AutoBadge").textContent:"—";
      var price=q("#mp401Price")?q("#mp401Price").textContent:"—";
      var a=document.querySelector("#nxMode"),b=document.querySelector("#nxSignal"),c=document.querySelector("#nxCanon"),d=document.querySelector("#nxExec"),f=document.querySelector("#nxFrame");
      if(a)a.textContent=mode||"—";if(b)b.textContent=mode||"—";if(c)c.textContent=canon||"—";if(d)d.textContent=exec||"—";if(f)f.textContent=price||"—";
      var rail=document.querySelector("#nexusSideRail");if(rail){var active=q(".apex-nav button.active");if(active){var name=active.textContent.trim();rail.querySelectorAll("button").forEach(function(x){x.classList.toggle("on",x.dataset.v===name)})}}
    },500);
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();