import type { Metadata } from "next";

import { ApplicationPage } from "@/components/fa-clubes/application-page";

export const metadata: Metadata = { title: "Candidatura a fã-clube" };

export default async function Page({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  return <ApplicationPage uid={uid} />;
}
