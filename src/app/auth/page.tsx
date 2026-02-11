'use client';

export const dynamic = 'force-dynamic';
export const prerender = false;

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

// Simple hash function for passwords (NOT for production - just demo)
const simpleHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Verificar si ya hay sesión activa
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('auth_token');
      if (token) {
        router.push('/');
      }
    }
  }, [router]);

  const handleSignUp = () => {
    setMessage('');
    if (!email || !password) {
      setMessage('Por favor completa todos los campos');
      return;
    }

    if (password.length < 4) {
      setMessage('La contraseña debe tener al menos 4 caracteres');
      return;
    }

    setIsLoading(true);

    // Simular delay de red
    setTimeout(() => {
      try {
        // Obtener usuarios existentes
        const users = JSON.parse(localStorage.getItem('users') || '{}');

        // Verificar si el email ya existe
        if (users[email]) {
          setMessage('Este email ya está registrado');
          setIsLoading(false);
          return;
        }

        // Crear nuevo usuario
        users[email] = {
          email,
          password: simpleHash(password),
          createdAt: new Date().toISOString(),
        };

        localStorage.setItem('users', JSON.stringify(users));

        // Crear sesión
        const token = simpleHash(email + Date.now());
        localStorage.setItem('auth_token', token);
        localStorage.setItem('current_user', email);

        setMessage('¡Registro exitoso! Redirigiendo...');
        setTimeout(() => router.push('/'), 1000);
      } catch (error) {
        setMessage('Error al registrarse. Por favor intenta de nuevo.');
      }
      setIsLoading(false);
    }, 500);
  };

  const handleSignIn = () => {
    setMessage('');
    if (!email || !password) {
      setMessage('Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);

    // Simular delay de red
    setTimeout(() => {
      try {
        const users = JSON.parse(localStorage.getItem('users') || '{}');

        // Verificar si el usuario existe
        if (!users[email]) {
          setMessage('Email o contraseña incorrectos');
          setIsLoading(false);
          return;
        }

        // Verificar contraseña
        const passwordHash = simpleHash(password);
        if (users[email].password !== passwordHash) {
          setMessage('Email o contraseña incorrectos');
          setIsLoading(false);
          return;
        }

        // Crear sesión
        const token = simpleHash(email + Date.now());
        localStorage.setItem('auth_token', token);
        localStorage.setItem('current_user', email);

        setMessage('¡Login exitoso! Redirigiendo...');
        setTimeout(() => router.push('/'), 1000);
      } catch (error) {
        setMessage('Error al iniciar sesión. Por favor intenta de nuevo.');
      }
      setIsLoading(false);
    }, 500);
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
