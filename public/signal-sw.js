self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={title:"MarketPulse signal",body:"A new BTC signal is available."}}
  const title=data.title||"MarketPulse signal";
  const options={
    body:data.body||"A new BTC signal is available.",
    icon:data.icon||"/favicon.ico",
    badge:data.badge||"/favicon.ico",
    tag:data.tag||"marketpulse-signal",
    renotify:data.renotify!==false,
    data:data.data||{url:"/"}
  };
  event.waitUntil(self.registration.showNotification(title,options));
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
