self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={title:"MarketPulse signal",body:"A new BTC signal is available."}}

  const isSignal=data.type==="MARKETPULSE_SIGNAL";
  const title=data.title||"MarketPulse signal";
  const options={
    body:data.body||"A new BTC signal is available.",
    icon:data.icon||"/marketpulse-icon.svg",
    badge:data.badge||"/marketpulse-icon.svg",
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
        try{
          client.postMessage({type:"MARKETPULSE_SIGNAL",alert:data.data?.alert||data});
        }catch{}
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
      try{await client.focus();if("navigate"in client)await client.navigate(url);return;}catch{}
    }
    await clients.openWindow(url);
  })());
});