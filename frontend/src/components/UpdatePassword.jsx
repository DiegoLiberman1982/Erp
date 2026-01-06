import React, { useState, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';

const UpdatePassword = ({ onClose }) => {
  const { showSuccess, showError } = useNotification();
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [key, setKey] = useState('');

  useEffect(() => {
    // Obtener el key de la URL (query param o hash)
    const urlParams = new URLSearchParams(window.location.search)
    const resetKey = urlParams.get('key')
    if (resetKey) {
      setKey(resetKey)
    } else {
      showError('Enlace de restablecimiento de contraseña inválido')
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      showError('Por favor complete todos los campos');
      return;
    }

    if (newPassword !== confirmPassword) {
      showError('Las contraseñas no coinciden');
      return;
    }

    if (newPassword.length < 8) {
      showError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setLoading(true);

    try {
      // Enviar la solicitud al backend para actualizar la contraseña
      const response = await fetch('/api/update-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: key,
          new_password: newPassword
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          showSuccess('Contraseña actualizada exitosamente');
          // Redirigir al login después de un breve delay
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        } else {
          showError(data.message || 'Error al actualizar la contraseña');
        }
      } else {
        const errorData = await response.json().catch(() => ({ message: 'Error desconocido' }));
        showError(errorData.message || 'Error al actualizar la contraseña');
      }
    } catch (error) {
      console.error('Error updating password:', error);
      showError('Error de conexión. Por favor intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#f3f4f6,#eaeef3)',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{maxWidth:900,width:'100%',background:'#fff',borderRadius:16,boxShadow:'0 10px 30px rgba(2,6,23,0.08)',display:'flex',overflow:'hidden'}}>
        <div style={{flex:1,padding:40}}>
          <h2 style={{fontSize:20,fontWeight:800,margin:0}}>Actualizar Contraseña</h2>
          <p style={{color:'#94a3b8',marginTop:6}}>Ingrese su nueva contraseña para completar el registro</p>
          
          <form onSubmit={handleSubmit} style={{marginTop:20}}>
            <label style={{display:'block',fontSize:13,color:'#111827',marginTop:14,fontWeight:700}}>Nueva Contraseña</label>
            <input 
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{width:'100%',padding:12,borderRadius:10,border:'1px solid #e6e9ee',marginTop:8}}
              placeholder="Ingrese su nueva contraseña"
              required
              minLength={8}
            />

            <label style={{display:'block',fontSize:13,color:'#111827',marginTop:14,fontWeight:700}}>Confirmar Contraseña</label>
            <input 
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{width:'100%',padding:12,borderRadius:10,border:'1px solid #e6e9ee',marginTop:8}}
              placeholder="Confirme su nueva contraseña"
              required
              minLength={8}
            />

            <button 
              type="submit"
              disabled={loading}
              style={{
                display:'inline-block',
                marginTop:18,
                padding:'12px 16px',
                borderRadius:12,
                background: loading ? '#9ca3af' : 'linear-gradient(90deg,#111827,#374151)',
                color:'#fff',
                fontWeight:800,
                border:0,
                cursor: loading ? 'not-allowed' : 'pointer',
                width: '100%'
              }}
            >
              {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
            </button>
          </form>

          <div style={{marginTop:20, textAlign:'center'}}>
            <button
              onClick={() => window.location.href = '/'}
              style={{
                color:'#6b7280',
                textDecoration:'none',
                fontSize:14,
                cursor:'pointer',
                background:'none',
                border:'none'
              }}
            >
              ← Volver al inicio de sesión
            </button>
          </div>
        </div>
        
        <div style={{width:360,background:'linear-gradient(180deg,#0f172a,#111827)',color:'#fff',padding:28}}>
          <h3 style={{margin:0,fontWeight:900}}>Restablecer Contraseña</h3>
          <p style={{color:'#cbd5e1',marginTop:8}}>Complete el proceso de registro configurando su contraseña segura.</p>
          
          <div style={{marginTop:20,padding:12,background:'rgba(255,255,255,0.03)',borderRadius:12}}>
            <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>Seguridad</div>
            <div style={{fontSize:13,color:'#9ca3af',marginTop:6}}>Su contraseña debe tener al menos 8 caracteres</div>
          </div>
          
          <div style={{marginTop:16,padding:12,background:'rgba(255,255,255,0.03)',borderRadius:12}}>
            <div style={{fontSize:12,color:'#e2e8f0',fontWeight:700}}>Soporte</div>
            <div style={{fontSize:13,color:'#9ca3af',marginTop:6}}>contacto@empresa.local</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpdatePassword;