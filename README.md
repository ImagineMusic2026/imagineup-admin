# Painel ImagineUP

Painel administrativo do app ImagineUP, da Imagine Music. Só a equipe entra: estar logado no Firebase não basta, a conta precisa ter um documento `staff/{uid}` ativo.

Stack: Next.js 16 (App Router), React 19.2, TypeScript estrito, Tailwind CSS 4 e o SDK JavaScript do Firebase 12. O painel usa o projeto Firebase `imagine-up-app`, o mesmo do app de fãs.

Regras do Firestore e Cloud Functions ficam no repositório do app (`ImagineMusic2026/imagineup-app`) e são publicadas só de lá. Este painel apenas lê e chama o que o contrato da equipe define. O site público do ImagineUP é outro repositório (`ImagineMusic2026/imagineup-LP`).

## Como rodar

Com o Node 20.9 ou mais novo:

```bash
npm install
cp .env.example .env.local   # e preencha os valores
npm run dev
```

O painel abre em http://localhost:3000. Sem as variáveis do Firebase, as telas mostram "Firebase não configurado" em vez de quebrar.

No Claude Code, a configuração `imagineup-admin` do `.claude/launch.json` (local, fora do git) faz o mesmo.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento na porta 3000 |
| `npm run build` | Build de produção (não roda o lint) |
| `npm start` | Serve o build |
| `npm run lint` | ESLint (`eslint .`) |
| `npm run typecheck` | TypeScript sem gerar arquivos (`tsc --noEmit`) |
| `npm test` | Testes das regras puras (equipe, artistas, recorte da foto, erros, formatos, dias, números do dia, régua, lotes), da sessão e das leituras (`node --test`, com dublês no lugar do Firebase) |

Antes de publicar, rode os quatro: `lint`, `typecheck`, `test` e `build`.

## Variáveis de ambiente

Ficam em `.env.local` (fora do git). O `.env.example` tem só os nomes.

| Nome | Para quê |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Configuração do app web do `imagine-up-app` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Idem |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Idem |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Idem |
| `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST` | Opcional. Liga os emuladores (veja abaixo) |
| `NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT`, `_FIRESTORE_PORT`, `_FUNCTIONS_PORT`, `_STORAGE_PORT` | Opcionais. Portas dos emuladores (padrões 9099, 8080, 5001 e 9199) |

As variáveis `NEXT_PUBLIC_*` entram no código no momento do build. Na Vercel, cadastre antes de publicar e publique de novo depois de mudar.

## Emuladores

Para testar sem tocar no projeto real, suba os emuladores no repositório do app (`imagineup-app`, projeto `demo-imagine-up-app`) e ponha no `.env.local`:

```bash
NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1
```

Com isso o painel usa o projeto `demo-imagine-up-app` (bucket `demo-imagine-up-app.appspot.com`) e se liga ao Auth (9099), ao Firestore (8080), às Functions (5001) e ao Storage (9199) do emulador, ignorando as chaves reais. As outras variáveis podem ficar vazias. Reinicie o `npm run dev` depois de mudar o arquivo.

Se outra sessão já ocupa as portas padrão, suba os emuladores com uma cópia do `firebase.json` em outras portas e aponte o painel para elas com `NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT`, `_FIRESTORE_PORT`, `_FUNCTIONS_PORT` e `_STORAGE_PORT`.

## Estrutura

