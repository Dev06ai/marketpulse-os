const CACHE_NAME="marketpulse-shell-v6";
const SHELL_ASSETS=["/","/manifest.json","/marketpulse-icon-v4.svg","/marketpulse-icon-maskable-v4.svg"];

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{await cache.addAll(SHELL_ASSETS)}catch{}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  // Network-first navigation keeps the installed app on the latest MarketPulse build.
  if(request.mode==="navigate"){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){
          const cache=await caches.open(CACHE_NAME);
          cache.put("/",response.clone()).catch(()=>{});
        }
        return response;
      }catch{
        return (await caches.match("/"))||Response.error();
      }
    })());
    return;
  }

  // Cache static app resources after a successful network fetch; API requests stay live.
  const isStatic=/.(?:js|mjs|css|svg|png|jpg|jpeg|webp|ico|json)$/i.test(url.pathname);
  if(isStatic){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){
          const cache=await caches.open(CACHE_NAME);
          cache.put(request,response.clone()).catch(()=>{});
        }
        return response;
      }catch{
        return (await caches.match(request))||Response.error();
      }
    })());
  }
});

self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={title:"MarketPulse signal",body:"A new BTC signal is available."}};

  const isSignal=data.type==="MARKETPULSE_SIGNAL";
  const title=data.title||"MarketPulse signal";
  const options={
    body:data.body||"A new BTC signal is available.",
    icon:data.icon||"/marketpulse-icon-v4.svg",
    badge:data.badge||"/marketpulse-icon-v4.svg",
    tag:data.tag||(isSignal?"marketpulse-signal":"marketpulse"),
    renotify:data.renotify!==false,
    requireInteraction:Boolean(data.requireInteraction&&isSignal),
    vibrate:isSignal?[80,50,120]:undefined,
    data:data.data||{url:"/"}
  };

  event.waitUntil((async()=>{
    await self.registration.showNotification(title,options);
    if(isSignal){
      const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
      windows.forEach(client=>{
        try{client.postMessage({type:"MARKETPULSE_SIGNAL",alert:data.data?.alert||data})}catch{}
      });
    }
  })());
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=event.notification?.data?.url||"/";
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){
      try{await client.focus();if("navigate"in client)await client.navigate(url);return}catch{}
    }
    await clients.openWindow(url);
  })());
});