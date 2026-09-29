import { LoaderCircle } from "lucide-react";

import { BrandMark } from "@/components/ui/brand";

/** Tela inteira de espera, com a marca, enquanto o login e o acesso são conferidos. */
export function FullScreenLoading({ label }: { label: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex flex-col items-center gap-5" role="status">
        <BrandMark priority />
        <p className="m-0 flex items-center gap-2 text-sm text-fg/65">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {label}
        </p>
      </div>
    </main>
  );
}

/** Tela inteira com mensagem e ações (erro ao conferir o acesso). */
export function FullScreenMessage({
  title,
  children,
  actions,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-5">
        <BrandMark />
        <section aria-labelledby="titulo-da-mensagem" className="rounded-2xl border border-line-strong bg-surface p-6">
          <h1 id="titulo-da-mensagem" className="m-0 font-display text-xl font-semibold">
            {title}
          </h1>
          {children ? <div className="mt-2 text-sm leading-relaxed text-fg/70">{children}</div> : null}
          {actions ? <div className="mt-5 flex flex-wrap gap-2">{actions}</div> : null}
        </section>
      </div>
    </main>
  );
}