```
imagineup-admin/
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
    ui/                        botão, campos (texto, lista, interruptor), avisos, diálogo,
                               confirmação, menu, copiar link, lista em tempo real;
                               do bloco 11: leitura única (use-load, use-paged-list),
                               cartões de número, gráficos de barras, período, tabela
                               com "Carregar mais", busca, filtros, selo de situação,
                               abas, estado vazio, detalhes, campo de imagem, lote,
                               "Atualizar", Subir e Descer (order-buttons)
    painel/                    lateral, guard, cabeçalho, cartão de seção, estados das seções,
                               porta da seção (section-gate), avatar do fã, data dos números
    auth/                      telas de login e de convite
    equipe/                    listas, convite e troca de nível
    artistas/                  /artistas (centrais), /artistas/mural e /artistas/agenda, a navegação
                               entre as três, os diálogos de central, post, comentários e show
    visao-geral/ crescimento/  Visão geral; Crescimento com cadastros, ativos e o Comparativo
    ranking/                   temporada atual e próxima, ranking ao vivo, temporadas passadas
    fas/                       lista e busca, a ficha com as abas e o ajuste de pontos
    missoes/                   missões e meta, conquistas, régua de pontos
    recompensas/               pedidos (com os contatos), catálogo e números
    moderacao/                 fila, resolvidos, ocultos, suspensos e a página do fã
    logs/                      auditoria com os filtros e os detalhes
  src/lib/
    firebase.ts                inicialização preguiçosa e emuladores
    auth-context.tsx           sessão do Firebase Auth
    staff-context.tsx          staff/{uid} em tempo real (onSnapshot)
    staff.ts                   tipos, seções, papéis e regras de permissão (puro)
    staff-data.ts              leituras em tempo real da equipe e dos convites
    staff-api.ts               chamadas às Cloud Functions (southamerica-east1)
    artists.ts                 tipos, gêneros, @, contato, formulário, publicação e ordem (puro)
    artist-photo.ts            recorte 3:4 e as duas versões da foto no navegador
    artist-storage.ts          envio das fotos para o Storage
    artist-data.ts             centrais e privados em tempo real, juntos pelo id
    artist-api.ts              chamadas às Cloud Functions dos artistas
    session.ts                 login, nova senha e saída
    errors.ts                  mensagens de erro em português (puro)
    validation.ts              validação dos formulários (puro)
    invite.ts                  regras da página do convite (puro)
    callable.ts                o `call` das Cloud Functions, com o prazo longo de 130 s
    format.ts                  números, pontos, porcentagens, variação, datas e horas (puro)
    day.ts                     dias, semanas e meses de São Paulo, espelho do servidor (puro)
    stats.ts                   os números do dia: soma, fechamento, séries, ativos e retenção (puro)
    stats-data.ts              dias fechados (statsDaily), statsMeta/close e os shards de hoje
    firestore-page.ts          páginas por cursor e count()
    fan-profile.ts             perfil do fã (puro) e fan-profile-data.ts, as leituras dele
    levels.ts                  régua de níveis, espelho do servidor (puro)
    game-names-data.ts         títulos das missões e nomes das conquistas
    artist-names-data.ts       nomes das centrais em leitura única
    moderation-api.ts          callables da Moderação (o moderateComment também serve o Mural)
    image-prep.ts              imagem recortada e reduzida no navegador (puro nas contas)
    media-storage.ts           envio de imagens e do vídeo para o Storage
    batch.ts                   ações em lote, uma chamada por vez (puro)
    overview.ts growth.ts compare.ts   contas da Visão geral e de Crescimento (puras)
    audit.ts audit-data.ts     rótulos, alvos e filtros dos Logs; as consultas de staffAudit
    fans.ts fan-data.ts fan-search.ts fan-api.ts   a seção Fãs: contas, leituras, busca e callables
    season.ts season-data.ts season-api.ts         Ranking e temporadas
    missions.ts achievements.ts points-config.ts   missões, conquistas e régua (puros)
    game-data.ts game-api.ts   leituras e callables de Missões e régua
    rewards.ts reward-data.ts reward-api.ts        Recompensas e resgates
    moderation.ts moderation-data.ts               a Moderação (puro e leituras)
    posts.ts post-data.ts post-api.ts post-media.ts   o Mural (o vídeo e a capa no navegador)
    events.ts event-data.ts event-api.ts           a Agenda (fusos e UFs copiados do servidor)
  tests/                       testes com node:test; fakes/firestore.mjs é o dublê das leituras
```

Componentes nunca importam o Firebase: tudo passa por `src/lib`.

## Como o acesso funciona

