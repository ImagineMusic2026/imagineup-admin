import type { Metadata } from "next";

import { FanModerationPage } from "@/components/moderacao/fan-moderation-page";

export const metadata: Metadata = { title: "Fã na Moderação" };

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  return <FanModerationPage uid={uid} />;
}
