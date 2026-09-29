"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { FullScreenLoading, FullScreenMessage } from "@/components/painel/full-screen-state";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { firestoreErrorMessage } from "@/lib/errors";
import { loginUrl, type ExitReason } from "@/lib/login-reasons";
import { useStaffAccess } from "@/lib/staff-context";

/**
 * Só deixa o painel aparecer para quem tem `staff/{uid}` com status `active`.
 *
 * - Sem login: vai para /entrar.
 * - Logado sem documento (fã, conta removida da equipe) ou com o documento
 *   desativado: sai da conta e vai para /entrar com o motivo no endereço.
 * - Como o documento é lido em tempo real, desativar ou remover alguém tira a
 *   pessoa do painel na hora.
 *
 * Isto é conforto de tela. Quem protege os dados são as regras do Firestore e
 * as Cloud Functions, que leem o mesmo documento a cada pedido.
 */
export function StaffGuard({ children }: { children: React.ReactNode }) {
  const { access, retry } = useStaffAccess();
  const { signOut } = useAuth();
  const router = useRouter();
  const exitReason = useRef<ExitReason | null>(null);

  useEffect(() => {
    if (access.state === "signed-out") {
      router.replace(loginUrl(exitReason.current));
      return;
    }
    if (access.state === "none" || access.state === "disabled") {
      exitReason.current = access.state === "disabled" ? "desativado" : "sem-acesso";
      // Ao sair, o estado vira "signed-out" e o ramo acima leva ao login com o motivo.
      signOut().catch(() => router.replace(loginUrl(exitReason.current)));
    }
  }, [access.state, router, signOut]);

  if (access.state === "active") return <>{children}</>;

  if (access.state === "error") {
    return (
      <FullScreenMessage
        title="Não foi possível conferir seu acesso"
        actions={
          <>
            <Button variant="primary" onClick={retry}>
              Tentar de novo
            </Button>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sair
            </Button>
          </>
        }
      >
        <p className="m-0" role="alert">
          {firestoreErrorMessage(access.error)}
        </p>
      </FullScreenMessage>
    );
  }

  const leaving = access.state === "none" || access.state === "disabled" || access.state === "signed-out";
  return <FullScreenLoading label={leaving ? "Saindo..." : "Conferindo seu acesso..."} />;
}
