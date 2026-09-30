/**
 * Mensagens de erro em português. Puro de propósito (sem importar o Firebase):
 * os erros chegam como objetos com `code`, `message` e `details`, e os testes
 * rodam direto no Node.
 *
 * Os códigos têm prefixo: `auth/...` do Authentication, `functions/...` das
 * Cloud Functions, `storage/...` do Storage e códigos sem prefixo
 * (`permission-denied`) do Firestore.
 * Só passe `auth/` para o mapa de Auth: o `FirestoreError` também tem `code`.
 */

export interface ErrorInfo {
  code: string;
  /** `details.reason` das Cloud Functions (contrato da equipe). */
  reason: string | null;
  message: string;
}

export function readError(error: unknown): ErrorInfo {
  if (!error || typeof error !== "object") {
    return { code: "", reason: null, message: typeof error === "string" ? error : "" };
  }
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  const details = record.details;
  const reason =
    details && typeof details === "object" && typeof (details as { reason?: unknown }).reason === "string"
      ? (details as { reason: string }).reason
      : null;
  return {
    code: typeof record.code === "string" ? record.code : "",
    reason,
    message: typeof record.message === "string" ? record.message : "",
  };
}

const GENERIC = "Não foi possível concluir. Tente de novo.";
const NETWORK = "Sem conexão. Verifique a internet e tente de novo.";

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "E-mail inválido.",
  "auth/missing-email": "Digite o e-mail.",
  "auth/missing-password": "Digite a senha.",
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/invalid-login-credentials": "E-mail ou senha incorretos.",
  "auth/user-disabled": "Esta conta foi desativada. Fale com a equipe da Imagine.",
  "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
  "auth/network-request-failed": NETWORK,
  "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.",
  "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
  "auth/operation-not-allowed": "O login por e-mail e senha não está ligado neste projeto do Firebase.",
  "auth/internal-error": GENERIC,
};

/** Mensagem para um código `auth/...`. Qualquer outro vira a mensagem genérica. */
export function authErrorMessage(code: string): string {
  return AUTH_MESSAGES[code] ?? GENERIC;
}

/** Motivos (`details.reason`) que as Cloud Functions da equipe e dos artistas devolvem. */
export const REASON_MESSAGES: Record<string, string> = {
  "not-admin": "Só um admin ativo pode fazer isso.",
  "already-staff": "Essa pessoa já faz parte da equipe.",
  "member-disabled": "Essa pessoa está desativada. Reative o acesso em Equipe.",
  self: "Você não pode fazer isso na sua própria conta.",
  "last-admin": "O painel precisa de pelo menos um admin ativo.",
  "not-pending": "Este convite não está mais pendente.",
  invalid: "Convite inválido.",
  expired: "Este convite venceu. Peça um novo ao admin que te convidou.",
  accepted: "Este convite já foi usado. Entre com seu e-mail e senha.",
  canceled: "Este convite foi cancelado. Peça um novo ao admin que te convidou.",
  "account-exists": "Esse e-mail já tem uma conta no app ImagineUP. Entre com a senha dessa conta para liberar o painel.",
  "email-mismatch": "Você entrou com outra conta. Entre com o e-mail que recebeu o convite.",
  // Artistas e centrais
  "invalid-handle": "Confira o @: use de 3 a 30 letras minúsculas, números ou _, sem começar e terminar com __.",
  "handle-taken": "Esse @ já está em uso. Escolha outro.",
  "handle-reserved": "Esse @ é reservado. Escolha outro.",
  "invalid-manager": "O gestor escolhido não está ativo na equipe. Escolha outra pessoa.",
  "published-needs-photo": "Uma central no ar precisa de foto. Troque a foto em vez de tirar, ou tire a central do ar antes.",
  "published-needs-image-rights": "Uma central no ar precisa da autorização de uso de imagem. Tire a central do ar antes de desmarcar.",
  "missing-photo": "Para publicar, falta a foto da central.",
  "missing-image-rights": "Para publicar, falta marcar a autorização de uso de imagem.",
  "unknown-artist": "A lista de centrais mudou enquanto você mexia. Confira a ordem e tente de novo.",
  "has-fans": "Essa central tem fãs. Tire do ar em vez de apagar.",
};

const STORAGE_MESSAGES: Record<string, string> = {
  "storage/unauthenticated": "Sua sessão terminou. Entre de novo.",
  "storage/unauthorized": "O envio da foto foi recusado. Confira se você pode editar artistas e se a foto é JPG, PNG ou WebP de até 5 MB.",
  "storage/retry-limit-exceeded": "A conexão caiu durante o envio da foto. Tente de novo.",
  "storage/canceled": "O envio da foto foi cancelado.",
  "storage/quota-exceeded": "O espaço de fotos do projeto acabou. Avise quem cuida do Firebase.",
  "storage/no-default-bucket": "O armazenamento de fotos não está configurado no painel.",
  "storage/bucket-not-found": "O armazenamento de fotos não está configurado no painel.",
  "storage/project-not-found": "O armazenamento de fotos não está configurado no painel.",
  "storage/server-file-wrong-size": "A foto chegou incompleta. Tente de novo.",
};

