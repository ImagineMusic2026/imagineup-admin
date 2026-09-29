import type { Metadata } from "next";

import { InviteScreen } from "@/components/auth/invite-screen";

export const metadata: Metadata = { title: "Convite", referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ inviteId: string }> }) {
  const { inviteId } = await params;
  return <InviteScreen inviteId={inviteId} />;
}