- **Login.** Entrar só abre a sessão. O guard do painel lê `staff/{uid}` em tempo real: com status `active`, a pessoa entra; sem documento, a conta sai e volta para o login com "Esta conta não tem acesso ao painel."; com `disabled`, sai com "Seu acesso ao painel foi desativado. Fale com um admin.". O motivo vai no endereço (`/entrar?motivo=`).
- **Níveis.** Admin vê tudo e gerencia a Equipe. Editor vê e altera as seções liberadas. Leitor só vê as seções liberadas. A lateral mostra só o que a pessoa pode ver, e a mudança feita por um admin aparece na hora.
- **Convites.** O admin escolhe nome sugerido, e-mail, nível e seções em Equipe. O servidor grava o convite, manda o e-mail e devolve o link, que vale 7 dias e uma vez só (reenviar gera outro link e invalida o anterior). O token vai depois do `#`, que o navegador nunca manda para servidor nenhum.
- **Aceite.** Se o e-mail ainda não tem conta, a pessoa escolhe nome e senha (8 ou mais caracteres). Se já tem conta no app ImagineUP, entra com a senha dessa conta e o painel é ligado à mesma conta; o perfil de fã continua existindo. A sessão aberta pelo convite fica só na aba, como no login sem "Lembrar de mim".
- **Segurança.** O que a tela esconde é conforto. Quem protege os dados são as regras do Firestore e as Cloud Functions, que leem `staff/{uid}` a cada pedido.

## Telas do bloco 11: leitura e números

O contrato das telas novas é a seção 26 de `imagineup-app/docs/arquitetura-api.md`. As convenções que valem para todas:

- **Sem escuta em tempo real.** Nenhuma tela nova usa `onSnapshot` (decisão do dono, para não gastar leitura): tudo lê ao abrir e no botão "Atualizar", com a hora da última leitura. O `useLoad` faz a leitura única (a função de leitura vem do `useCallback`), e o `usePagedList` faz as listas com "Carregar mais" por cursor (25 por vez, 50 nos Logs) e o total por `count()`. As escutas de antes ficam: o acesso de quem está logado, Equipe e a lista de centrais.
- **Porta da seção.** Toda página nova usa o `SectionGate`. Ações só com `canEditSection`; o Leitor vê tudo, sem botões.
- **Números do dia.** O servidor fecha cada dia às 00:20 (`closeStatsDays`) num documento `statsDaily/{dia}`. As telas leem os dias fechados por faixa (até 90 por consulta) e o `statsMeta/close`, e o `DataFreshness` diz até quando os números vão. Só o dia de ontem, antes do fechamento dele, é somado no navegador; hoje, só pelo botão "Ver hoje até agora". Os períodos são de 7, 30 ou 90 dias terminando ontem. O retrato da noite (fãs, membros por central) vale o do último dia que tem um, e os ativos da semana e do mês somam `newInWeek` e `newInMonth`, nunca `actives.day`.
- **Cores.** Lima só para pontos (o tom `points` do `MetricCard` e dos gráficos); ciano para estados bons e destaques; rosa só em botões e foco. Selos de situação pelo `StatusChip`, nunca em lima.
- **Ações.** O erro aparece dentro do diálogo com a frase do servidor; a falha sem motivo (`mayHaveRunOnServer`) diz "Não deu para confirmar se a mudança foi gravada" (`actionErrorMessage`) e a tela lê de novo.
- **Configuração versionada.** Régua, missões, conquistas e temporada levam o `version` lido como `expectedVersion`. O `config-changed` mostra "A configuração mudou enquanto você editava. Recarregue os dados, confira e salve de novo." com "Recarregar dados", que lê o documento de novo e refaz o formulário. Ações em sequência (ordem, "Arquivar encerradas") encadeiam a versão de cada resposta.
- **Ids do painel.** `createReward`, `createPost` e `createEvent` recebem o id gerado no navegador (`doc(collection(...)).id`): a nova tentativa depois de uma resposta perdida não cria outro rascunho. A criação em passos (criar, enviar a mídia, gravar, publicar) retoma do passo que falhou. O `createMission` sem resposta é conferido em `config/missions/versions/{n}`.
- **Lotes.** "Arquivar encerradas", "Recusar pedidos abertos" e "Ocultar todos os comentários" rodam uma chamada por vez, com o progresso, o botão de parar e o resumo (`batch.ts`, `BatchProgress`).
- **Dados de fã.** Os contatos de um pedido (`getRedemptionContacts`) vivem só no diálogo: fechou, saem da memória. Quem denunciou um comentário nunca aparece.

