"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { auth, isFirebaseConfigured } from "@/lib/firebase";
import { signOutUser } from "@/lib/session";

interface AuthState {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Sem Firebase não há sessão para esperar: já nasce carregado. Calcular aqui,
  // e não no efeito, evita um render a mais (e o lint de setState em efeito).
  const [loading, setLoading] = useState(() => isFirebaseConfigured());

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    return onAuthStateChanged(auth(), (next) => {
      setUser(next);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading, signOut: signOutUser }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth precisa estar dentro de AuthProvider.");
  return context;
}
