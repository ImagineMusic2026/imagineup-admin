"use client";

import { PageHeader } from "@/components/painel/page-header";
import { NoAccess } from "@/components/painel/placeholders";
import { canSeeSection, sectionInfo, type SectionId, type StaffMember } from "@/lib/staff";
import { useStaffMember } from "@/lib/staff-context";

/**
 * Porta de uma página de seção: sem a seção, o cabeçalho com "Você não tem
 * acesso a esta seção."; com ela, a tela. O acesso chega em tempo real (a
 * escuta de `staff-context.tsx`), então a tela some na hora em que a seção é
 * tirada. Quem protege os dados são as regras e as callables.
 */
export function SectionGate({
  section,
  children,
}: {
  section: SectionId;
  children: React.ReactNode | ((member: StaffMember) => React.ReactNode);
}) {
  const member = useStaffMember();
  if (!canSeeSection(member, section)) {
    return (
      <>
        <PageHeader title={sectionInfo(section).label} />
        <NoAccess />
      </>
    );
  }
  return <>{typeof children === "function" ? children(member) : children}</>;
}
