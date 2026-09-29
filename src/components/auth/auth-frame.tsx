import { BrandMark } from "@/components/ui/brand";
import { cx } from "@/components/ui/cx";

/**
 * Moldura das telas fora do painel (login e convite), na linguagem do design:
 * fundo escuro com um brilho rosa discreto, marca no topo e um cartão.
 */
export function AuthFrame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-56 left-1/2 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-pink/[0.13] blur-[120px]" />
        <div className="absolute inset-0 opacity-40 [background-image:repeating-linear-gradient(120deg,rgb(255_255_255/0.025)_0_1px,transparent_1px_16px)] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
      </div>
      <main
        className={cx(
          "mx-auto flex min-h-dvh w-full flex-col justify-center gap-7 px-4 py-10 sm:py-14",
          wide ? "max-w-[520px]" : "max-w-[440px]",
        )}
      >
        <BrandMark priority className="self-center" />
        <div className="rounded-2xl border border-line-strong bg-surface p-6 shadow-[0_24px_80px_rgb(0_0_0/0.45)] sm:p-8">
          {children}
        </div>
        <p className="m-0 text-center text-[12.5px] text-fg/55">Acesso restrito à equipe da Imagine Music.</p>
      </main>
    </div>
  );
}

export function AuthHeading({ title, subtitle, id }: { title: string; subtitle?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-6">
      <h1 id={id} tabIndex={-1} className="m-0 font-display text-[24px] leading-tight font-semibold tracking-[-0.015em] outline-none">
        {title}
      </h1>
      {subtitle ? <p className="mt-2 mb-0 text-sm leading-relaxed text-fg/65">{subtitle}</p> : null}
    </div>
  );
}
