'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../lib/supabaseClient';
import styles from './login.module.css'; // mismo CSS del segundo login

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
    setMessage('');
    if (!email || !password) {
      setMessage('Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);
    const supabase = getSupabase(); // <- inicializamos aquí en runtime
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage('Error al registrarse: ' + error.message);
      setIsLoading(false);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({ user_id: data.user.id, email: data.user.email });

      if (profileError) {
        setMessage('Error al crear perfil: ' + profileError.message);
        setIsLoading(false);
        return;
      }

      setMessage('Registro exitoso! Redirigiendo...');
      setTimeout(() => router.push('/'), 1000);
    }
    setIsLoading(false);
  };

  const handleSignIn = async () => {
    setMessage('');
    if (!email || !password) {
      setMessage('Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);
    const supabase = getSupabase(); // <- inicializamos aquí también
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage('Error al iniciar sesión: ' + error.message);
    } else {
      setMessage('Login exitoso! Redirigiendo...');
      setTimeout(() => router.push('/'), 1000);
    }
    setIsLoading(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.background}>
        <div className={styles.backgroundShape1}></div>
        <div className={styles.backgroundShape2}></div>
        <div className={styles.backgroundShape3}></div>
      </div>

      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.header}>
            <div className={styles.logo}>
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="40" height="40" rx="8" fill="#0066cc" />
                <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className={styles.title}>Login / Registro</h1>
          </div>

          {message && (
            <div className={message.toLowerCase().includes('error') ? styles.errorMessage : styles.successMessage}>
              <span>{message}</span>
            </div>
          )}

          <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
            <div className={styles.inputGroup}>
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className={styles.buttonGroup}>
              <button
                type="button"
                className={styles.submitButton}
                onClick={handleSignIn}
                disabled={isLoading}
              >
                {isLoading ? 'Cargando...' : 'Login'}
              </button>
              <button
                type="button"
                className={styles.submitButton}
                onClick={handleSignUp}
                disabled={isLoading}
              >
                {isLoading ? 'Cargando...' : 'Registro'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
