"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { accessStateOf, type StaffMember } from "@/lib/staff";
import { subscribeToOwnStaff, type OwnStaffSnapshot } from "@/lib/staff-data";

/**
 * Acesso da pessoa logada ao painel, em tempo real (`onSnapshot` em
 * `staff/{uid}`). Desativar, remover ou trocar as seções de alguém chega aqui na
 * hora, e o guard e a lateral reagem sem recarregar a página.
 */
export type StaffAccess =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "active"; member: StaffMember }
  | { state: "disabled"; member: StaffMember }
  | { state: "none" }
  | { state: "error"; error: unknown };

interface StaffContextValue {
  access: StaffAccess;
  retry: () => void;
}

type Result = { uid: string; attempt: number } & (OwnStaffSnapshot | { kind: "error"; error: unknown });

const StaffContext = createContext<StaffContextValue | null>(null);

export function StaffProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const uid = user?.uid ?? null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeToOwnStaff(
      uid,
      (snapshot) => setResult({ uid, attempt, ...snapshot }),
      (error) => setResult({ uid, attempt, kind: "error", error }),
    );
  }, [uid, attempt]);

  // O resultado guardado só vale para a mesma pessoa e a mesma tentativa:
  // trocar de conta volta para "carregando" sem precisar limpar estado no efeito.
  const access = useMemo<StaffAccess>(() => {
    if (loading) return { state: "loading" };
    if (!uid) return { state: "signed-out" };
    if (!result || result.uid !== uid || result.attempt !== attempt) return { state: "loading" };
    if (result.kind === "error") return { state: "error", error: result.error };
    if (result.kind === "missing") return { state: "none" };
    const state = accessStateOf(result.member);
    if (state === "active") return { state: "active", member: result.member };
    if (state === "disabled") return { state: "disabled", member: result.member };
    return { state: "none" };
  }, [loading, uid, result, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const value = useMemo(() => ({ access, retry }), [access, retry]);

  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>;
}

export function useStaffAccess(): StaffContextValue {
  const context = useContext(StaffContext);
  if (!context) throw new Error("useStaffAccess precisa estar dentro de StaffProvider.");
  return context;
}

/** A pessoa da equipe, dentro do painel (o guard só renderiza com acesso ativo). */
export function useStaffMember(): StaffMember {
  const { access } = useStaffAccess();
  if (access.state !== "active") throw new Error("useStaffMember só funciona com acesso ativo.");
  return access.member;
}
