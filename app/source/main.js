'use strict';
const {app,BrowserWindow,ipcMain,powerSaveBlocker,net,shell,Notification}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
app.setName('Temporal Live');
app.setPath('userData',path.join(app.getPath('appData'),'Science Coherence','Temporal Live'));
let mainWindow=null,blocker=null;
// One instance: opening the app again brings the open window forward.
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{if(!mainWindow)openApp();else{if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
  app.whenReady().then(()=>openApp());
}
// Fullscreen keeps the display awake; a window keeps its normal sleep.
function updatePower(){const needed=!!(mainWindow&&!mainWindow.isDestroyed()&&mainWindow.isFullScreen());if(needed&&blocker===null)blocker=powerSaveBlocker.start('prevent-display-sleep');else if(!needed&&blocker!==null){powerSaveBlocker.stop(blocker);blocker=null;}}
function secure(win){win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('before-input-event',(_event,input)=>{if(input.type==='keyDown'&&input.key==='Escape'&&win.isFullScreen()){win.setFullScreen(false);updatePower();}});win.on('enter-full-screen',updatePower);win.on('leave-full-screen',updatePower);}
const {nativeTheme}=require('electron');
// The window's own colour before the page paints, and the Windows title bar,
// follow the theme chosen in the app (light, dark, or Windows' own).
const windowColour=()=>nativeTheme.shouldUseDarkColors?'#0e1114':'#eef1f4';
// The version: package.json is the only place it is written (app.getVersion reads it).
ipcMain.on('matrix:version',e=>{e.returnValue=app.getVersion();});
ipcMain.on('matrix:theme',(e,mode)=>{
  if(!trusted(e)||!['system','light','dark'].includes(mode))return;
  nativeTheme.themeSource=mode;
  const w=BrowserWindow.fromWebContents(e.sender); if(w)w.setBackgroundColor(windowColour());
});
function options(){return {backgroundColor:windowColour(),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}};}
function openApp(){mainWindow=new BrowserWindow({...options(),width:1440,height:980,minWidth:820,minHeight:650,title:'Singularity Monitor',show:false});secure(mainWindow);mainWindow.loadFile(path.join(__dirname,'index.html'));mainWindow.once('ready-to-show',()=>mainWindow.show());mainWindow.on('closed',()=>{mainWindow=null;updatePower();app.quit();});}
const trusted=e=>BrowserWindow.fromWebContents(e.sender);
// Spotify: sign-in, token and playback control live here; the page only asks. See spotify.js.
require('./spotify.js').init({trusted});

/* ── The feed proxy ────────────────────────────────────────────────────────
   Every live request is made here, in the main process, not in the page. Two
   reasons. The page keeps a strict content policy and never needs a browser
   origin exception; and the sources that publish no cross-origin header —
   GDACS among them — are reachable from the app exactly as they are from a
   terminal. The allowlist is explicit: an unlisted host is refused, so a
   compromised renderer cannot use this as a general network hole. Responses
   are cached briefly, and simultaneous asks for the same address share one
   request. */
const FEED_HOSTS=new Set([
  // event streams
  'earthquake.usgs.gov','www.gdacs.org','eonet.gsfc.nasa.gov','services.swpc.noaa.gov',
  'api.nasa.gov',
  // planetary vitals
  'gml.noaa.gov','data.giss.nasa.gov','noaadata.apps.nsidc.org','www.cpc.ncep.noaa.gov',
  'www.star.nesdis.noaa.gov','epoch.ai','www.sidc.be','metr.org',
  // the wire
  'll.thespacedevs.com','en.wikipedia.org','api.gdeltproject.org','www.nasa.gov',
  'export.arxiv.org','www.esa.int','incidentdatabase.ai',
  // floods with people affected, and the war desks
  'reliefweb.int','www.aljazeera.com','feeds.bbci.co.uk','news.un.org',
  // the orbital catalogue and conjunction screening (Kessler watch)
  'celestrak.org',
  // peer-reviewed papers, and longevity research and news (Discovery · LEV)
  'api.crossref.org','www.ebi.ac.uk','lifespan.io',
  // energy: EIA weekly stocks and SPR history, oil futures, and positions
  // for AI data centres Epoch adds after the bundled table
  'ir.eia.gov','www.eia.gov','query1.finance.yahoo.com','nominatim.openstreetmap.org',
  // the country energy watch: each country's press, through Google News
  'news.google.com',
  // cyclones now: NOAA NHC advisories and JTWC warnings
  'www.nhc.noaa.gov','www.metoc.navy.mil',
  // society: World Bank indicators and the UN Statistics Division's SDG database
  'api.worldbank.org','unstats.un.org',
  // economy: BIS policy rates, the IMF World Economic Outlook, daily currency rates
  'stats.bis.org','api.imf.org','cdn.jsdelivr.net']);
