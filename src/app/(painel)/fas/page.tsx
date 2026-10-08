import type { Metadata } from "next";

import { FansPage } from "@/components/fas/fans-page";

export const metadata: Metadata = { title: "Fãs" };

export default function Page() {
  return <FansPage />;
}
