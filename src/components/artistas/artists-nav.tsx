"use client";

import Link from "next/link";

import { cx } from "@/components/ui/cx";

export type ArtistsPageId = "centrais" | "mural" | "agenda";

const PAGES: { id: ArtistsPageId; label: string; href: string }[] = [
  { id: "centrais", label: "Centrais", href: "/artistas" },
  { id: "mural", label: "Mural", href: "/artistas/mural" },
  { id: "agenda", label: "Agenda", href: "/artistas/agenda" },
];

/**
 * A navegação das três páginas de Artistas: links (não abas), com
 * `aria-current="page"` na de agora. O filtro da central segue para o Mural
 * e a Agenda pelo endereço (`?central=`).
 */
export function ArtistsNav({ current, central = null }: { current: ArtistsPageId; central?: string | null }) {
  return (
    <nav aria-label="Páginas de Artistas e centrais" className="-mt-2 border-b border-line">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0">
        {PAGES.map((page) => {
          const active = page.id === current;
          const href = central && page.id !== "centrais" ? `${page.href}?central=${encodeURIComponent(central)}` : page.href;
          return (
            <li key={page.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative inline-flex h-10 items-center px-3 text-sm font-semibold transition-colors",
                  active ? "text-fg after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-pink" : "text-fg/65 hover:text-fg",
                )}
              >
                {page.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
