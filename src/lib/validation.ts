/**
 * Validação dos formulários do painel, com as mesmas regras que as Cloud
 * Functions aplicam (contrato da equipe). Aqui é só conforto: o servidor
 * valida de novo e é ele quem decide.
 */

import { ROLE_IDS, SECTION_IDS, orderSections, type Role, type SectionId } from "@/lib/staff";
import { cleanLine, isVisibleLine } from "@/lib/visible-line";

export const NAME_MAX_LENGTH = 60;
export const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Formato básico: algo@algo.dominio, sem espaço, até 254 caracteres. */
export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

export function emailError(email: string): string | null {
  if (!email.trim()) return "Digite o e-mail.";
  if (!isValidEmail(email)) return "Confira o e-mail. Ele precisa ter o formato nome@dominio.com.";
  return null;
}

/** Nome como vai para o servidor: sem isolantes bidi, em NFC e sem espaço nas pontas. */
export function cleanName(name: string): string {
  return cleanLine(name);
}

/** Nome obrigatório (aceite do convite) ou opcional (sugestão no convite). */
export function nameError(name: string, { required }: { required: boolean }): string | null {
  const value = cleanName(name);
  if (!value) return required ? "Digite o nome." : null;
  if (value.length > NAME_MAX_LENGTH) return `Use até ${NAME_MAX_LENGTH} caracteres.`;
  if (!isVisibleLine(value)) return "Use só letras, números e símbolos visíveis, numa linha.";
  return null;
}

export function newPasswordError(password: string): string | null {
  if (!password) return "Crie uma senha.";
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  return null;
}

export function confirmPasswordError(password: string, confirmation: string): string | null {
  if (!confirmation) return "Repita a senha.";
  if (password !== confirmation) return "As senhas não são iguais.";
  return null;
}

export function currentPasswordError(password: string): string | null {
  return password ? null : "Digite a senha.";
}

/** Seções como o servidor espera: admin leva todas; os outros, as marcadas, na ordem da lateral. */
export function normalizeSections(role: Role, sections: readonly SectionId[]): SectionId[] {
  return role === "admin" ? [...SECTION_IDS] : orderSections(sections);
}

export function sectionsError(role: Role, sections: readonly SectionId[]): string | null {
  if (!ROLE_IDS.includes(role)) return "Escolha o nível de acesso.";
  if (role !== "admin" && normalizeSections(role, sections).length === 0) return "Marque pelo menos uma seção.";
  return null;
}

export interface InviteForm {
  name: string;
  email: string;
  role: Role;
  sections: SectionId[];
}

export type InviteFormErrors = Partial<Record<"name" | "email" | "sections", string>>;

export function validateInviteForm(form: InviteForm): InviteFormErrors {
  const errors: InviteFormErrors = {};
  const name = nameError(form.name, { required: false });
  const email = emailError(form.email);
  const sections = sectionsError(form.role, form.sections);
  if (name) errors.name = name;
  if (email) errors.email = email;
  if (sections) errors.sections = sections;
  return errors;
}

export interface AcceptForm {
  name: string;
  password: string;
  confirmation: string;
}

export type AcceptFormErrors = Partial<Record<"name" | "password" | "confirmation", string>>;

/** Conta nova: nome, senha de 8+ e confirmação igual. */
export function validateNewAccountForm(form: AcceptForm): AcceptFormErrors {
  const errors: AcceptFormErrors = {};
  const name = nameError(form.name, { required: true });
  const password = newPasswordError(form.password);
  const confirmation = password ? null : confirmPasswordError(form.password, form.confirmation);
  if (name) errors.name = name;
  if (password) errors.password = password;
  if (confirmation) errors.confirmation = confirmation;
  return errors;
}

/** Conta que já existe no app: nome e a senha atual dessa conta. */
export function validateExistingAccountForm(form: Pick<AcceptForm, "name" | "password">): AcceptFormErrors {
  const errors: AcceptFormErrors = {};
  const name = nameError(form.name, { required: true });
  const password = currentPasswordError(form.password);
  if (name) errors.name = name;
  if (password) errors.password = password;
  return errors;
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
