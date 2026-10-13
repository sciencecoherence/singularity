'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

// Run the actual desktop fetcher without launching Electron or contacting
// providers. Inject lifecycle events to reproduce interrupted downloads.
const source=fs.readFileSync(path.join(__dirname,'../source/main.js'),'utf8');
const start=source.indexOf('const FEED_HOSTS=');
const end=source.indexOf("ipcMain.handle('matrix:feed'");
assert.ok(start>=0&&end>start,'feed implementation found');
const url='https://stats.bis.org/test';
function harness({setupError=false}={}){
  const requests=[],timers=new Set(),logs=[];
  const context=vm.createContext({URL,Date,Map,Set,Number,String,JSON,Promise,
    console:{warn:(...args)=>logs.push(args)},
    setTimeout(fn){const timer={fn};timers.add(timer);return timer;},
    clearTimeout(timer){timers.delete(timer);},
    net:{request(){
      if(setupError)throw new Error('network setup failed');
      const request=new EventEmitter();
      request.headers={};
      request.setHeader=(name,value)=>{request.headers[name]=value;};
      request.end=()=>{};
      request.abort=()=>{
        request.aborted=true;
        request.emit('abort');
        if(request.response){
          request.response.emit('aborted');
          request.response.emit('error',new Error('late abort error'));
        }
        request.emit('close');
      };
      requests.push(request);return request;
    }}
  });
  vm.runInContext(source.slice(start,end),context);
  const fetch=(asText=true,head=0)=>context.fetchFeed(url,asText,head);
  function respond(statusCode=200,request=requests.at(-1)){
    const response=new EventEmitter();
    response.statusCode=statusCode;
    response.setEncoding=()=>{};
    response.resume=()=>{response.resumed=true;};
    request.response=response;
    request.emit('response',response);return response;
  }
  function clean(){
    assert.equal(timers.size,0,'timer cleared');
    assert.equal(vm.runInContext('feedInFlight.size',context),0,'in-flight entry cleared');
  }
  const cacheSize=()=>vm.runInContext('feedCache.size',context);
  return {fetch,respond,requests,timers,logs,clean,cacheSize};
}

test('mid-response disconnect returns an error, ignores late end, and allows retry',async()=>{
  const h=harness(),pending=h.fetch(),response=h.respond();
  response.emit('data','partial data');
  response.emit('error',new Error('net::ERR_CONNECTION_CLOSED'));
  response.emit('data','late data');response.emit('end');
  assert.equal((await pending).error,'net::ERR_CONNECTION_CLOSED');
  h.clean();assert.equal(h.cacheSize(),0);
  assert.equal(h.logs.length,1);assert.equal(h.logs[0][2],'stats.bis.org');
  const next=h.fetch();assert.equal(h.requests.length,2);
  const good=h.respond();good.emit('data','complete data');good.emit('end');
  assert.equal(await next,'complete data');h.clean();
});

test('request failure before response is handled',async()=>{
  const h=harness(),pending=h.fetch();
  h.requests[0].emit('error',new Error('net::ERR_CONNECTION_CLOSED'));
  assert.equal((await pending).error,'net::ERR_CONNECTION_CLOSED');h.clean();
});

for(const scenario of ['response aborted','request aborted','premature close']){
  test(scenario+' discards partial data',async()=>{
    const h=harness(),pending=h.fetch(),response=h.respond();
    response.emit('data','partial');
    if(scenario==='response aborted')response.emit('aborted');
    if(scenario==='request aborted')h.requests[0].abort();
    if(scenario==='premature close')h.requests[0].emit('close');
    response.emit('end');
    assert.ok((await pending).error);assert.equal(h.cacheSize(),0);h.clean();
  });
}

test('timeout result survives synchronous abort events and late response errors',async()=>{
  const h=harness(),pending=h.fetch();
  [...h.timers][0].fn();
  const response=h.respond();
  response.emit('error',new Error('late disconnect'));
  response.emit('data','late data');response.emit('end');
  assert.equal((await pending).error,'timeout');
  assert.equal(response.resumed,true);assert.equal(h.cacheSize(),0);h.clean();
});

test('timeout during response cannot cache partial content',async()=>{
  const h=harness(),pending=h.fetch(),response=h.respond();
  response.emit('data','partial');[...h.timers][0].fn();response.emit('end');
  assert.equal((await pending).error,'timeout');assert.equal(h.cacheSize(),0);h.clean();
});

test('HTTP failure still consumes late response errors',async()=>{
  const h=harness(),pending=h.fetch(),response=h.respond(503);
  response.emit('error',new Error('net::ERR_CONNECTION_CLOSED'));
  assert.equal((await pending).error,'HTTP 503');
  assert.equal(response.resumed,true);assert.equal(h.cacheSize(),0);h.clean();
});

test('intentional range cutoff succeeds despite synchronous abort errors',async()=>{
  const h=harness(),pending=h.fetch(true,8),response=h.respond();
  assert.equal(h.requests[0].headers.Range,'bytes=0-7');
  response.emit('data','one\ntwo\nextra');response.emit('end');
  assert.equal(await pending,'one\ntwo\n');
  assert.equal(h.requests[0].aborted,true);assert.equal(h.logs.length,0);h.clean();
});

test('oversized body returns the size error rather than an abort error',async()=>{
  const h=harness(),pending=h.fetch(),response=h.respond();
  response.emit('data','x'.repeat(8000001));response.emit('end');
  assert.equal((await pending).error,'response too large');
  assert.equal(h.cacheSize(),0);h.clean();
});

test('complete JSON response is shared and cached',async()=>{
  const h=harness(),first=h.fetch(false),second=h.fetch(false);
  assert.equal(first,second);assert.equal(h.requests.length,1);
  const response=h.respond();response.emit('data','{"value":42}');response.emit('end');
  h.requests[0].emit('close');response.emit('error',new Error('late error'));
  assert.equal((await first).value,42);assert.equal((await second).value,42);
  assert.equal((await h.fetch(false)).value,42);assert.equal(h.requests.length,1);
  assert.equal(h.logs.length,0);h.clean();
});

test('unreadable JSON is not cached',async()=>{
  const h=harness(),pending=h.fetch(false),response=h.respond();
  response.emit('data','broken JSON');response.emit('end');
  assert.equal((await pending).error,'unreadable response');
  assert.equal(h.cacheSize(),0);h.clean();
});

test('setup exception returns a normal feed error',async()=>{
  const h=harness({setupError:true}),pending=h.fetch();
  assert.equal((await pending).error,'network setup failed');h.clean();
});
