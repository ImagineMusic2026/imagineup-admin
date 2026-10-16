// eslint-config-next 16 já publica flat config. Não usar FlatCompat aqui: o
// caminho legado tenta serializar o config e estoura em estrutura circular.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // As leituras do Firestore passam pelo `readQuery` (consultas) e pelo
    // `readDoc` (documentos das telas com "Atualizado às"), que vão ao servidor.
    // Sem rede, o `getDocs` e os `...FromCache` resolvem com o que estiver no
    // cache (vazio ou velho), e a tela fica pronta com o dado errado. Fica de
    // fora só o `firestore-read.ts`, que é quem importa as leituras do servidor.
    files: ["src/**"],
    ignores: ["src/lib/firestore-read.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase/firestore",
              importNames: ["getDocs", "getDocsFromCache", "getDocFromCache"],
              message: "Leia pelo readQuery ou pelo readDoc de @/lib/firestore-read: sem rede, este responde com o cache, vazio ou velho.",
            },
          ],
        },
      ],
    },
  },
  {
    // Saída gerada fica fora do lint.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
