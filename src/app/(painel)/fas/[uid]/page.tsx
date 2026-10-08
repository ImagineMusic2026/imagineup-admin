import type { Metadata } from "next";

import { FanPage } from "@/components/fas/fan-page";

export const metadata: Metadata = { title: "Ficha do fã" };

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  return <FanPage uid={uid} />;
}
