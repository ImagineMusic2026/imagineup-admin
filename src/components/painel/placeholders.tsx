import { Hammer, Lock } from "lucide-react";

/** Cartão calmo das seções que ainda não existem. */
export function UnderConstruction() {
  return (
    <section
      aria-labelledby="titulo-em-construcao"
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-6 py-10 sm:px-10 sm:py-14"
    >
      {/* Listras finas a 120 graus, as mesmas do cartão de missão do app. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:repeating-linear-gradient(120deg,rgb(255_255_255/0.035)_0_1px,transparent_1px_14px)]"
      />
      <div className="relative flex max-w-[520px] flex-col items-start gap-3">
        <span className="grid size-11 place-items-center rounded-xl border border-line-strong bg-raised text-cyan">
          <Hammer aria-hidden="true" className="size-5" />
        </span>
        <h2 id="titulo-em-construcao" className="m-0 font-display text-lg font-semibold">
          Em construção
        </h2>
        <p className="m-0 text-sm leading-relaxed text-fg/65">
          Esta seção ainda está sendo feita. Ela aparece aqui, com os dados do app, assim que ficar pronta.
        </p>
      </div>
    </section>
  );
}

/** Rota de seção que a pessoa não tem liberada. */
export function NoAccess() {
  return (
    <section
      aria-labelledby="titulo-sem-acesso"
      className="rounded-[var(--radius-card)] border border-line bg-surface px-6 py-10 sm:px-10 sm:py-14"
    >
      <div className="flex max-w-[520px] flex-col items-start gap-3">
        <span className="grid size-11 place-items-center rounded-xl border border-line-strong bg-raised text-fg/70">
          <Lock aria-hidden="true" className="size-5" />
        </span>
        <h2 id="titulo-sem-acesso" className="m-0 font-display text-lg font-semibold">
          Você não tem acesso a esta seção.
        </h2>
        <p className="m-0 text-sm leading-relaxed text-fg/65">
          Se precisar dela, peça a um admin para liberar em Equipe.
        </p>
      </div>
    </section>
  );
}
