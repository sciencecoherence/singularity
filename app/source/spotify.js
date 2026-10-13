'use strict';
/* ── Spotify, in the main process ──────────────────────────────────────────
   The page never touches Spotify or its token. Sign-in is the PKCE flow for a
   desktop app: no client secret exists or is stored. A browser opens Spotify's
   consent page, Spotify sends the browser back to a loopback address this
   process is listening on for a few minutes, and the code that arrives is
   traded for a token. Only the refresh token is kept, in the app's own data
   folder, encrypted with the operating system's store when it offers one.

   The client id is not a secret; it names the app registration on Spotify's
   dashboard. The one below is the app's own. Spotify keeps an app in
   development mode to a short list of named accounts, so anyone else can paste
   the client id of a registration of their own in Settings, and it is used
   instead (setClient, below). Either way the redirect URI on the registration
   must read exactly http://127.0.0.1:8888/callback. */
const {app,net,shell,safeStorage,ipcMain}=require('electron');
const http=require('node:http');
const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');

const DEFAULT_CLIENT_ID='eb526bee974c4b1c8c4a71cf3a1c64fd';
const CLIENT_ID_SHAPE=/^[A-Za-z0-9]{32}$/;
let clientId=DEFAULT_CLIENT_ID;
const PORT=8888;
const REDIRECT=`http://127.0.0.1:${PORT}/callback`;
const SCOPES=['user-read-playback-state','user-modify-playback-state','user-read-currently-playing','playlist-read-private','playlist-read-collaborative'].join(' ');
const ACCOUNTS='https://accounts.spotify.com';
const API='https://api.spotify.com/v1';
const CONTEXT=/^spotify:(playlist|album|artist):[A-Za-z0-9]{22}$/;

let token=null;          // { access, expires, refresh }
let signingIn=null;      // the one sign-in in progress, if any
const tokenFile=()=>path.join(app.getPath('userData'),'spotify-token.bin');
const configFile=()=>path.join(app.getPath('userData'),'spotify-config.json');

/* ── Which registration is in use ── */
function loadConfig(){
  try{const c=JSON.parse(fs.readFileSync(configFile(),'utf8'));if(c&&CLIENT_ID_SHAPE.test(String(c.clientId)))clientId=String(c.clientId);}catch{clientId=DEFAULT_CLIENT_ID;}
}
// A token belongs to the registration that issued it, so changing the id signs out.
function setClient(id){
  id=String(id==null?'':id).trim();
  if(id!==''&&!CLIENT_ID_SHAPE.test(id))return {error:'A client id is 32 letters and digits, copied from the app\'s Settings page on developer.spotify.com.'};
  const next=id||DEFAULT_CLIENT_ID;
  if(next!==clientId){
    if(signingIn)return {error:'A sign-in is in progress. Finish or wait for it, then try again.'};
    forgetToken();clientId=next;
    try{if(id)fs.writeFileSync(configFile(),JSON.stringify({clientId:id}));else fs.unlinkSync(configFile());}catch{/* it lasts this session at least */}
  }
  return {ok:true,clientId,isDefault:clientId===DEFAULT_CLIENT_ID};
}

/* ── Token store ── */
function loadToken(){
  try{
    const raw=fs.readFileSync(tokenFile());
    const text=safeStorage.isEncryptionAvailable()?safeStorage.decryptString(raw):raw.toString('utf8');
    const saved=JSON.parse(text);
    if(saved&&typeof saved.refresh==='string')token={access:'',expires:0,refresh:saved.refresh};
  }catch{token=null;}
}
function saveToken(){
  try{
    if(!token||!token.refresh)return;
    const text=JSON.stringify({refresh:token.refresh});
    fs.writeFileSync(tokenFile(),safeStorage.isEncryptionAvailable()?safeStorage.encryptString(text):Buffer.from(text,'utf8'));
  }catch{/* the session still works; it will ask again next time */}
}
function forgetToken(){token=null;try{fs.unlinkSync(tokenFile());}catch{}}

