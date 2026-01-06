import React, { useState, useContext } from 'react'
import { AuthContext } from './AuthProvider'

export default function Login(){
  const [user,setUser]=useState('')
  const [passw,setPass]=useState('')
  const { login } = useContext(AuthContext)
  const [error,setError]=useState(null)

  const submit = async (e)=>{
    e.preventDefault(); 
    setError(null);
    
    const r = await login(user, passw);
    if(!r.ok) {
      setError('Credenciales inválidas');
    }
    // No need to call onLogin since AuthProvider will handle state
  }

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#f3f4f6,#eaeef3)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:900,width:'100%',background:'#fff',borderRadius:16,boxShadow:'0 10px 30px rgba(2,6,23,0.08)',display:'flex',overflow:'hidden'}}>
        <div style={{flex:1,padding:40}}>
          <h2 style={{fontSize:20,fontWeight:800,margin:0}}>Bienvenido de vuelta</h2>
          <p style={{color:'#94a3b8',marginTop:6}}>Introduce tus credenciales para acceder al portal.</p>
          <form onSubmit={submit} style={{marginTop:20}}>
            <label style={{display:'block',fontSize:13,color:'#111827',marginTop:14,fontWeight:700}}>Usuario</label>
            <input value={user} onChange={e=>setUser(e.target.value)} style={{width:'100%',padding:12,borderRadius:10,border:'1px solid #e6e9ee',marginTop:8}} />

            <label style={{display:'block',fontSize:13,color:'#111827',marginTop:14,fontWeight:700}}>Contraseña</label>
            <input type='password' value={passw} onChange={e=>setPass(e.target.value)} style={{width:'100%',padding:12,borderRadius:10,border:'1px solid #e6e9ee',marginTop:8}} />

            <button style={{display:'inline-block',marginTop:18,padding:'12px 16px',borderRadius:12,background:'linear-gradient(90deg,#111827,#374151)',color:'#fff',fontWeight:800,border:0,cursor:'pointer'}}>Acceder</button>
            {error && <div style={{color:'red',marginTop:8}}>{error}</div>}
          </form>
        </div>
        <div style={{width:360,background:'linear-gradient(180deg,#0f172a,#111827)',color:'#fff',padding:28}}>
          <h3 style={{margin:0,fontWeight:900}}>Panel de acceso</h3>
          <p style={{color:'#cbd5e1',marginTop:8}}>Accede a tus clientes, pedidos y métricas desde un solo lugar.</p>
          <div style={{marginTop:20,padding:12,background:'rgba(255,255,255,0.03)',borderRadius:12}}>
            <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>Soporte</div>
            <div style={{fontSize:13,color:'#9ca3af',marginTop:6}}>contacto@empresa.local</div>
          </div>
        </div>
      </div>
    </div>
  )
}
