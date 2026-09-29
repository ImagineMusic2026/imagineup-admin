// Resolve o alias `@/` como o Next faz, para os testes importarem os arquivos
// de `src/lib` direto pelo Node (remoção de tipos do Node 22.18+).
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
    const candidates = [`${base.href}.ts`, `${base.href}.tsx`, `${base.href}/index.ts`];
    const found = candidates.find((candidate) => existsSync(new URL(candidate)));
    return nextResolve(found ?? specifier, context);
  },
});
