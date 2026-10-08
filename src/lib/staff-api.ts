import { call } from "@/lib/callable";
import type { EmailStatus, Role, SectionId } from "@/lib/staff";

/**
 * Chamadas às Cloud Functions da equipe, com os formatos do contrato. Quem
 * valida papel, seções e convite é o servidor; o `call` (callable.ts) cuida
 * do resto.
 */

export interface InviteLinkResult {
  inviteId: string;
  inviteUrl: string;
  /** ISO 8601. */
  expiresAt: string;
  emailStatus: EmailStatus;
}

export interface CreateStaffInviteInput {
  email: string;
  suggestedName?: string;
  role: Role;
  sections: SectionId[];
}

export function createStaffInvite(input: CreateStaffInviteInput): Promise<InviteLinkResult> {
  return call<CreateStaffInviteInput, InviteLinkResult>("createStaffInvite", input);
}

export function resendStaffInvite(inviteId: string): Promise<InviteLinkResult> {
  return call<{ inviteId: string }, InviteLinkResult>("resendStaffInvite", { inviteId });
}

export function cancelStaffInvite(inviteId: string): Promise<{ ok: true }> {
  return call<{ inviteId: string }, { ok: true }>("cancelStaffInvite", { inviteId });
}

export interface StaffInvitePreview {
  email: string;
  suggestedName: string | null;
  role: Role;
  sections: SectionId[];
  /** ISO 8601. */
  expiresAt: string;
  invitedByName: string;
  accountExists: boolean;
}

/** Pública: abre o convite pelo id e pelo token do link. */
export function getStaffInvite(inviteId: string, token: string): Promise<StaffInvitePreview> {
  return call<{ inviteId: string; token: string }, StaffInvitePreview>("getStaffInvite", { inviteId, token });
}

export interface AcceptStaffInviteInput {
  inviteId: string;
  token: string;
  displayName: string;
  password: string;
}

/** Conta nova, sem login. Depois dela, o cliente entra com e-mail e senha. */
export function acceptStaffInvite(input: AcceptStaffInviteInput): Promise<{ uid: string; email: string }> {
  return call<AcceptStaffInviteInput, { uid: string; email: string }>("acceptStaffInvite", input);
}

export interface LinkStaffInviteInput {
  inviteId: string;
  token: string;
  displayName: string;
}

/** Conta que já existe no app: exige estar logado com o e-mail do convite. */
export function linkStaffInvite(input: LinkStaffInviteInput): Promise<{ uid: string }> {
  return call<LinkStaffInviteInput, { uid: string }>("linkStaffInvite", input);
}

export interface UpdateStaffMemberInput {
  uid: string;
  role?: Role;
  sections?: SectionId[];
}

export function updateStaffMember(input: UpdateStaffMemberInput): Promise<{ ok: true }> {
  return call<UpdateStaffMemberInput, { ok: true }>("updateStaffMember", input);
}

export function setStaffMemberActive(uid: string, active: boolean): Promise<{ ok: true }> {
  return call<{ uid: string; active: boolean }, { ok: true }>("setStaffMemberActive", { uid, active });
}

export function removeStaffMember(uid: string): Promise<{ ok: true }> {
  return call<{ uid: string }, { ok: true }>("removeStaffMember", { uid });
}
