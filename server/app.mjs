import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shelfSchema} from '../lib/validation.ts';

const derive=promisify(scrypt);
const hash=value=>createHash('sha256').update(value).digest('hex');
const EMPTY={games:[],people:[],plays:[]};
const COOKIE='game_night_session';
const WEEK=7*24*60*60*1000;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
async function body(req,limit){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpError(413,'This upload is too large.');chunks.push(chunk)}return Buffer.concat(chunks)}
async function jsonBody(req,limit=2_100_000){try{return JSON.parse((await body(req,limit)).toString('utf8'))}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Send valid JSON.')}}
function imageExtension(type,bytes){
 if(type==='image/png'&&bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
 if(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return '.jpg';
 if(type==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return '.webp';
 throw new HttpError(400,'Use a valid JPEG, PNG, or WebP photo.');
}

export function createApp(config){
 if(typeof config.password!=='string'||config.password.length<12)throw new Error('Set APP_PASSWORD to a password with at least 12 characters.');
 const dataDir=path.resolve(config.dataDir||'data');
 const distDir=path.resolve(config.distDir||fileURLToPath(new URL('../dist',import.meta.url)));
 let appOrigin='';
 if(config.origin){const u=new URL(config.origin);if(!['http:','https:'].includes(u.protocol)||u.origin!==config.origin)throw new Error('APP_ORIGIN must be an http(s) origin without a trailing slash or path.');appOrigin=u.origin}
 const secure=config.cookieSecure===true||appOrigin.startsWith('https:');
 const photos=path.join(dataDir,'photos');mkdirSync(photos,{recursive:true});
 const db=new DatabaseSync(path.join(dataDir,'game-night.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS shelf(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
 db.prepare('INSERT OR IGNORE INTO shelf(id,data,revision) VALUES(1,?,0)').run(JSON.stringify(EMPTY));
 // A restart invalidates logins, including after changing the owner password.
 db.prepare('DELETE FROM sessions').run();
 const salt=randomBytes(32),passwordKey=scryptSync(config.password,salt,64),attempts=new Map();
 const sessionToken=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 function authenticated(req){const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return false;return !!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires>?').get(hash(token),Date.now())}
 function originCheck(req){const expected=appOrigin||`${secure?'https':'http'}://${req.headers.host}`;if(req.headers.origin!==expected)throw new HttpError(403,'Invalid origin. Set APP_ORIGIN to the exact address you use to open the app.');}
 const cookie=(token,age)=>`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
 function reply(res,status,value,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value))}
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/healthz'&&req.method==='GET'){db.prepare('SELECT 1').get();return reply(res,200,{status:'ok'})}
   if(url.pathname.startsWith('/api/')){
    if(!['GET','HEAD'].includes(req.method))originCheck(req);
    if(url.pathname==='/api/login'&&req.method==='POST'){
     const ip=req.socket.remoteAddress||'unknown',now=Date.now();
     for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
     if(attempts.size>10000)throw new HttpError(429,'Too many login requests. Try again later.');
     const bucket=attempts.get(ip)||{count:0,until:now+15*60*1000};
     if(bucket.count>=10)return reply(res,429,{error:'Too many attempts. Try again in 15 minutes.'},{'Retry-After':String(Math.ceil((bucket.until-now)/1000))});
     bucket.count++;attempts.set(ip,bucket);
     const payload=await jsonBody(req,8192);const candidate=typeof payload?.password==='string'?payload.password:'';
     const key=await derive(candidate,salt,64);
     if(!timingSafeEqual(key,passwordKey))throw new HttpError(401,'That password didn’t match.');
     attempts.delete(ip);db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
     const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,expires) VALUES(?,?)').run(hash(token),now+WEEK);
     return reply(res,200,{ok:true},{'Set-Cookie':cookie(token,WEEK/1000)});
    }
    if(!authenticated(req))throw new HttpError(401,'Enter your owner password to open your shelf.');
    if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(sessionToken(req)));return reply(res,200,{ok:true},{'Set-Cookie':cookie('',0)})}
    if(url.pathname==='/api/shelf'&&req.method==='GET'){const row=db.prepare('SELECT data,revision FROM shelf WHERE id=1').get();return reply(res,200,{data:JSON.parse(row.data),revision:row.revision})}
    if(url.pathname==='/api/shelf'&&req.method==='PUT'){
     const payload=await jsonBody(req);if(!payload||typeof payload!=='object')throw new HttpError(400,'Invalid shelf.');
     const {data,revision}=payload;if(!Number.isSafeInteger(revision)||revision<0)throw new HttpError(400,'Invalid shelf revision.');
     const parsed=shelfSchema.safeParse(data);if(!parsed.success)throw new HttpError(400,parsed.error.issues[0]?.message||'Invalid shelf.');
     const result=db.prepare('UPDATE shelf SET data=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision').get(JSON.stringify(parsed.data),revision);
     if(!result)throw new HttpError(409,'Your shelf changed in another tab. Reload before trying again.');return reply(res,200,result);
    }
    if(url.pathname==='/api/photo'&&req.method==='POST'){
     const bytes=await body(req,8*1024*1024),ext=imageExtension(req.headers['content-type'],bytes),key=randomUUID()+ext;
     const target=path.join(photos,key),temporary=target+'.tmp';try{writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});renameSync(temporary,target)}catch(e){try{unlinkSync(temporary)}catch{}throw e}
     return reply(res,200,{url:'/api/photo?key='+key});
    }
    if(url.pathname==='/api/photo'&&req.method==='GET'){
     const key=url.searchParams.get('key')||'';if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key))throw new HttpError(404,'Photo not found.');
     let bytes;try{bytes=await readFile(path.join(photos,key))}catch(e){if(e.code==='ENOENT')throw new HttpError(404,'Photo not found.');throw e}
     res.writeHead(200,{'Content-Type':mime[path.extname(key)],'Cache-Control':'private, no-store'});return res.end(bytes);
    }
    if(url.pathname==='/api/bgg'&&req.method==='GET'){
     if(!config.bggToken)throw new HttpError(503,'BGG import needs an approved application token. Set BGG_API_TOKEN in your container environment. Manual entry and the starter catalog work without it.');
     const id=url.searchParams.get('id'),q=url.searchParams.get('q');if(!id&&!q)throw new HttpError(400,'Enter a game name.');if(id&&!/^\d{1,10}$/.test(id))throw new HttpError(400,'Invalid BGG ID.');
     const endpoint=id?'thing?id='+id+'&stats=1':'search?type=boardgame&query='+encodeURIComponent((q||'').slice(0,150));
     let response;try{response=await fetch('https://boardgamegeek.com/xmlapi2/'+endpoint,{headers:{Authorization:'Bearer '+config.bggToken},signal:AbortSignal.timeout(12000)})}catch{throw new HttpError(502,'BoardGameGeek timed out. Please try again.')}
     if(!response.ok||response.status===202)throw new HttpError(502,'BoardGameGeek is not ready or your token needs attention. Try again later.');
     res.writeHead(200,{'Content-Type':'application/xml','Cache-Control':'private, no-store'});return res.end(await response.text());
    }
    throw new HttpError(404,'Endpoint not found.');
   }
   if(!['GET','HEAD'].includes(req.method))throw new HttpError(405,'Method not allowed.');
   const pathname=decodeURIComponent(url.pathname);let file=path.resolve(distDir,'.'+pathname),relative=path.relative(distDir,file);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw new HttpError(404,'Not found.');
   try{if(!(await stat(file)).isFile())file=path.join(distDir,'index.html')}catch{if(path.extname(pathname))throw new HttpError(404,'Not found.');file=path.join(distDir,'index.html')}
   const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':file.includes(path.sep+'assets'+path.sep)?'public, max-age=31536000, immutable':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){if(res.headersSent){res.end();return}if(!e.status)console.error('Request failed:',e.code||e.name);reply(res,e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'})}
 });
 server.requestTimeout=30_000;server.headersTimeout=15_000;
 return {server,close:async()=>{await new Promise(resolve=>server.close(resolve));db.close()},checkpoint:()=>db.exec('PRAGMA wal_checkpoint(TRUNCATE)')};
}
