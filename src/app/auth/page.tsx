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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSignUp = async () => {
    setMessage('');
    if (!email || !password || (isRegister && !confirmPassword)) {
      setMessage('Por favor completa todos los campos');
      return;
    }

    if (isRegister && password !== confirmPassword) {
      setMessage('Las contraseñas no coinciden');
      return;
    }

    // Validar dominio del email
    if (!email.endsWith('@fiuna.edu.py')) {
      setMessage('Error: Ingresar el correo institucional (@fiuna.edu.py)');
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
      if (error.message.includes("Invalid login credentials")) {
        setMessage("Correo o contraseña incorrectos. Si no tienes cuenta, primero crea una cuenta 👇");
      } else {
        setMessage("Ocurrió un error al iniciar sesión. Intenta nuevamente.");
      }
    } else {
      setMessage('Login exitoso! Redirigiendo...');
      setTimeout(() => router.push('/'), 1000);
    }
  }

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
              <h1 className={styles.title}>{isRegister ? 'Crear Cuenta' : 'Iniciar Sesión'}</h1>
            </div>

            {message && (
              <div className={message.toLowerCase().includes('error') ? styles.errorMessage : styles.successMessage}>
                <span>{message}</span>
              </div>
            )}

            <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
              <div className={styles.inputGroup}>
                <label htmlFor="email">Correo electrónico (institucional)</label>
                <input
                  id="email"
                  type="email"
                  placeholder="ejemplo@fiuna.edu.py"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="password">Contraseña</label>
                <div className={styles.passwordInputWrapper}>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className={styles.togglePassword}
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5C7 5 2.73 8.11 1 12.5 2.73 16.89 7 20 12 20s9.27-3.11 11-7.5C21.27 8.11 17 5 12 5z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 1l22 22M9.88 9.88a3 3 0 1 0 4.24 4.24M2 12s3.18-7 10-7 10 7 10 7M22 12s-3.18 7-10 7-10-7-10-7" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {isRegister && (
                <div className={styles.inputGroup}>
                  <label htmlFor="confirmPassword">Confirmar Contraseña</label>
                  <div className={styles.passwordInputWrapper}>
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      className={styles.togglePassword}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      disabled={isLoading}
                      aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showConfirmPassword ? (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5C7 5 2.73 8.11 1 12.5 2.73 16.89 7 20 12 20s9.27-3.11 11-7.5C21.27 8.11 17 5 12 5z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 1l22 22M9.88 9.88a3 3 0 1 0 4.24 4.24M2 12s3.18-7 10-7 10 7 10 7M22 12s-3.18 7-10 7-10-7-10-7" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.submitButton}
                  onClick={isRegister ? handleSignUp : handleSignIn}
                  disabled={isLoading}
                >
                  {isLoading ? 'Cargando...' : (isRegister ? 'Registrarse' : 'Iniciar Sesión')}
                </button>
              </div>
            </form>

            <div className={styles.switchMode}>
              {isRegister ? (
                <p>¿Ya tienes cuenta? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(false); setMessage(''); setConfirmPassword(''); }}>Inicia sesión</a></p>
              ) : (
                <p>¿No tienes cuenta? <a href="#" onClick={(e) => { e.preventDefault(); setIsRegister(true); setMessage(''); setConfirmPassword(''); }}>Crea una cuenta</a></p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