### O que cada tela faz

- **Visão geral** (`/`): os cartões do período (7, 30 ou 90 dias) contra o período anterior, os gráficos por dia e as listas do topo.
- **Crescimento** (`/crescimento`): cadastros e origem, ativos e retenção, e o Comparativo de centrais, campanhas e períodos.
- **Ranking e temporadas** (`/ranking`): a temporada atual e a próxima, o ranking ao vivo (`getPanelRanking`), as passadas com o pódio, encerrar e rodar a virada.
- **Fãs** (`/fas` e `/fas/[uid]`): lista, busca por nome, @, código, uid e e-mail; a ficha com extrato, centrais, curtidas, presenças, comentários, convites e resgates; o ajuste de pontos.
- **Missões e régua** (`/missoes`): missões com a meta da temporada, filtros, alvo pela central, publicar, encerrar, arquivar e trazer de volta; conquistas; a régua em três blocos com "Salvar" próprio.
- **Recompensas e resgates** (`/recompensas`): pedidos por situação com a busca pelo código e os contatos; o catálogo com foto, estoque e ordem; os números do período.
- **Moderação** (`/moderacao` e `/moderacao/fas/[uid]`): a fila, os resolvidos, os ocultos e os suspensos; na página do fã, suspender, ocultar em lote, trocar o @ e tirar a foto.
- **Logs e auditoria** (`/logs`): as entradas com os filtros por período, seção, pessoa, ação e alvo, e os detalhes de cada uma.
- **Artistas** (`/artistas`, `/artistas/mural`, `/artistas/agenda`): as centrais; o mural com a mídia e os comentários; a agenda com o fuso de cada show.

## Artistas e centrais

Artista e central são a mesma coisa: o @ é o id de `artists/{id}` e vira o link da central no app. Não existe conta de artista: o selo verificado é só uma marca. O contrato completo mora no `imagineup-app`.

Cada central tem dois documentos com o mesmo id. `artists/{id}` é o que o app mostra (nome, @, gênero, cidade, bio, selo, fotos, ordem, status, fãs e datas), e os fãs logados leem o documento inteiro. `artistPrivate/{id}` guarda o que só a equipe vê: gestor, autorização de uso de imagem, e-mail e celular de contato, e quem criou e editou. O painel escuta os dois em tempo real e junta pelo id.

