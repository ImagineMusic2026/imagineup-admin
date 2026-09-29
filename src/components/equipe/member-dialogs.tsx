"use client";

import { useRef, useState } from "react";

import { RolePicker, SectionsPicker } from "@/components/equipe/access-fields";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { callableErrorMessage } from "@/lib/errors";
import { SECTION_IDS, type Role, type SectionId, type StaffMember } from "@/lib/staff";
import { updateStaffMember } from "@/lib/staff-api";
import { normalizeSections, sectionsError } from "@/lib/validation";

function sameSections(a: readonly SectionId[], b: readonly SectionId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Trocar nível e seções de alguém da equipe. */
export function EditMemberDialog({
  member,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = member ? member.displayName || member.email : "";

  function close() {
    setBusy(false);
    onClose();
  }

  return (
    <Dialog
      open={Boolean(member)}
      onClose={close}
      busy={busy}
      size="lg"
      title="Alterar nível e seções"
      description={member ? `${name} · ${member.email}` : undefined}
    >
      {member ? (
        <EditMemberForm
          member={member}
          onBusyChange={setBusy}
          onCancel={close}
          onSaved={() => onSaved(`Acesso de ${name} atualizado.`)}
        />
      ) : null}
    </Dialog>
  );
}

function EditMemberForm({
  member,
  onBusyChange,
  onCancel,
  onSaved,
}: {
  member: StaffMember;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const mounted = useMountedRef();
  const firstSectionRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<Role>(member.role);
  const [sections, setSections] = useState<SectionId[]>(member.role === "admin" ? [...SECTION_IDS] : member.sections);
  const [sectionsProblem, setSectionsProblem] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const problem = sectionsError(role, sections);
    setSectionsProblem(problem);
    if (problem) {
      firstSectionRef.current?.focus();
      return;
    }
    const nextSections = normalizeSections(role, sections);
    const currentSections = normalizeSections(member.role, member.sections);
    if (role === member.role && sameSections(nextSections, currentSections)) {
      onCancel();
      return;
    }
    setBusy(true);
    onBusyChange(true);
    try {
      await updateStaffMember({ uid: member.uid, role, sections: nextSections });
    } catch (failure) {
      if (!mounted.current) return;
      setFormError(callableErrorMessage(failure));
      setBusy(false);
      onBusyChange(false);
      return;
    }
    // Diálogo fechado no meio do pedido: a resposta não fecha outro que já esteja aberto.
    if (!mounted.current) return;
    onBusyChange(false);
    onSaved();
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-5">
      <RolePicker value={role} onChange={setRole} disabled={busy} />
      <SectionsPicker
        role={role}
        value={sections}
        onChange={(next) => {
          setSections(next);
          if (sectionsProblem && next.length > 0) setSectionsProblem(null);
        }}
        error={sectionsProblem}
        disabled={busy}
        firstCheckboxRef={firstSectionRef}
      />
      <p className="m-0 text-[13px] leading-relaxed text-fg/65">
        A mudança vale na hora: a lateral da pessoa se atualiza sozinha.
      </p>
      {formError ? <Notice tone="error">{formError}</Notice> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

export interface ConfirmRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  tone: "default" | "danger";
  action: () => Promise<unknown>;
  successMessage: string;
}

/**
 * Confirmação com o pedido dentro: o erro aparece no próprio diálogo e o
 * foco começa no botão de voltar, que é a escolha segura.
 */
export function ConfirmDialog({
  request,
  onClose,
  onDone,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cada fechamento abre uma rodada nova: a resposta de um pedido de uma rodada
  // anterior não fecha nem muda a confirmação que estiver aberta agora.
  const round = useRef(0);

  function close() {
    round.current += 1;
    setError(null);
    setBusy(false);
    onClose();
  }

  async function confirm() {
    if (!request || busy) return;
    const mine = round.current;
    setError(null);
    setBusy(true);
    try {
      await request.action();
    } catch (failure) {
      if (round.current !== mine) return;
      setError(callableErrorMessage(failure));
      setBusy(false);
      return;
    }
    if (round.current !== mine) return;
    round.current += 1;
    setBusy(false);
    onDone(request.successMessage);
  }

  return (
    <Dialog
      open={Boolean(request)}
      onClose={close}
      busy={busy}
      size="sm"
      tone={request?.tone ?? "default"}
      title={request?.title ?? ""}
      description={request?.body}
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={busy} data-autofocus>
            {request?.cancelLabel ?? "Voltar"}
          </Button>
          <Button variant={request?.tone === "danger" ? "danger" : "primary"} onClick={confirm} busy={busy}>
            {busy ? request?.busyLabel : request?.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
