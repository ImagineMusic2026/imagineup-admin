import type { Metadata } from "next";

import { ModerationPage } from "@/components/moderacao/moderation-page";

export const metadata: Metadata = { title: "Moderação" };

export default function Page() {
  return <ModerationPage />;
}
