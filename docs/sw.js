/* minimal service worker so the app can be installed to the home screen.
   It does not cache anything: every request goes to the network as usual, so updates show up right away. */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",()=>{});
