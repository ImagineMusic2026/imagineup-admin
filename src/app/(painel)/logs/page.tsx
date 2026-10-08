import type { Metadata } from "next";

import { LogsPage } from "@/components/logs/logs-page";

export const metadata: Metadata = { title: "Logs e auditoria" };

export default function Page() {
  return <LogsPage />;
}
