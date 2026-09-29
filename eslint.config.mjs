// eslint-config-next 16 já publica flat config. Não usar FlatCompat aqui: o
// caminho legado tenta serializar o config e estoura em estrutura circular.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // Saída gerada fica fora do lint.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