/** Erro do envio de fotos para o Storage (`storage/...`). */
export function storageErrorMessage(error: unknown): string {
  const { code } = readError(error);
  return STORAGE_MESSAGES[code] ?? "Não foi possível enviar a foto. Tente de novo.";
}

const FUNCTIONS_CODE_MESSAGES: Record<string, string> = {
  "functions/unauthenticated": "Sua sessão terminou. Entre de novo.",
  "functions/permission-denied": "Você não tem permissão para isso.",
  "functions/invalid-argument": "Confira os dados e tente de novo.",
  "functions/not-found": "Não encontramos o que você pediu.",
  "functions/already-exists": "Isso já existe.",
  "functions/failed-precondition": "Não dá para fazer isso agora. Atualize a página e confira.",
  "functions/resource-exhausted": "Muitas tentativas. Espere um pouco e tente de novo.",
  "functions/deadline-exceeded": "O servidor demorou para responder. Tente de novo.",
  "functions/unavailable": "O servidor não respondeu. Tente de novo em instantes.",
  "functions/internal": "Não foi possível falar com o servidor. Tente de novo em instantes.",
  "functions/unknown": GENERIC,
};

/**
 * Mensagem que veio do servidor, se for mesmo uma frase dele.
 *
 * O SDK 12 põe o status HTTP no fim de toda mensagem ("Texto do servidor.
 * [400]"), então ele sai daqui. Quando a função lança um erro sem
 * `HttpsError`, a rede cai ou a função nem existe, o SDK preenche a mensagem
 * com o próprio código ("internal [0]", "INTERNAL [500]", "Backend error
 * status: NOT_FOUND [404]"): isso não serve para a tela.
 */
export function serverMessageOf(info: ErrorInfo): string | null {
  const message = info.message.replace(/\s*\[\d{1,3}\]\s*$/, "").trim();
  if (!message) return null;
  if (/^(unknown )?backend error status:/i.test(message)) return null;
  if (/^firebase:/i.test(message)) return null;
  const bareCode = info.code.replace(/^functions\//, "");
  const normalized = message.toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === bareCode || normalized === "internal" || normalized === "unknown") return null;
  return message;
}

/**
 * Erro de uma Cloud Function da equipe: a frase do servidor quando existir,
 * senão o motivo mapeado, senão a mensagem do código.
 */
export function callableErrorMessage(error: unknown): string {
  const info = readError(error);
  if (info.code.startsWith("auth/")) return authErrorMessage(info.code);
  if (info.code.startsWith("functions/")) {
    const fromServer = serverMessageOf(info);
    if (fromServer) return fromServer;
  }
  if (info.reason && REASON_MESSAGES[info.reason]) return REASON_MESSAGES[info.reason];
  return FUNCTIONS_CODE_MESSAGES[info.code] ?? GENERIC;
}

/**
 * Falhas de uma Cloud Function sem motivo do servidor que podem ter acontecido
 * depois de a gravação dar certo: a conexão caiu, o servidor demorou ou a
 * resposta se perdeu. Nesses casos não dá para saber se o pedido foi gravado.
 * Com `details.reason`, o servidor recusou de propósito e nada foi gravado.
 */
const UNCERTAIN_CODES = new Set(["", "functions/internal", "functions/unavailable", "functions/deadline-exceeded", "functions/unknown"]);

export function mayHaveRunOnServer(error: unknown): boolean {
  const { code, reason } = readError(error);
  return !reason && UNCERTAIN_CODES.has(code);
}

/** Erro de leitura do Firestore (listas em tempo real). */
export function firestoreErrorMessage(error: unknown): string {
  const { code } = readError(error);
  if (code === "permission-denied") return "Você não tem permissão para ver isto.";
  if (code === "unavailable") return NETWORK;
  return "Não foi possível carregar os dados. Tente de novo.";
}

/** Qualquer erro: escolhe o mapa pelo prefixo do código. */
export function errorMessage(error: unknown): string {
  const { code } = readError(error);
  if (code.startsWith("auth/")) return authErrorMessage(code);
  if (code.startsWith("functions/")) return callableErrorMessage(error);
  if (code.startsWith("storage/")) return storageErrorMessage(error);
  if (code) return firestoreErrorMessage(error);
  return GENERIC;
}
