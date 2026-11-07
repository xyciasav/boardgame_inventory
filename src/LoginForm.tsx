import {useState} from 'react';
import {ArrowRight,Loader2} from 'lucide-react';
export default function LoginForm({onLogin}:{onLogin:()=>Promise<void>}){
 const [password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <form className="login-form" onSubmit={async e=>{e.preventDefault();setError('');setBusy(true);try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not sign in.');setPassword('');await onLogin()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}><label>Owner password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button disabled={busy} className="btn primary">{busy?<><Loader2 className="spin" size={16}/>Opening your shelf…</>:<>Open my shelf <ArrowRight size={16}/></>}</button><small className="login-hint">The password you set in your container’s APP_PASSWORD.</small></form>
}
