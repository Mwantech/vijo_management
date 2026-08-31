import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { ShieldCheck, Zap } from '../components/common/Icons'

export function LoginPage({onLogin,error,setError}:{onLogin:(email:string,password:string)=>Promise<void>;error?:string;setError:Dispatch<SetStateAction<string|undefined>>}) {
  const[email,setEmail]=useState('')
  const[password,setPassword]=useState('')
  const[loading,setLoading]=useState(false)
  const submit=async(event:FormEvent)=>{event.preventDefault();setLoading(true);setError(undefined);try{await onLogin(email,password)}catch(err){setError(err instanceof Error?err.message:'Unable to sign in')}finally{setLoading(false)}}
  return <main className="login-page"><section className="login-panel"><div className="login-brand"><span className="brand-mark"><Zap size={20}/></span><div><strong>Vijo Management</strong><span>Central command center</span></div></div><form onSubmit={submit}><div className="login-heading"><ShieldCheck size={19}/><div><h1>Admin sign in</h1><p>Use your Vijo Management administrator credentials.</p></div></div>{error&&<p className="inline-alert">{error}</p>}<label>Email<input autoFocus required type="email" value={email} onChange={(event)=>setEmail(event.target.value)} autoComplete="email"/></label><label>Password<input required type="password" value={password} onChange={(event)=>setPassword(event.target.value)} autoComplete="current-password"/></label><button className="button button--primary" disabled={loading}>{loading?'Signing in...':'Sign in'}</button></form></section></main>
}