/* ── Token requests ── */
const b64url=buf=>buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function tokenRequest(params){
  try{
    const res=await net.fetch(ACCOUNTS+'/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:clientId,...params}).toString(),credentials:'omit'});
    const body=await res.json().catch(()=>null);
    if(!res.ok||!body||!body.access_token)return {error:(body&&(body.error_description||body.error))||('HTTP '+res.status)};
    token={access:body.access_token,expires:Date.now()+Math.max(60,Number(body.expires_in)||3600)*1000-30000,refresh:body.refresh_token||(token&&token.refresh)||''};
    saveToken();
    return {ok:true};
  }catch(error){return {error:String(error.message||error).slice(0,80)};}
}
async function accessToken(){
  if(token&&token.access&&Date.now()<token.expires)return token.access;
  if(!token||!token.refresh)return null;
  const r=await tokenRequest({grant_type:'refresh_token',refresh_token:token.refresh});
  if(r.error){
    // A refused refresh means access was revoked; a network failure does not.
    if(/invalid_grant|revoked|invalid_client/i.test(r.error))forgetToken();
    return null;
  }
  return token.access;
}

/* ── Sign in ── */
function page(title,line){
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#080f10;color:#d2f1e4;font:16px system-ui,sans-serif"><div style="text-align:center"><div style="letter-spacing:3px;color:#86ddc4;font-size:12px">TEMPORAL LIVE</div><h1 style="font-weight:400">${title}</h1><p style="color:#81958d">${line}</p></div>`;
}
function connect(){
  if(signingIn)return signingIn;
  signingIn=new Promise(resolve=>{
    const verifier=b64url(crypto.randomBytes(64));
    const challenge=b64url(crypto.createHash('sha256').update(verifier).digest());
    const state=b64url(crypto.randomBytes(16));
    let settled=false,server=null,timer=null;
    const finish=result=>{
      if(settled)return;settled=true;clearTimeout(timer);
      try{server&&server.close();}catch{}
      signingIn=null;resolve(result);
    };
    server=http.createServer(async(req,res)=>{
      let url;try{url=new URL(req.url,REDIRECT);}catch{res.writeHead(400).end();return;}
      if(url.pathname!=='/callback'){res.writeHead(404).end();return;}
      const code=url.searchParams.get('code'),err=url.searchParams.get('error');
      if(url.searchParams.get('state')!==state||(!code&&!err)){res.writeHead(400,{'Content-Type':'text/html'}).end(page('Not recognised','This sign-in was not started by Temporal Live.'));return;}
      if(err||!code){res.writeHead(200,{'Content-Type':'text/html'}).end(page('Not connected','Spotify did not grant access. You can close this tab.'));finish({error:err||'denied'});return;}
      const r=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:REDIRECT,code_verifier:verifier});
      res.writeHead(200,{'Content-Type':'text/html'}).end(r.error?page('Not connected',String(r.error).replace(/[<>&]/g,' ')):page('Connected','Temporal Live can hear Spotify now. You can close this tab.'));
      finish(r.error?{error:r.error}:{ok:true});
    });
    server.on('error',e=>finish({error:e&&e.code==='EADDRINUSE'?`Port ${PORT} is in use by another program.`:String(e&&e.message||e).slice(0,80)}));
    server.listen(PORT,'127.0.0.1',()=>{
      const url=ACCOUNTS+'/authorize?'+new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:REDIRECT,scope:SCOPES,
        state,code_challenge_method:'S256',code_challenge:challenge}).toString();
      shell.openExternal(url).catch(()=>finish({error:'Could not open the browser.'}));
      timer=setTimeout(()=>finish({error:'Sign-in timed out. Try again.'}),3*60000);
    });
  });
  return signingIn;
}

