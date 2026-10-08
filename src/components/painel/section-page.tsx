"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PageHeader } from "@/components/painel/page-header";
import { NoAccess, UnderConstruction } from "@/components/painel/placeholders";
import { canSeeSection, firstAllowedRoute, sectionInfo, type SectionId } from "@/lib/staff";
import { useStaffMember } from "@/lib/staff-context";

/**
 * Página de seção: confere se a pessoa vê a seção (a lista vem em tempo real)
 * e mostra o cabeçalho do design com o cartão "Em construção".
 */
export function SectionPage({ section }: { section: SectionId }) {
  const member = useStaffMember();
  const info = sectionInfo(section);

  if (!canSeeSection(member, section)) {
    return (
      <>
        <PageHeader title={info.label} />
        <NoAccess />
      </>
    );
  }

  return (
    <>
      <PageHeader title={info.label} subtitle={info.description} />
      <UnderConstruction />
    </>
  );
}

/**
 * Início (`/`): é a Visão geral. Quem não vê a Visão geral vai para a primeira
 * seção liberada, na ordem da lateral. Sem o conteúdo (`overview`), mostra o
 * "Em construção".
 */
export function HomePage({ overview }: { overview?: React.ReactNode } = {}) {
  const member = useStaffMember();
  const router = useRouter();
  const canSeeOverview = canSeeSection(member, "overview");
  const target = canSeeOverview ? null : firstAllowedRoute(member);

  useEffect(() => {
    if (target && target !== "/") router.replace(target);
  }, [target, router]);

  if (canSeeOverview) return overview ? <>{overview}</> : <SectionPage section="overview" />;

  if (target) {
    return (
      <p role="status" className="m-0 text-sm text-fg/65">
        Abrindo a sua primeira seção...
      </p>
    );
  }

  return (
    <>
      <PageHeader title="Painel ImagineUP" />
      <NoAccess />
    </>
  );
}
