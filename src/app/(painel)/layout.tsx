"use client";

import { AppShell } from "@/components/painel/app-shell";
import { StaffGuard } from "@/components/painel/staff-guard";
import { NotConfigured } from "@/components/ui/not-configured";
import { AuthProvider } from "@/lib/auth-context";
import { isFirebaseConfigured } from "@/lib/firebase";
import { StaffProvider } from "@/lib/staff-context";

/**
 * Tudo que fica atrás do login. O guard lê `staff/{uid}` em tempo real e só
 * então monta a casca (lateral e conteúdo), que não remonta ao trocar de seção.
 */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  if (!isFirebaseConfigured()) return <NotConfigured />;

  return (
    <AuthProvider>
      <StaffProvider>
        <StaffGuard>
          <AppShell>{children}</AppShell>
        </StaffGuard>
      </StaffProvider>
    </AuthProvider>
  );
}
