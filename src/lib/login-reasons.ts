/**
 * Motivo de a pessoa ter voltado para o login, levado no endereço
 * (`/entrar?motivo=...`) e não em armazenamento do navegador.
 */
export type ExitReason = "sem-acesso" | "desativado";

export const EXIT_REASON_MESSAGES: Record<ExitReason, string> = {
  "sem-acesso": "Esta conta não tem acesso ao painel.",
  desativado: "Seu acesso ao painel foi desativado. Fale com um admin.",
};

export function parseExitReason(value: string | null | undefined): ExitReason | null {
  return value === "sem-acesso" || value === "desativado" ? value : null;
}

export function loginUrl(reason: ExitReason | null): string {
  return reason ? `/entrar?motivo=${reason}` : "/entrar";
}
