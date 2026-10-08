"use client";

import { useState } from "react";

import { AchievementsTab } from "@/components/missoes/achievements-tab";
import { MissionsTab } from "@/components/missoes/missions-tab";
import { PointsTab } from "@/components/missoes/points-tab";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { LoadError, LoadingRow, SectionCard } from "@/components/painel/section-card";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { getGameConfigs } from "@/lib/game-data";
import { canEditSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("missions");

type GameTab = "missions" | "achievements" | "points";

/**
 * Missões e régua (`/missoes`): as missões e a meta da temporada, as
 * conquistas e a régua de pontos. Os quatro documentos de configuração chegam
 * numa leitura única ao abrir e no "Atualizar"; cada mudança lê de novo.
 * Leitor vê tudo, sem botões de mudança.
 */
export function MissionsPage() {
  return <SectionGate section="missions">{(member) => <MissionsContent member={member} />}</SectionGate>;
}

function MissionsContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "missions");
  const configs = useLoad(getGameConfigs);
  const [tab, setTab] = useState<GameTab>("missions");
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);

  const data = configs.state.status === "ready" ? configs.state.data : null;

  function show(tone: "success" | "error" | "info", text: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));
  }

  function refresh() {
    setNow(Date.now());
    configs.reload();
  }

  function changed(message: string) {
    show("success", message);
    refresh();
  }

  const shared = { canEdit, now, onChanged: changed, onNotice: show, onReload: refresh };

  return (
    <>
      <PageHeader title={INFO.label} subtitle={INFO.description} actions={<RefreshButton onClick={refresh} busy={configs.reloading} loadedAt={configs.loadedAt} />} />

      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={notice.tone === "error"}>
          {notice.text}
        </Notice>
      ) : null}
      {configs.refreshError ? <Notice tone="error">Não deu para atualizar: {configs.refreshError}</Notice> : null}

      {configs.state.status === "error" ? (
        <SectionCard id="titulo-missoes-erro" title="Missões e régua">
          <LoadError message={configs.state.message} headingId="titulo-missoes-erro" onRetry={refresh} />
        </SectionCard>
      ) : !data ? (
        <SectionCard id="titulo-missoes-carregando" title="Missões e régua">
          <LoadingRow label="Carregando as missões, as conquistas e a régua..." />
        </SectionCard>
      ) : (
        <Tabs
          label="Partes de Missões e régua"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "missions", label: "Missões", render: () => <MissionsTab member={member} configs={data} {...shared} /> },
            { id: "achievements", label: "Conquistas", render: () => <AchievementsTab configs={data} {...shared} /> },
            {
              id: "points",
              label: "Régua de pontos",
              render: () => (
                <PointsTab
                  canEdit={canEdit}
                  points={data.points.config}
                  achievements={data.achievements.achievements}
                  reloading={configs.reloading}
                  onChanged={changed}
                  onReload={refresh}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}