- **Quem mexe.** Admin e Editor com a seção Artistas criam, editam, publicam, tiram do ar e reordenam. Leitor só vê: o botão "Ver" abre os dois documentos da central só para leitura, gestor, autorização e contato incluídos. Apagar é só de admin.
- **Tela.** Contagem no cabeçalho, cartões "Centrais no ar" e "Aguardando publicação", a lista de rascunhos (com o que falta para publicar) e todas as centrais na ordem de destaque, em tempo real (`onSnapshot` de `artists` e de `artistPrivate`, juntos pelo id e ordenados no painel). A lista aparece assim que as centrais chegam; enquanto o privado de uma central não chega, a coluna "Gestor" mostra "Carregando..." e a autorização conta como não recebida. Se uma das duas escutas falhar, as duas param e a tela mostra o erro com "Tentar de novo". Os 4 primeiros no ar são os destaques da escolha de artistas no app.
- **Ordem.** Subir e Descer mudam a lista na hora, anunciam a nova posição para leitor de tela e, 0,6 s depois do último clique, mandam a lista inteira para `reorderArtists`. Os envios vão um de cada vez e só o mais novo espera (`latest-sender.ts`), então um pedido antigo atrasado nunca chega depois do novo; sair da página durante a espera manda a ordem na hora. Se o servidor recusar, a ordem volta.
- **Criar.** O @ segue a regra do servidor: `^[a-z0-9_]{3,30}$`, fora do formato `__.*__` (ids que o Firestore reserva) e fora dos reservados. Ele é sugerido pelo nome (sem acento, só a-z e 0-9) até ser editado à mão; sugerido ou digitado, passa pela mesma regra no painel e só então é conferido com `checkArtistHandle` 400 ms depois de parar de digitar. Os @ dos fãs e das centrais são um espaço só (`usernames/`). Salvar faz, em ordem: `createArtist` (rascunho, sem foto), envio das duas imagens para `artists/{id}/`, `updateArtist` com os caminhos e, se pedido, `setArtistStatus`. Se um passo falha, a central fica como rascunho, a mensagem diz o que faltou e a nova tentativa continua dali. Se a resposta do `createArtist` se perde (rede, servidor demorando), o @ fica travado e a nova tentativa que voltar com "@ em uso" lê `artists/{@}` e `artistPrivate/{@}`: rascunho criado pela mesma pessoa (`createdBy` do privado) é retomado, em vez de pedir outro @ e deixar uma central perdida.
- **Foto.** O navegador abre a foto (`createImageBitmap`, já girada pelo EXIF), recorta o centro em 3:4 e gera 1200x1600 e 480x640 em WebP (JPEG se o navegador não souber WebP). HEIC é recusado com mensagem; abaixo de 600x800 aparece o aviso de foto pequena. Cada envio tem nome novo, cache de um ano e largura e altura no metadado; ao gravar a foto nova (ou tirar a foto), o servidor apaga os outros arquivos da pasta. As imagens aparecem com `next/image` `unoptimized`, sem a otimização da Vercel.
- **Publicar.** Precisa de foto e da autorização de uso de imagem marcada (lida do privado). Sem o privado carregado, publicar nunca é liberado. Tirar do ar não apaga nada. Clicar em "Publicar" com algo faltando mostra o motivo na linha.
- **Apagar.** Só admin vê a lixeira, em todas as linhas de "Rascunhos" e de "Todas as centrais", e ela vale para central em qualquer status. A confirmação é vermelha, e a de central no ar avisa que ela sai do app na hora. O servidor apaga os dois documentos, a reserva do @ e todos os arquivos de `artists/{id}/`. Central com fãs (`fanCount > 0`) não é apagada: a lixeira fica com `aria-disabled` e o clique mostra na linha "Essa central tem fãs. Tire do ar em vez de apagar.", a mesma regra do servidor (`has-fans`). Depois de apagar, o aviso vai para o topo da lista e o foco para o título dela.
- **Avisos.** O resultado de cada ação aparece onde ela aconteceu: na linha da central, no topo da lista (quando a linha saiu dela) ou no topo da página (criar). O leitor de tela ouve pelas regiões vivas do topo da página.
- **Edição.** Só o que mudou vai para o `updateArtist`, que grava cada campo no documento certo. Gestor, autorização e contato vêm do privado que a lista já trouxe; se ele ainda não chegou, é lido uma vez ao abrir, e até lá esses campos ficam travados. Se a leitura falhar, salvar não mexe neles e "Salvar e publicar" não publica. O gestor vem da equipe ativa para admin; para editor, as regras não deixam listar `staff`, então aparecem só a própria pessoa e o gestor atual.

## Publicação (Vercel)

- Projeto próprio na Vercel da cliente, importado deste repositório (público, para os commits de colaboradores publicarem no plano Hobby), com o preset Next.js e sem Root Directory. O site estático é outro projeto, ligado ao `imagineup-LP`.
- Cadastre as variáveis `NEXT_PUBLIC_FIREBASE_*` (sem a do emulador).
- Depois de ter o endereço de produção, ele precisa entrar no `PANEL_ORIGINS` (CORS das funções) e no parâmetro `PANEL_URL` (link do convite) no `imagineup-app`, e as funções precisam ser publicadas de novo.
- O painel sai com `noindex` (metadados, cabeçalho `X-Robots-Tag` e `robots.txt`) e não pode ser aberto dentro de iframe de outro site.
