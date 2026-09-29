"use client";

import { useRef, useState } from "react";

import { RolePicker, SectionsPicker } from "@/components/equipe/access-fields";
import { InviteResult } from "@/components/equipe/invite-result";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { callableErrorMessage } from "@/lib/errors";
import { SECTION_IDS, type Role, type SectionId } from "@/lib/staff";
import { createStaffInvite, type InviteLinkResult } from "@/lib/staff-api";
import { cleanName, hasErrors, normalizeEmail, normalizeSections, validateInviteForm, type InviteFormErrors } from "@/lib/validation";

/** "Convidar pessoa": nome sugerido, e-mail, nível e seções; depois, o link. */
export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; result: InviteLinkResult } | null>(null);

  function close() {
    setDone(null);
    setBusy(false);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      busy={busy}
      size="lg"
      title={done ? "Convite criado" : "Convidar pessoa"}
      description={
        done ? undefined : "A pessoa recebe um link por e-mail, cria a senha (ou usa a conta que já tem no app) e entra no painel."
      }
    >
      {done ? (
        <InviteResult email={done.email} result={done.result} resent={false} onDone={close} />
      ) : (
        <InviteForm onBusyChange={setBusy} onCreated={setDone} onCancel={close} />
      )}
    </Dialog>
  );
}

function InviteForm({
  onBusyChange,
  onCreated,
  onCancel,
}: {
  onBusyChange: (busy: boolean) => void;
  onCreated: (done: { email: string; result: InviteLinkResult }) => void;
  onCancel: () => void;
}) {
  const mounted = useMountedRef();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstSectionRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [sections, setSections] = useState<SectionId[]>([...SECTION_IDS]);
  const [errors, setErrors] = useState<InviteFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setBusyBoth(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const found = validateInviteForm({ name, email, role, sections });
    setErrors(found);
    if (hasErrors(found)) {
      if (found.name) nameRef.current?.focus();
      else if (found.email) emailRef.current?.focus();
      else if (found.sections) firstSectionRef.current?.focus();
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    const suggestedName = cleanName(name);
    setBusyBoth(true);
    let result: InviteLinkResult;
    try {
      result = await createStaffInvite({
        email: normalizedEmail,
        ...(suggestedName ? { suggestedName } : {}),
        role,
        sections: normalizeSections(role, sections),
      });
    } catch (failure) {
      if (!mounted.current) return;
      setFormError(callableErrorMessage(failure));
      setBusyBoth(false);
      return;
    }
    // Diálogo fechado no meio do pedido: o convite existe e aparece na lista,
    // mas o resultado não pode abrir a próxima vez em "Convite criado".
    if (!mounted.current) return;
    setBusyBoth(false);
    onCreated({ email: normalizedEmail, result });
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" optional hint="Sugestão. A pessoa confirma ou muda ao aceitar." error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              ref={nameRef}
              id={id}
              name="name"
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              invalid={invalid}
              describedBy={describedBy}
            />
          )}
        </Field>
        <Field label="E-mail" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              ref={emailRef}
              id={id}
              type="email"
              name="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              invalid={invalid}
              describedBy={describedBy}
            />
          )}
        </Field>
      </div>

      <RolePicker value={role} onChange={setRole} disabled={busy} />

      <SectionsPicker
        role={role}
        value={sections}
        onChange={(next) => {
          setSections(next);
          if (errors.sections && next.length > 0) setErrors((current) => ({ ...current, sections: undefined }));
        }}
        error={errors.sections}
        disabled={busy}
        firstCheckboxRef={firstSectionRef}
      />

      {formError ? <Notice tone="error">{formError}</Notice> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? "Enviando convite..." : "Enviar convite"}
        </Button>
      </div>
    </form>
  );
}
