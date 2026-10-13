'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
  fullscreen:()=>ipcRenderer.send('matrix:fullscreen'),
  // The app's version, from package.json (Semantic Versioning; see CHANGELOG.md).
  version:ipcRenderer.sendSync('matrix:version'),
  // Light, dark or Windows' own: the title bar follows (main.js).
  theme:mode=>ipcRenderer.send('matrix:theme',String(mode)),
  // The page never reaches the network itself; it asks the main process, which
  // holds the allowlist of sources.
  feed:url=>ipcRenderer.invoke('matrix:feed',String(url)),
  feedText:(url,head)=>ipcRenderer.invoke('matrix:feed-text',String(url),Number(head)||0),
  // The website's shared record of AI incidents: read it, or add to it with the key.
  memory:(items,key)=>ipcRenderer.invoke('matrix:memory',Array.isArray(items)?items:null,String(key||'')),
  // Alerts: a Windows notification and a phone push, made once by the main
  // process.
  alert:payload=>ipcRenderer.invoke('matrix:alert',payload),
  alertTest:topic=>ipcRenderer.invoke('matrix:alert-test',String(topic)),
  onShowAlerts:callback=>ipcRenderer.on('matrix:show-alerts',()=>callback()),
  // The in-app reader. Any public page, fetched by the main process; the page
  // extracts its text and shows nothing else.
  article:url=>ipcRenderer.invoke('matrix:article',String(url)),
  // Webcams near a point (Windy), for the disaster map; the key is the user's.
  webcams:(lat,lon,radius,key)=>ipcRenderer.invoke('matrix:webcams',Number(lat),Number(lon),Number(radius),String(key)),
  // Spotify. The token never reaches the page; these only ask the main process.
  spotify:{
    status:()=>ipcRenderer.invoke('spotify:status'),
    setClient:id=>ipcRenderer.invoke('spotify:set-client',String(id==null?'':id)),
    connect:()=>ipcRenderer.invoke('spotify:connect'),
    disconnect:()=>ipcRenderer.invoke('spotify:disconnect'),
    state:()=>ipcRenderer.invoke('spotify:state'),
    playlists:()=>ipcRenderer.invoke('spotify:playlists'),
    play:uri=>ipcRenderer.invoke('spotify:play',String(uri)),
    pause:()=>ipcRenderer.invoke('spotify:pause'),
    volume:percent=>ipcRenderer.invoke('spotify:volume',Number(percent)),
    next:()=>ipcRenderer.invoke('spotify:next'),
    previous:()=>ipcRenderer.invoke('spotify:previous'),
    resume:()=>ipcRenderer.invoke('spotify:resume')
  }
});
