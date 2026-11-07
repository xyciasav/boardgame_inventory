import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.mjs';

test('self-hosted authentication, storage, photos, and restart persistence',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'game-night-test-'));
 const password='test-only-owner-password';
 let app,base,token='';
 async function start(){app=createApp({password,dataDir:directory});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port}
 async function request(method,route,data,options={}){return fetch(base+route,{method,headers:{origin:options.origin??base,...(options.cookie===null?{}:{cookie:options.cookie??token}),...(data?{'Content-Type':options.type||'application/json'}:{}),...options.headers},body:data?(Buffer.isBuffer(data)?data:JSON.stringify(data)):undefined})}
 async function login(){const response=await request('POST','/api/login',{password});assert.equal(response.status,200);token=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/)}
 try{
  await start();
  await t.test('requires a configured password and rejects spoofed platform headers',async()=>{
   assert.throws(()=>createApp({password:'short',dataDir:directory}),/at least 12/);
   assert.equal((await fetch(base+'/healthz')).status,200);
   assert.equal((await fetch(base+'/api/shelf',{headers:{'oai-authenticated-user-id':'pretend-owner'}})).status,401);
   assert.equal((await request('POST','/api/login',{password:'wrong password'})).status,401);
   assert.equal((await request('POST','/api/login',{password},{origin:'https://other.example'})).status,403);
   await login();
  });
  const game={id:'owned',name:'Owned game',min:2,max:4,minutes:30,weight:1,tags:['Party'],description:'A game',color:'#526a48'};
  const person={id:'guest',name:'Guest',tags:['Party'],notes:'Short games'};
  const play={id:'round',gameId:game.id,gameName:game.name,date:'2026-11-07',people:[person.id],ratings:{guest:1},notes:{guest:'Loved it'}};
  let revision;
  await t.test('saves validated records and rejects stale or foreign writes',async()=>{
   const initial=await (await request('GET','/api/shelf')).json();assert.deepEqual(initial,{data:{games:[],people:[],plays:[]},revision:0});
   const data={games:[game],people:[person],plays:[play]};
   const saved=await request('PUT','/api/shelf',{data,revision:0});assert.equal(saved.status,200);revision=(await saved.json()).revision;
   assert.equal((await request('PUT','/api/shelf',{data,revision:0})).status,409);
   assert.equal((await request('PUT','/api/shelf',{data,revision},{origin:'https://other.example'})).status,403);
   assert.equal((await request('PUT','/api/shelf',{data:{...data,games:[{...game,description:{bad:true}}]},revision})).status,400);
   assert.deepEqual((await (await request('GET','/api/shelf')).json()).data,data);
  });
  let imageUrl;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
  await t.test('persists authenticated photos and blocks invalid payloads and paths',async()=>{
   const upload=await request('POST','/api/photo',image,{type:'image/png'});assert.equal(upload.status,200);imageUrl=(await upload.json()).url;
   const photo=await request('GET',imageUrl);assert.equal(photo.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await photo.arrayBuffer()),image);
   assert.equal((await request('GET',imageUrl,undefined,{cookie:null})).status,401);
   assert.equal((await request('POST','/api/photo',Buffer.from('<script>bad</script>'),{type:'image/png'})).status,400);
   assert.equal((await request('GET','/api/photo?key=..%2Fgame-night.sqlite')).status,404);
   const response=await request('GET','/api/bgg?q=Azul');assert.equal(response.status,503);assert.match((await response.json()).error,/BGG_API_TOKEN/);
  });
  await t.test('serves bundled assets and local fonts with no hosted login',async()=>{
   const response=await fetch(base+'/');assert.equal(response.status,200);assert.match(await response.text(),/Game Night/);assert.equal(response.headers.get('x-frame-options'),'DENY');
   assert.equal((await fetch(base+'/server/app.mjs')).status,404);
   const css=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');assert.doesNotMatch(css,/fonts\.googleapis/);
   const source=await readFile(new URL('../src/Home.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/signin-with-chatgpt|signout-with-chatgpt/);
  });
  await t.test('data and photos survive restart while previous sessions expire',async()=>{
   const previous=token;await app.close();await start();
   assert.equal((await request('GET','/api/shelf',undefined,{cookie:previous})).status,401);await login();
   const saved=await (await request('GET','/api/shelf')).json();assert.equal(saved.revision,revision);assert.equal(saved.data.plays[0].ratings.guest,1);assert.equal(saved.data.plays[0].notes.guest,'Loved it');
   assert.deepEqual(Buffer.from(await (await request('GET',imageUrl)).arrayBuffer()),image);
   const logout=await request('POST','/api/logout');assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await request('GET','/api/shelf')).status,401);
  });
  await t.test('rate limits repeated incorrect logins',async()=>{
   for(let i=0;i<10;i++)assert.equal((await request('POST','/api/login',{password:'wrong'})).status,401);
   const limited=await request('POST','/api/login',{password:'wrong'});assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  });
 }finally{
  if(app?.server.listening)await app.close();
  const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('game-night-test-'));
  await rm(resolved,{recursive:true,force:true});
 }
});