const feedCache=new Map();
const feedInFlight=new Map();
const FEED_CACHE_MS=10000;
function fetchFeed(url,asText,head=0){
  let parsed;
  try{parsed=new URL(url);}catch{return Promise.resolve({error:'bad url'});}
  if(parsed.protocol!=='https:'||!FEED_HOSTS.has(parsed.hostname))return Promise.resolve({error:'host not allowed'});
  head=Math.max(0,Math.min(Number(head)||0,8e6))|0;
  const key=(asText?'t:':'j:')+head+':'+url;
  const cached=feedCache.get(key);
  if(cached&&Date.now()-cached.at<FEED_CACHE_MS)return Promise.resolve(cached.value);
  // Two streams can ask for the same address at once (GDACS's list, for one).
  // One request is made and the answer is handed to every caller waiting on it.
  const pending=feedInFlight.get(key);
  if(pending)return pending;
  const promise=new Promise(resolve=>{
    let request,timer,done=false,body='';
    // Finish before aborting: abort can synchronously emit more events. Keep
    // error listeners attached so late errors are handled after completion.
    const finish=(value,abort=false)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      if(value&&value.error)console.warn('[feed]',new Date().toISOString(),parsed.hostname,value.error);
      resolve(value);
      if(abort&&request){try{request.abort();}catch{}}
    };
    const fail=error=>finish({error:String(error.message||error).slice(0,80)},true);
    try{
    request=net.request({method:'GET',url,useSessionCookies:false});
    request.on('error',fail);
    request.on('abort',()=>finish({error:'request aborted'}));
    // No 'close' handler: Electron's request is a writable stream, and it
    // emits 'close' as soon as the request has been sent — before any
    // response. Treating that as a failure failed every source. A dead
    // connection reaches 'error', and anything else the timeout below.
    request.setHeader('Accept','*/*');
    request.setHeader('User-Agent','TemporalLive/1.0 (Science Coherence instrument)');
    // Only the first `head` bytes: CelesTrak's conjunction list is 22 MB and
    // sorted by risk, so its top is all that is read.
    if(head)request.setHeader('Range','bytes=0-'+(head-1));
    timer=setTimeout(()=>finish({error:'timeout'},true),60000);
    request.on('response',response=>{
      // Errors while receiving the body belong to the response, not the
      // request. Attach these even for HTTP failures and late responses.
      response.on('error',fail);
      response.on('aborted',()=>finish({error:'response aborted'},true));
      if(done){response.resume();return;}
      if(response.statusCode<200||response.statusCode>=300){finish({error:'HTTP '+response.statusCode});response.resume();return;}
      response.setEncoding('utf8');
      response.on('end',()=>{if(done)return;if(head&&body.length>=head*0.8){const nl=body.lastIndexOf('\n');if(nl>0)body=body.slice(0,nl+1);}const value=asText?body:(()=>{try{return JSON.parse(body);}catch{return {error:'unreadable response'};}})();if(!value||!value.error){if(feedCache.size>250){const now=Date.now();for(const [k,v] of feedCache)if(now-v.at>=FEED_CACHE_MS)feedCache.delete(k);if(feedCache.size>250)feedCache.delete(feedCache.keys().next().value);}feedCache.set(key,{at:Date.now(),value});}finish(value);});
      // The whole satellite catalogue is 6.7 MB; nothing read here is larger.
      // A server that ignores the range is cut off at `head`, at a line end.
      response.on('data',chunk=>{if(done)return;body+=chunk;
        if(head&&body.length>=head){const cut=body.slice(0,head);finish(cut.slice(0,cut.lastIndexOf('\n')+1),true);}
        else if(body.length>8e6)finish({error:'response too large'},true);});
    });
    request.end();
    }catch(error){fail(error);}
  });
  feedInFlight.set(key,promise);
  promise.then(()=>feedInFlight.delete(key),()=>feedInFlight.delete(key));
  return promise;
}
ipcMain.handle('matrix:feed',(e,url)=>trusted(e)?fetchFeed(String(url),false):{error:'untrusted sender'});
ipcMain.handle('matrix:feed-text',(e,url,head)=>trusted(e)?fetchFeed(String(url),true,head):{error:'untrusted sender'});
// The website's shared record of AI incidents (web/api/memory.js). The page
// can reach this one address only. The app adds what it has read when it has
// the record's key, and otherwise only reads. The key is loaded from a file,
// never typed and never handed to the page: memory-key.txt in the app folder
// (beside Build Runtime.cmd), or in the app's data folder; SM_MEMORY_KEY in
// the environment overrides both. It must match MEMORY_KEY on Vercel.
const MEMORY_URL=process.env.SM_MEMORY_URL||'https://singularity-web-chi.vercel.app/api/memory';
function memoryKey(){
  if(process.env.SM_MEMORY_KEY&&process.env.SM_MEMORY_KEY.trim().length>=16)return{key:process.env.SM_MEMORY_KEY.trim(),from:'SM_MEMORY_KEY'};
  for(const p of [path.join(__dirname,'..','..','..','memory-key.txt'),path.join(__dirname,'..','memory-key.txt'),path.join(app.getPath('userData'),'memory-key.txt')]){
    try{const k=fs.readFileSync(p,'utf8').trim();if(k.length>=16)return{key:k,from:p};}catch{/* not there */}
  }
  return{key:'',from:''};
}
ipcMain.handle('matrix:memory',async(e,items)=>{
  if(!trusted(e))return{error:'untrusted sender'};
  const {key,from}=memoryKey();
  try{
    const post=Array.isArray(items)&&key.length>0;
    const res=await net.fetch(MEMORY_URL,post
      ?{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({incidents:items.slice(0,500)})}
      :{method:'GET',headers:{'Accept':'application/json'}});
    const text=await res.text();
    let data=null;try{data=JSON.parse(text);}catch{/* not JSON */}
    if(!res.ok)return{error:(data&&data.error)||('HTTP '+res.status),keyFrom:from};
    return{data,sent:post,keyFrom:from};
  }catch(err){return{error:String((err&&err.message)||err).slice(0,80),keyFrom:from};}
});

