/**
 * O WhatsApp do fã nos pedidos da loja (seção 35 da nota do app,
 * `docs/arquitetura-api.md`) e na ficha da candidatura a fã-clube (seção 34).
 * O número chega do `getRedemptionContacts` ou do contato do fã no formato
 * guardado, o celular brasileiro em E.164 (`+5575991234567`), e o painel
 * confere de novo antes de mostrar e de montar o link, como as redes do
 * perfil: fora do formato, não aparece. O link abre a conversa no WhatsApp
 * (`https://wa.me/<dígitos>`) com uma mensagem pronta, que a pessoa da equipe
 * pode mudar antes de mandar. Nada aqui guarda o número.
 */

/** Os DDDs do Brasil (o plano de numeração da Anatel), os mesmos do servidor. */
const BRAZIL_DDDS: ReadonlySet<string> = new Set([
  ...["11", "12", "13", "14", "15", "16", "17", "18", "19"],
  ...["21", "22", "24", "27", "28"],
  ...["31", "32", "33", "34", "35", "37", "38"],
  ...["41", "42", "43", "44", "45", "46", "47", "48", "49"],
  ...["51", "53", "54", "55"],
  ...["61", "62", "63", "64", "65", "66", "67", "68", "69"],
  ...["71", "73", "74", "75", "77", "79"],
  ...["81", "82", "83", "84", "85", "86", "87", "88", "89"],
  ...["91", "92", "93", "94", "95", "96", "97", "98", "99"],
]);

/** O número guardado: `+55`, o DDD e o celular de 9 dígitos começando por 9. */
const STORED_WHATSAPP = /^\+55(\d{2})(9\d{4})(\d{4})$/;

/** O valor está no formato guardado, com um DDD que existe. */
export function isWhatsapp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = STORED_WHATSAPP.exec(value);
  return match !== null && BRAZIL_DDDS.has(match[1]!);
}

/** O número como a equipe lê: "+55 (75) 99123-4567"; fora do formato, `null`. */
export function formatWhatsapp(value: unknown): string | null {
  if (!isWhatsapp(value)) return null;
  const [, ddd, start, end] = STORED_WHATSAPP.exec(value)!;
  return `+55 (${ddd}) ${start}-${end}`;
}

/** A mensagem pronta da conversa, com o código do pedido. */
export function whatsappMessage(code: string): string {
  return `Olá! Aqui é a equipe do ImagineUP, sobre o seu resgate ${code}.`;
}

/** A mensagem pronta da conversa com o candidato a fã-clube (seção 34 da nota do app), com o nome proposto. */
export function fanClubWhatsappMessage(clubName: string): string {
  return `Olá! Aqui é a equipe do ImagineUP, sobre a sua candidatura ao fã-clube ${clubName}.`;
}

/**
 * O link que abre a conversa (`https://wa.me/5575991234567?text=...`) com uma
 * mensagem pronta, com o domínio fixo e o número conferido de novo; fora do
 * formato, `null`.
 */
export function whatsappChatLink(value: unknown, message: string): string | null {
  if (!isWhatsapp(value)) return null;
  return `https://wa.me/${value.slice(1)}?text=${encodeURIComponent(message)}`;
}

/** O link da conversa sobre um pedido da loja, com o código dele. */
export function whatsappLink(value: unknown, code: string): string | null {
  return whatsappChatLink(value, whatsappMessage(code));
}
