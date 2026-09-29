import { Settings2 } from "lucide-react";

import { BrandMark } from "@/components/ui/brand";

/** Tela mostrada sem as variáveis do Firebase, em vez de estourar. */
export function NotConfigured() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-[460px] flex-col gap-5">
        <BrandMark />
        <section
          aria-labelledby="titulo-nao-configurado"
          className="rounded-2xl border border-line-strong bg-surface p-6"
        >
          <Settings2 aria-hidden="true" className="size-6 text-cyan" />
          <h1 id="titulo-nao-configurado" className="mt-3 mb-0 font-display text-xl font-semibold">
            Firebase não configurado
          </h1>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-fg/70">
            Copie <code className="rounded bg-fg/[0.06] px-1 py-0.5 text-[13px] text-fg">.env.example</code> para{" "}
            <code className="rounded bg-fg/[0.06] px-1 py-0.5 text-[13px] text-fg">.env.local</code> na pasta do painel e
            preencha as chaves do projeto. Para testar com os emuladores, basta{" "}
            <code className="rounded bg-fg/[0.06] px-1 py-0.5 text-[13px] text-fg">NEXT_PUBLIC_FIREBASE_EMULATOR_HOST</code>.
            Depois, reinicie o servidor.
          </p>
        </section>
      </div>
    </main>
  );
}
