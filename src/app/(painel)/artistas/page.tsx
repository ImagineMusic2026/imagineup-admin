import type { Metadata } from "next";

import { ArtistsPage } from "@/components/artistas/artists-page";

export const metadata: Metadata = { title: "Artistas e centrais" };

export default function Page() {
  return <ArtistsPage />;
}
