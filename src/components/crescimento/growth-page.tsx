"use client";

import { useState } from "react";

import { ActivesTab } from "@/components/crescimento/actives-tab";
import { CompareTab } from "@/components/crescimento/compare-tab";
import { SignupsTab } from "@/components/crescimento/signups-tab";
import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { DEFAULT_PERIOD, type PeriodDays } from "@/components/ui/period-picker";
import { Tabs } from "@/components/ui/tabs";
import { sectionInfo } from "@/lib/staff";

const INFO = sectionInfo("growth");

type GrowthTab = "signups" | "actives" | "compare";

/**
 * Crescimento (`/crescimento`): cadastros e origem, ativos e retenção, e o
 * Comparativo, cada aba com a própria leitura (só quando abre). O período vale
 * para as duas primeiras; o Comparativo tem os controles dele. Sem ação de
 * mudança: Leitor, Editor e Admin veem o mesmo.
 */
export function GrowthPage() {
  return (
    <SectionGate section="growth">
      <GrowthContent />
    </SectionGate>
  );
}

function GrowthContent() {
  const [now] = useState(() => Date.now());
  const [period, setPeriod] = useState<PeriodDays>(DEFAULT_PERIOD);
  const [tab, setTab] = useState<GrowthTab>("signups");
  return (
    <>
      <PageHeader title={INFO.label} subtitle={INFO.description} />
      <Tabs
        label="Partes da Crescimento"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "signups", label: "Cadastros e origem", render: () => <SignupsTab period={period} onPeriod={setPeriod} now={now} /> },
          { id: "actives", label: "Ativos e retenção", render: () => <ActivesTab period={period} onPeriod={setPeriod} now={now} /> },
          { id: "compare", label: "Comparativo", render: () => <CompareTab now={now} /> },
        ]}
      />
    </>
  );
}
