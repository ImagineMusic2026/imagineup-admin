import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-5">
        <BrandMark />
        <section aria-labelledby="titulo-nao-encontrada" className="rounded-2xl border border-line-strong bg-surface p-6">
          <h1 id="titulo-nao-encontrada" className="m-0 font-display text-xl font-semibold">
            Página não encontrada
          </h1>
          <p className="mt-2 mb-5 text-sm leading-relaxed text-fg/70">Esse endereço não existe no painel.</p>
          <ButtonLink href="/" variant="primary">
            Voltar ao painel
          </ButtonLink>
        </section>
      </div>
    </main>
  );
}
