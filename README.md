# Painel ImagineUP

Painel administrativo do app ImagineUP, da Imagine Music. Só a equipe entra: estar logado no Firebase não basta, a conta precisa ter um documento `staff/{uid}` ativo.

Stack: Next.js 16 (App Router), React 19.2, TypeScript estrito, Tailwind CSS 4 e o SDK JavaScript do Firebase 12. O painel usa o projeto Firebase `imagine-up-app`, o mesmo do app de fãs.

Regras do Firestore e Cloud Functions ficam no repositório do app (`imagineup-app`) e são publicadas só de lá. Este painel apenas lê e chama o que o contrato da equipe define.

## Como rodar

Com o Node 20.9 ou mais novo:

```bash
cd painel
npm install
cp .env.example .env.local   # e preencha os valores
npm run dev
```

O painel abre em http://localhost:3000. Sem as variáveis do Firebase, as telas mostram "Firebase não configurado" em vez de quebrar.

No Claude Code, a configuração `imagineup-painel` do `.claude/launch.json` da raiz faz o mesmo (`npm --prefix painel run dev`).

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento na porta 3000 |
| `npm run build` | Build de produção (não roda o lint) |
| `npm start` | Serve o build |
| `npm run lint` | ESLint (`eslint .`) |
| `npm run typecheck` | TypeScript sem gerar arquivos (`tsc --noEmit`) |
| `npm test` | Testes das regras puras e da sessão (`node --test`, com dublês no lugar do Firebase) |

Antes de publicar, rode os quatro: `lint`, `typecheck`, `test` e `build`.

## Variáveis de ambiente

Ficam em `painel/.env.local` (fora do git). O `.env.example` tem só os nomes.

| Nome | Para quê |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Configuração do app web do `imagine-up-app` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Idem |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Idem |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST` | Opcional. Liga os emuladores (veja abaixo) |

As variáveis `NEXT_PUBLIC_*` entram no código no momento do build. Na Vercel, cadastre antes de publicar e publique de novo depois de mudar.

## Emuladores

Para testar sem tocar no projeto real, suba os emuladores no repositório do app (`imagineup-app`, projeto `demo-imagine-up-app`) e ponha no `.env.local`:

```bash
NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1
```

Com isso o painel usa o projeto `demo-imagine-up-app` e se liga ao Auth (9099), ao Firestore (8080) e às Functions (5001) do emulador, ignorando as chaves reais. As outras variáveis podem ficar vazias. Reinicie o `npm run dev` depois de mudar o arquivo.

## Estrutura

```
painel/
  public/imagine-logo.png      logo da Imagine (branco)
  src/app/
    layout.tsx                 fontes (Sora e Manrope, servidas pelo painel), título e noindex
    entrar/                    login e "Esqueci minha senha"
    convite/[inviteId]/        aceite do convite (token no # do link)
    (painel)/                  tudo que fica atrás do login
      layout.tsx               AuthProvider, StaffProvider, guard e casca
      page.tsx                 Visão geral (/)
      crescimento/ ranking/ fas/ artistas/ missoes/ recompensas/ moderacao/ logs/
      equipe/                  equipe e convites (só admin)
  src/components/
    ui/                        botão, campos, avisos, diálogo, menu, copiar link
    painel/                    lateral, guard, cabeçalho, estados das seções
    auth/                      telas de login e de convite
    equipe/                    listas, convite, troca de nível e confirmações
  src/lib/
    firebase.ts                inicialização preguiçosa e emuladores
    auth-context.tsx           sessão do Firebase Auth
    staff-context.tsx          staff/{uid} em tempo real (onSnapshot)
    staff.ts                   tipos, seções, papéis e regras de permissão (puro)
    staff-data.ts              leituras em tempo real da equipe e dos convites
    staff-api.ts               chamadas às Cloud Functions (southamerica-east1)
    session.ts                 login, nova senha e saída
    errors.ts                  mensagens de erro em português (puro)
    validation.ts              validação dos formulários (puro)
    invite.ts                  regras da página do convite (puro)
  tests/                       testes com node:test
```

Componentes nunca importam o Firebase: tudo passa por `src/lib`.

## Como o acesso funciona

- **Login.** Entrar só abre a sessão. O guard do painel lê `staff/{uid}` em tempo real: com status `active`, a pessoa entra; sem documento, a conta sai e volta para o login com "Esta conta não tem acesso ao painel."; com `disabled`, sai com "Seu acesso ao painel foi desativado. Fale com um admin.". O motivo vai no endereço (`/entrar?motivo=`).
- **Níveis.** Admin vê tudo e gerencia a Equipe. Editor vê e altera as seções liberadas. Leitor só vê as seções liberadas. A lateral mostra só o que a pessoa pode ver, e a mudança feita por um admin aparece na hora.
- **Convites.** O admin escolhe nome sugerido, e-mail, nível e seções em Equipe. O servidor grava o convite, manda o e-mail e devolve o link, que vale 7 dias e uma vez só (reenviar gera outro link e invalida o anterior). O token vai depois do `#`, que o navegador nunca manda para servidor nenhum.
- **Aceite.** Se o e-mail ainda não tem conta, a pessoa escolhe nome e senha (8 ou mais caracteres). Se já tem conta no app ImagineUP, entra com a senha dessa conta e o painel é ligado à mesma conta; o perfil de fã continua existindo. A sessão aberta pelo convite fica só na aba, como no login sem "Lembrar de mim".
- **Segurança.** O que a tela esconde é conforto. Quem protege os dados são as regras do Firestore e as Cloud Functions, que leem `staff/{uid}` a cada pedido.

## Publicação (Vercel)

- Projeto separado do site, com Root Directory `painel` e o preset Next.js. O site estático continua no projeto que aponta para `site/`.
- Cadastre as variáveis `NEXT_PUBLIC_FIREBASE_*` (sem a do emulador).
- Depois de ter o endereço de produção, ele precisa entrar no `PANEL_ORIGINS` (CORS das funções) e no parâmetro `PANEL_URL` (link do convite) no `imagineup-app`, e as funções precisam ser publicadas de novo.
- O painel sai com `noindex` (metadados, cabeçalho `X-Robots-Tag` e `robots.txt`) e não pode ser aberto dentro de iframe de outro site.
