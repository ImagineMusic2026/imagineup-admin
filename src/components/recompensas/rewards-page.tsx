"use client";

import { useState } from "react";

import { PageHeader } from "@/components/painel/page-header";
import { SectionGate } from "@/components/painel/section-gate";
import { CatalogTab } from "@/components/recompensas/catalog-tab";
import { NumbersTab } from "@/components/recompensas/numbers-tab";
import { OrdersTab } from "@/components/recompensas/orders-tab";
import { Notice } from "@/components/ui/notice";
import { RefreshButton } from "@/components/ui/refresh-button";
import { Tabs } from "@/components/ui/tabs";
import { useLoad } from "@/components/ui/use-load";
import { getRewards } from "@/lib/reward-data";
import { canEditSection, sectionInfo, type StaffMember } from "@/lib/staff";

const INFO = sectionInfo("rewards");

type RewardsTab = "orders" | "catalog" | "numbers";

/**
 * Recompensas e resgates (`/recompensas`): Pedidos (o trabalho do dia),
 * Catálogo e Números, em leitura única. O catálogo é lido uma vez para as
 * três abas (o filtro dos pedidos e os títulos dos números usam). O Leitor vê
 * tudo, sem botões e sem os contatos.
 */
export function RewardsPage() {
  return <SectionGate section="rewards">{(member) => <RewardsContent member={member} />}</SectionGate>;
}

function RewardsContent({ member }: { member: StaffMember }) {
  const canEdit = canEditSection(member, "rewards");
  const catalog = useLoad(getRewards);
  const [tab, setTab] = useState<RewardsTab>("orders");
  const [now, setNow] = useState(() => Date.now());
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState<{ key: number; tone: "success" | "error" | "info"; text: string } | null>(null);
  const rewards = catalog.state.status === "ready" ? catalog.state.data : null;

  function show(tone: "success" | "error" | "info", text: string) {
    setNotice((current) => ({ key: (current?.key ?? 0) + 1, tone, text }));
  }

  function refresh() {
    setNow(Date.now());
    catalog.reload();
    setRefreshKey((value) => value + 1);
  }

  function changed(message: string) {
    show("success", message);
    catalog.reload();
  }

  return (
    <>
      <PageHeader title={INFO.label} subtitle={INFO.description} actions={<RefreshButton onClick={refresh} busy={catalog.reloading} loadedAt={catalog.loadedAt} />} />

      <div aria-live="polite" className="sr-only">
        {notice && notice.tone !== "error" ? <p key={notice.key}>{notice.text}</p> : null}
      </div>
      {notice ? (
        <Notice tone={notice.tone} announce={notice.tone === "error"}>
          {notice.text}
        </Notice>
      ) : null}
      {catalog.refreshError ? <Notice tone="error">Não deu para atualizar: {catalog.refreshError}</Notice> : null}

      <Tabs
        label="Partes de Recompensas e resgates"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "orders", label: "Pedidos", render: () => <OrdersTab member={member} canEdit={canEdit} rewards={rewards} now={now} refreshKey={refreshKey} onNotice={show} /> },
          {
            id: "catalog",
            label: "Catálogo",
            render: () => <CatalogTab canEdit={canEdit} rewards={catalog.state} now={now} onChanged={changed} onNotice={show} onReload={catalog.reload} />,
          },
          { id: "numbers", label: "Números", render: () => <NumbersTab rewards={rewards} now={now} refreshKey={refreshKey} /> },
        ]}
      />
    </>
  );
}
