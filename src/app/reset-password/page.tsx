'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../lib/supabaseClient';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUpdatePassword = async () => {
    setMessage('');

    if (!newPassword.trim()) {
      setMessage('La contraseña no puede estar vacía.');
      return;
    }

    if (newPassword.length < 6) {
      setMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage('Las contraseñas no coinciden.');
      return;
    }

    setIsLoading(true);

    const supabase = getSupabase();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setMessage('Error al actualizar contraseña: ' + error.message);
      setIsLoading(false);
      return;
    }

    setMessage('Contraseña actualizada correctamente.');
    await supabase.auth.signOut();
    setTimeout(() => router.replace('/auth'), 2000);
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        <h1 style={{
          textAlign: 'center',
          marginBottom: '30px',
          color: '#333',
          fontSize: '24px'
        }}>
          Cambiar contraseña
        </h1>

        {message && (
          <p style={{
            textAlign: 'center',
            marginBottom: '20px',
            color: message.includes('Error') ? '#d32f2f' : '#2e7d32',
            fontWeight: 'bold'
          }}>
            {message}
          </p>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleUpdatePassword(); }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#555',
              fontWeight: '500'
            }}>
              Nueva contraseña
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
              placeholder="••••••••"
            />
          </div>

          <div style={{ marginBottom: '30px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#555',
              fontWeight: '500'
            }}>
              Confirmar contraseña
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                boxSizing: 'border-box'
              }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: isLoading ? '#ccc' : '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '16px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {isLoading ? 'Guardando...' : 'Guardar nueva contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}