/* ── The Web API ── */
async function api(method,pathAndQuery,body,retried=false){
  const access=await accessToken();
  if(!access)return {error:'Not connected to Spotify.',status:401,signedOut:true};
  try{
    const res=await net.fetch(API+pathAndQuery,{method,credentials:'omit',
      headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.status===401&&!retried){token&&(token.expires=0);return api(method,pathAndQuery,body,true);}
    if(res.status===204||res.status===202)return {ok:true,empty:true};
    if(res.status===429)return {error:'Spotify asked to slow down.',status:429,retryAfter:Number(res.headers.get('retry-after'))||10};
    const json=await res.json().catch(()=>null);
    if(!res.ok)return {error:(json&&json.error&&(json.error.message||json.error))||('HTTP '+res.status),status:res.status,reason:json&&json.error&&json.error.reason};
    return {ok:true,body:json};
  }catch(error){return {error:String(error.message||error).slice(0,80),status:0};}
}

const names=list=>(list||[]).map(a=>a&&a.name).filter(Boolean).join(', ');
let stateInFlight=null;
function playerState(){
  if(stateInFlight)return stateInFlight;
  stateInFlight=(async()=>{
    const r=await api('GET','/me/player');
    if(r.error)return r;
    if(r.empty||!r.body)return {ok:true,active:false};
    const b=r.body,item=b.item||{},d=b.device||{};
    return {ok:true,active:true,playing:!!b.is_playing,progressMs:b.progress_ms||0,shuffle:!!b.shuffle,
      track:item.name?{name:item.name,artists:names(item.artists)||(item.show&&item.show.name)||'',durationMs:item.duration_ms||0}:null,
      volume:Number.isFinite(d.volume_percent)?d.volume_percent:null,
      device:{id:d.id||null,name:d.name||'',type:d.type||'',canVolume:d.supports_volume!==false},
      context:b.context&&b.context.uri?{uri:b.context.uri,type:b.context.type}:null};
  })();
  stateInFlight.then(()=>{stateInFlight=null;},()=>{stateInFlight=null;});
  return stateInFlight;
}

async function playlists(){
  const out=[];let next='/me/playlists?limit=50';
  for(let i=0;i<4&&next;i++){
    const r=await api('GET',next);
    if(r.error)return out.length?{ok:true,playlists:out}:r;
    const b=r.body||{};
    for(const p of b.items||[])if(p&&p.uri&&CONTEXT.test(p.uri))
      out.push({uri:p.uri,name:String(p.name||'Untitled'),total:(p.tracks&&p.tracks.total)??(p.items&&p.items.total)??null,owner:(p.owner&&p.owner.display_name)||''});
    next=b.next?b.next.replace(API,''):null;
  }
  return {ok:true,playlists:out};
}

async function play(contextUri){
  if(!CONTEXT.test(String(contextUri)))return {error:'That is not a Spotify playlist address.'};
  let r=await api('PUT','/me/player/play',{context_uri:contextUri});
  if(r.status===404||r.reason==='NO_ACTIVE_DEVICE'){
    // Nothing is the active player. Wake the first device Spotify knows of.
    const d=await api('GET','/me/player/devices');
    const list=(d.body&&d.body.devices)||[];
    const pick=list.find(x=>x.is_active)||list.find(x=>!x.is_restricted)||list[0];
    if(!pick)return {error:'Open Spotify on a device first, then try again.'};
    r=await api('PUT','/me/player/play?device_id='+encodeURIComponent(pick.id),{context_uri:contextUri});
  }
  return r.error?{error:r.error,status:r.status}:{ok:true};
}
const pause=async()=>{const r=await api('PUT','/me/player/pause');return r.error&&r.reason!=='ALREADY_PAUSED'?{error:r.error,status:r.status}:{ok:true};};
async function volume(percent){
  const v=Math.round(Number(percent));
  if(!Number.isFinite(v)||v<0||v>100)return {error:'bad volume'};
  const r=await api('PUT','/me/player/volume?volume_percent='+v);
  return r.error?{error:r.error,status:r.status,reason:r.reason}:{ok:true,volume:v};
}
const skip=async()=>{const r=await api('POST','/me/player/next');return r.error?{error:r.error,status:r.status}:{ok:true};};
const back=async()=>{const r=await api('POST','/me/player/previous');return r.error?{error:r.error,status:r.status}:{ok:true};};
// Carry on with whatever Spotify has queued. With no active player it wakes the first device it knows.
async function resume(){
  let r=await api('PUT','/me/player/play');
  if(r.status===404||r.reason==='NO_ACTIVE_DEVICE'){
    const d=await api('GET','/me/player/devices');
    const list=(d.body&&d.body.devices)||[];
    const pick=list.find(x=>x.is_active)||list.find(x=>!x.is_restricted)||list[0];
    if(!pick)return {error:'Open Spotify on a device first, then try again.'};
    r=await api('PUT','/me/player/play?device_id='+encodeURIComponent(pick.id));
  }
  return r.error?{error:r.error,status:r.status,reason:r.reason}:{ok:true};
}

/* ── Wiring ── */
function init({trusted}){
  loadConfig();
  loadToken();
  const guard=fn=>async(e,...args)=>trusted(e)?fn(...args):{error:'untrusted sender'};
  ipcMain.handle('spotify:status',guard(()=>({connected:!!(token&&token.refresh),signingIn:!!signingIn,redirect:REDIRECT,clientId,isDefault:clientId===DEFAULT_CLIENT_ID})));
  ipcMain.handle('spotify:set-client',guard(id=>setClient(id)));
  ipcMain.handle('spotify:connect',guard(()=>connect()));
  ipcMain.handle('spotify:disconnect',guard(()=>{forgetToken();return {ok:true};}));
  ipcMain.handle('spotify:state',guard(()=>playerState()));
  ipcMain.handle('spotify:playlists',guard(()=>playlists()));
  ipcMain.handle('spotify:play',guard(uri=>play(uri)));
  ipcMain.handle('spotify:pause',guard(()=>pause()));
  ipcMain.handle('spotify:volume',guard(v=>volume(v)));
  ipcMain.handle('spotify:next',guard(()=>skip()));
  ipcMain.handle('spotify:previous',guard(()=>back()));
  ipcMain.handle('spotify:resume',guard(()=>resume()));
}
module.exports={init};
