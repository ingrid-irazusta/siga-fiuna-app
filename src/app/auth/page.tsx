"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleSignUp = async () => {
    setMessage("");
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setMessage("Error al registrarse: " + error.message);
      return;
    }

    if (data.user) {
      const { error: profileError } = await supabase
        .from("user_profiles")
        .insert({ user_id: data.user.id, email: data.user.email });

      if (profileError) {
        setMessage("Error al crear perfil: " + profileError.message);
        return;
      }

      setMessage("Registro exitoso! Redirigiendo...");
      router.push("/"); // 🔹 Redirige al home
    }
  };

  const handleSignIn = async () => {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage("Error al iniciar sesión: " + error.message);
    } else {
      setMessage("Login exitoso! Redirigiendo...");
      router.push("/"); // 🔹 Redirige al home
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "2rem auto", textAlign: "center" }}>
      <h1>Login / Registro</h1>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", marginBottom: 10, padding: 8 }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", marginBottom: 10, padding: 8 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button onClick={handleSignIn} style={{ padding: "8px 16px" }}>Login</button>
        <button onClick={handleSignUp} style={{ padding: "8px 16px" }}>Registro</button>
      </div>
      {message && <p style={{ marginTop: 10 }}>{message}</p>}
    </div>
  );
}