/* ── Alerts ────────────────────────────────────────────────────────────────
   The page decides what is an alert (alerts.js). Here it is delivered, once
   per alert however often the page asks: a Windows notification, and a push to the phone through ntfy when a topic is
   set. ntfy (ntfy.sh) is a free, open-source push service: the phone app
   subscribes to the topic, and anyone who knows the topic's name can read it,
   so the name should be long and unguessable. Nothing is sent anywhere else. */
const AUMID='org.sciencecoherence.temporal-live';
if(process.platform==='win32'){
  app.setAppUserModelId(AUMID);
  // Windows shows notifications only for an app it knows by a Start menu
  // shortcut carrying this id. It is created once, beside the user's own.
  app.whenReady().then(()=>{try{const lnk=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','Temporal Live.lnk');
    if(!fs.existsSync(lnk))shell.writeShortcutLink(lnk,'create',{target:process.execPath,appUserModelId:AUMID,description:'Temporal Live · Science Coherence'});}catch{}});
}
const alerted=new Set();
const TOPIC=/^[A-Za-z0-9_-]{8,64}$/;
const clean=(v,n)=>String(v==null?'':v).replace(/[\u0000-\u001f]/g,' ').slice(0,n);
async function push(topic,a){
  if(!TOPIC.test(topic))return {error:'invalid topic'};
  const link=/^https:\/\//.test(String(a.link||''))?String(a.link):undefined;
  try{
    const res=await net.fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic,title:clean(a.title,200),message:clean(a.body,900)||' ',priority:a.level==='red'?5:4,
        tags:[a.level==='red'?'rotating_light':'warning'],click:link})});
    return res.ok?{ok:true}:{error:'ntfy answered HTTP '+res.status};
  }catch(error){return {error:String(error.message||error).slice(0,80)};}
}
ipcMain.handle('matrix:alert',async(e,a)=>{
  if(!trusted(e)||!a||typeof a.key!=='string')return {error:'refused'};
  const key=a.key.slice(0,300);
  if(alerted.has(key))return {first:false};
  alerted.add(key);
  if(a.system&&Notification.isSupported()){
    const n=new Notification({title:clean(a.title,200),body:clean(a.body,400),urgency:a.level==='red'?'critical':'normal'});
    n.on('click',()=>{const w=mainWindow&&!mainWindow.isDestroyed()?mainWindow:null;if(w){w.show();w.focus();w.webContents.send('matrix:show-alerts');}});
    n.show();
  }
  if(a.topic)push(String(a.topic),a);
  return {first:true};
});
ipcMain.handle('matrix:alert-test',(e,topic)=>trusted(e)?push(String(topic),{title:'Singularity Monitor · test alert',body:'Alerts will arrive here while the app is running.',level:'orange'}):{error:'refused'});
// The in-app reader: any public article, fetched here and read as text in the page. See article.js.
const {fetchArticle}=require('./article.js');
ipcMain.handle('matrix:article',(e,url)=>trusted(e)?fetchArticle(String(url)):{error:'untrusted sender'});

