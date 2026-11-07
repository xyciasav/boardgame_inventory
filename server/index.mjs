import {createApp} from './app.mjs';
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
const app=createApp({password:process.env.APP_PASSWORD,dataDir:process.env.DATA_DIR||'data',origin:process.env.APP_ORIGIN,cookieSecure:process.env.COOKIE_SECURE==='true',bggToken:process.env.BGG_API_TOKEN});
app.server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Game Night listening on port ${port}. Data: ${process.env.DATA_DIR||'data'}`));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0)});