/* Webcams near a point, from Windy's webcam service, for the disaster map.
   The key is the user's own (Settings); it is sent only to api.windy.com. */
ipcMain.handle('matrix:webcams',async(e,lat,lon,radius,key)=>{
  if(!trusted(e))return {error:'refused'};
  lat=Number(lat);lon=Number(lon);radius=Math.max(1,Math.min(250,Number(radius)||100));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return {error:'bad position'};
  if(!/^[A-Za-z0-9]{8,80}$/.test(String(key)))return {error:'invalid key'};
  try{
    const res=await net.fetch(`https://api.windy.com/webcams/api/v3/webcams?nearby=${lat.toFixed(4)},${lon.toFixed(4)},${radius}&limit=12&include=location,urls`,{headers:{'x-windy-api-key':String(key)},credentials:'omit'});
    const body=await res.json().catch(()=>null);
    if(!res.ok)return {error:(body&&body.message)||('HTTP '+res.status)};
    return body||{error:'unreadable answer'};
  }catch(error){return {error:String(error.message||error).slice(0,80)};}
});

ipcMain.on('matrix:fullscreen',e=>{const win=trusted(e);if(win){win.setFullScreen(!win.isFullScreen());updatePower();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(blocker!==null)powerSaveBlocker.stop(blocker);});
// Explicit smoke-test mode closes itself and saves render evidence. Never used
// by normal launches.
if(process.argv.includes('--smoke-test')){
  app.whenReady().then(()=>setTimeout(async()=>{try{const win=BrowserWindow.getAllWindows()[0];const content=await win.webContents.executeJavaScript('({clock:(document.getElementById("mx-time")||document.querySelector(".time")||{}).textContent,tau:(document.getElementById("launch-value")||{}).textContent,vector:(document.getElementById("mx-v")||document.getElementById("vector")||{}).textContent,streams:(document.getElementById("run-status")||{}).textContent,events:(document.getElementById("stream")||{children:[]}).children.length,overflow:document.documentElement.scrollWidth>innerWidth,bottom:document.getElementById("instrument").getBoundingClientRect().bottom,height:innerHeight,settingsOpen:document.getElementById("settings").open})');fs.writeFileSync(path.join(app.getPath('userData'),'smoke-test.json'),JSON.stringify({windows:BrowserWindow.getAllWindows().length,powerBlocked:blocker!==null,content},null,2));const img=await win.webContents.capturePage();fs.writeFileSync(path.join(app.getPath('userData'),'smoke-test.png'),img.toPNG());app.quit();}catch(error){fs.writeFileSync(path.join(app.getPath('userData'),'smoke-error.txt'),String(error));app.quit();}},1000));
}
