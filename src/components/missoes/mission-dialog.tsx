"use client";

import { useCallback, useState } from "react";

import { ConfigChangedNotice } from "@/components/missoes/game-bits";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SelectInput, Switch, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useMountedRef } from "@/components/ui/use-mounted-ref";
import { usePagedList } from "@/components/ui/use-paged-list";
import type { ArtistName } from "@/lib/artist-names-data";
import { REASON_MESSAGES, actionErrorMessage, errorDetails, isConfigChanged, mayHaveRunOnServer, reasonOf } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { createMission, updateMission } from "@/lib/game-api";
import { getMissionsCatalog, getMissionsVersion, getTargetEvents, getTargetPosts, targetKey, type TargetDoc, type TargetEvent, type TargetPost } from "@/lib/game-data";
import type { PageCursor } from "@/lib/firestore-page";
import {
  ACCEPTED_TARGETS,
  ACTION_LABELS,
  MISSION_ACTIONS,
  MISSION_GOAL_MAX,
  MISSION_REWARD_MAX,
  MISSION_TITLE_MAX,
  PERIOD_LABELS,
  TARGET_KIND_LABELS,
  createdMissionIn,
  emptyMissionForm,
  isMissionLocked,
  isSingleTarget,
  missionChanges,
  missionFieldOf,
  missionFormOf,
  validateMission,
  type Mission,
  type MissionAction,
  type MissionErrors,
  type MissionForm,
  type MissionPeriod,
  type TargetKind,
} from "@/lib/missions";

export interface MissionDialogRequest {
  /** A missão do catálogo, ou `null` para criar. */
  mission: Mission | null;
  version: number;
  /** Os ids do catálogo lido: a resposta perdida de um `createMission` procura uma missão fora deles. */
  catalogIds: string[];
}

const POST_TEXT_MAX = 70;

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "Saiu o clipe de Sonho de Amor… · 7 out". */
export function postLabel(post: Pick<TargetPost, "text" | "publishedAt" | "status">, now: Date): string {
  const text = clip(post.text, POST_TEXT_MAX) || "Post sem texto";
  const when = post.publishedAt ? ` · ${formatDay(post.publishedAt, now)}` : "";
  return `${text}${when}${post.status === "published" ? "" : " · fora do ar"}`;
}

/** "São João de Irará · 21 nov", com "fora do ar" no rascunho. */
export function eventLabel(event: Pick<TargetEvent, "title" | "startsAt" | "status">, now: Date): string {
  const when = event.startsAt ? ` · ${formatDay(event.startsAt, now)}` : "";
  return `${event.title}${when}${event.status === "published" ? "" : " · fora do ar"}`;
}

export function MissionDialog({
  request,
  uid,
  artists,
  targets,
  onClose,
  onSaved,
}: {
  request: MissionDialogRequest | null;
  uid: string;
  artists: ArtistName[];
  /** Os alvos já lidos da tabela (para mostrar o atual mesmo fora da página de opções). */
  targets: ReadonlyMap<string, TargetDoc | null> | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return request ? (
    <MissionDialogBody
      key={`${request.mission?.id ?? "nova"}:${request.version}`}
      request={request}
      uid={uid}
      artists={artists}
      targets={targets}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function MissionDialogBody({
  request,
  uid,
  artists,
  targets,
  onClose,
  onSaved,
}: {
  request: MissionDialogRequest;
  uid: string;
  artists: ArtistName[];
  targets: ReadonlyMap<string, TargetDoc | null> | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const mounted = useMountedRef();
  const [now, setNow] = useState(() => Date.now());
  const [mission, setMission] = useState<Mission | null>(request.mission);
  const [version, setVersion] = useState(request.version);
  const [form, setForm] = useState<MissionForm>(() => (request.mission ? missionFormOf(request.mission) : emptyMissionForm(now)));
  const [errors, setErrors] = useState<MissionErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const [reloadingData, setReloadingData] = useState(false);
  const [gone, setGone] = useState(false);
  const [knownIds, setKnownIds] = useState(request.catalogIds);

  const creating = !request.mission;
  const locked = mission ? isMissionLocked(mission, now) : false;
  const single = isSingleTarget(form.action, form.targetKind);
  const accepted = ACCEPTED_TARGETS[form.action];
  const blocked = busy || gone;
  const sortedArtists = [...artists].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  function set<K extends keyof MissionForm>(field: K, value: MissionForm[K]) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "action") {
        const kinds = ACCEPTED_TARGETS[value as MissionAction];
        if (!kinds.includes(next.targetKind)) next.targetKind = kinds[0];
      }
      if (field === "artistId") {
        next.postId = "";
        next.eventId = "";
      }
      if (field === "targetKind") {
        next.postId = "";
        next.eventId = "";
      }
      if (isSingleTarget(next.action, next.targetKind)) next.goal = "1";
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** "Recarregar dados": lê o catálogo de novo e refaz o formulário com ele. */
  async function reloadData() {
    setReloadingData(true);
    try {
      const catalog = await getMissionsCatalog();
      if (!mounted.current) return;
      setVersion(catalog.version);
      setKnownIds(catalog.missions.map((item) => item.id));
      setNow(Date.now());
      setChanged(false);
      setErrors({});
      if (request.mission) {
        const fresh = catalog.missions.find((item) => item.id === request.mission?.id) ?? null;
        if (!fresh) {
          setGone(true);
          setMessage({ tone: "error", text: "Esta missão saiu do catálogo enquanto você editava. Feche e confira a lista." });
          return;
        }
        setMission(fresh);
        setForm(missionFormOf(fresh));
      }
      setMessage({ tone: "info", text: "Dados recarregados. Confira e salve de novo." });
    } catch (failure) {
      if (mounted.current) setMessage({ tone: "error", text: actionErrorMessage(failure) });
    } finally {
      if (mounted.current) setReloadingData(false);
    }
  }

  /** Resposta perdida num `createMission`: a versão seguinte, gravada por você com o mesmo título, é a missão. */
  async function createdAnyway(title: string): Promise<boolean> {
    try {
      const next = await getMissionsVersion(version + 1);
      return createdMissionIn(next, uid, title, knownIds) !== null;
    } catch {
      return false;
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const checked = validateMission(form);
    setErrors(checked.errors);
    if (!checked.input) return;
    const input = checked.input;
    setMessage(null);
    setChanged(false);
    if (mission) {
      const changes = missionChanges(mission, input, locked);
      if (Object.keys(changes).length === 0) {
        setMessage({ tone: "info", text: "Nada mudou para salvar." });
        return;
      }
      setBusy(true);
      try {
        await updateMission({ expectedVersion: version, missionId: mission.id, changes });
        if (mounted.current) onSaved(`Missão ${input.title} salva.`);
      } catch (failure) {
        if (mounted.current) fail(failure);
      } finally {
        if (mounted.current) setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await createMission({ expectedVersion: version, mission: input });
      if (mounted.current) onSaved(`Missão ${input.title} criada como rascunho. Publique quando estiver pronta.`);
    } catch (failure) {
      if (!mounted.current) return;
      if (mayHaveRunOnServer(failure) && (await createdAnyway(input.title))) {
        if (mounted.current) onSaved("A missão foi criada.");
        return;
      }
      if (mounted.current) fail(failure);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function fail(failure: unknown) {
    if (isConfigChanged(failure)) {
      setChanged(true);
      return;
    }
    const field = reasonOf(failure) === "invalid-request" ? missionFieldOf(errorDetails(failure).field) : null;
    if (field) {
      setErrors((current) => ({ ...current, [field]: actionErrorMessage(failure) }));
      return;
    }
    setMessage({ tone: "error", text: actionErrorMessage(failure) });
  }

  const title = creating ? "Nova missão" : `Editar ${mission?.title ?? "missão"}`;
  const currentPost = mission?.target?.postId ? targets?.get(targetKey("post", mission.target.postId)) : null;
  const currentEvent = mission?.target?.eventId ? targets?.get(targetKey("event", mission.target.eventId)) : null;

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      busy={busy}
      size="lg"
      title={title}
      description={creating ? "Nasce como rascunho: o app só mostra depois de publicar. Datas e horas de São Paulo." : "Datas e horas de São Paulo."}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Título" error={errors.title} hint={`Até ${MISSION_TITLE_MAX} caracteres. É o que o fã lê no app.`}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} describedBy={describedBy} invalid={invalid} value={form.title} maxLength={MISSION_TITLE_MAX} disabled={blocked} onChange={(event) => set("title", event.target.value)} />
          )}
        </Field>

        {locked ? <Notice tone="info">{REASON_MESSAGES["mission-locked"]}</Notice> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" error={errors.action}>
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.action} disabled={blocked || locked} onChange={(event) => set("action", event.target.value as MissionAction)}>
                {MISSION_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {ACTION_LABELS[action]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Período" error={errors.period} hint="A meta recomeça a cada dia ou a cada semana.">
            {({ id, describedBy, invalid }) => (
              <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.period} disabled={blocked || locked} onChange={(event) => set("period", event.target.value as MissionPeriod)}>
                <option value="daily">{PERIOD_LABELS.daily}</option>
                <option value="weekly">{PERIOD_LABELS.weekly}</option>
              </SelectInput>
            )}
          </Field>
          <Field label="Alvo" error={errors.targetKind} hint={accepted.length === 1 ? "Este tipo só aceita este alvo." : undefined}>
            {({ id, describedBy, invalid }) => (
              <SelectInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={form.targetKind}
                disabled={blocked || locked || accepted.length === 1}
                onChange={(event) => set("targetKind", event.target.value as TargetKind)}
              >
                {accepted.map((kind) => (
                  <option key={kind} value={kind}>
                    {TARGET_KIND_LABELS[kind]}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          {form.targetKind !== "none" ? (
            <Field label="Central" error={errors.artistId} hint={form.targetKind === "artist" || locked ? undefined : "Escolha a central primeiro."}>
              {({ id, describedBy, invalid }) => (
                <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={form.artistId} disabled={blocked || locked} onChange={(event) => set("artistId", event.target.value)}>
                  <option value="">Escolha a central</option>
                  {sortedArtists.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name}
                      {artist.status === "published" ? "" : " · fora do ar"}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          ) : null}
        </div>

        {form.targetKind === "post" && form.artistId ? (
          <PostPicker
            key={form.artistId}
            artistId={form.artistId}
            value={form.postId}
            current={currentPost && currentPost.kind === "post" && currentPost.artistId === form.artistId ? currentPost : null}
            error={errors.postId}
            disabled={blocked || locked}
            now={now}
            onChange={(postId) => set("postId", postId)}
          />
        ) : null}
        {form.targetKind === "event" && form.artistId ? (
          <EventPicker
            key={form.artistId}
            artistId={form.artistId}
            value={form.eventId}
            current={currentEvent && currentEvent.kind === "event" ? currentEvent : null}
            error={errors.eventId}
            disabled={blocked || locked}
            now={now}
            onChange={(eventId) => set("eventId", eventId)}
          />
        ) : null}
        {form.targetKind === "event" && !form.artistId && errors.eventId ? <p className="m-0 text-[13px] font-medium text-danger">{errors.eventId}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meta" error={errors.goal} hint={single ? "Alvo único: a meta é 1." : `De 1 a ${MISSION_GOAL_MAX} vezes no período.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                type="number"
                min={1}
                max={MISSION_GOAL_MAX}
                value={single ? "1" : form.goal}
                readOnly={single}
                disabled={blocked || locked}
                onChange={(event) => set("goal", event.target.value)}
              />
            )}
          </Field>
          <Field label="Pontos" error={errors.rewardPoints} hint={`De 1 a ${MISSION_REWARD_MAX.toLocaleString("pt-BR")}, pagos a cada conclusão.`}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                type="number"
                min={1}
                max={MISSION_REWARD_MAX}
                value={form.rewardPoints}
                disabled={blocked}
                onChange={(event) => set("rewardPoints", event.target.value)}
              />
            )}
          </Field>
          <Field label="Início" error={errors.startsAt}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="datetime-local" value={form.startsAt} disabled={blocked || locked} onChange={(event) => set("startsAt", event.target.value)} />
            )}
          </Field>
          <Field label="Fim" optional error={errors.endsAt} hint="Vazio, a missão fica sem fim.">
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} describedBy={describedBy} invalid={invalid} type="datetime-local" value={form.endsAt} disabled={blocked} onChange={(event) => set("endsAt", event.target.value)} />
            )}
          </Field>
        </div>

        <Switch label="Destaque" description="A missão aparece com a estrela no app." checked={form.featured} disabled={blocked} onChange={(checked) => set("featured", checked)} />

        {changed ? <ConfigChangedNotice onReload={() => void reloadData()} busy={reloadingData} /> : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <p className="m-0 text-[12.5px] text-fg/60">A alteração fica registrada em Logs e auditoria com o seu nome.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={gone || changed}>
            {busy ? "Salvando..." : creating ? "Criar rascunho" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Os posts no ar da central, do mais novo, 20 por vez; o alvo de agora entra mesmo fora da lista. */
function PostPicker({
  artistId,
  value,
  current,
  error,
  disabled,
  now,
  onChange,
}: {
  artistId: string;
  value: string;
  current: TargetPost | null;
  error?: string;
  disabled: boolean;
  now: number;
  onChange: (postId: string) => void;
}) {
  const loadPage = useCallback((after: PageCursor | null) => getTargetPosts(artistId, after), [artistId]);
  const list = usePagedList(loadPage, (post: TargetPost) => post.id, { one: "post carregado", many: "posts carregados" });
  const items = list.state.status === "ready" ? list.state.data : [];
  const options = current && !items.some((post) => post.id === current.id) ? [current, ...items] : items;
  const date = new Date(now);
  return (
    <TargetSelect
      label="Post"
      emptyLabel="Escolha o post"
      value={value}
      error={error}
      disabled={disabled}
      state={list.state.status}
      loadError={list.state.status === "error" ? list.state.message : null}
      emptyText="Nenhum post no ar nesta central."
      options={options.map((post) => ({ value: post.id, label: postLabel(post, date) }))}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      loadMoreError={list.loadMoreError}
      announcement={list.announcement}
      moreLabel="Carregar mais posts"
      onLoadMore={list.loadMore}
      onRetry={list.reload}
      onChange={onChange}
    />
  );
}

/** Os shows da central de hoje em diante, 20 por vez, com "fora do ar" no rascunho. */
function EventPicker({
  artistId,
  value,
  current,
  error,
  disabled,
  now,
  onChange,
}: {
  artistId: string;
  value: string;
  current: TargetEvent | null;
  error?: string;
  disabled: boolean;
  now: number;
  onChange: (eventId: string) => void;
}) {
  const loadPage = useCallback((after: PageCursor | null) => getTargetEvents(artistId, now, after), [artistId, now]);
  const list = usePagedList(loadPage, (event: TargetEvent) => event.id, { one: "show carregado", many: "shows carregados" });
  const items = list.state.status === "ready" ? list.state.data : [];
  const options = current && !items.some((event) => event.id === current.id) ? [current, ...items] : items;
  const date = new Date(now);
  return (
    <TargetSelect
      label="Show"
      emptyLabel="Escolha o show"
      value={value}
      error={error}
      disabled={disabled}
      state={list.state.status}
      loadError={list.state.status === "error" ? list.state.message : null}
      emptyText="Nenhum show desta central de hoje em diante."
      options={options.map((event) => ({ value: event.id, label: eventLabel(event, date) }))}
      hasMore={list.hasMore}
      loadingMore={list.loadingMore}
      loadMoreError={list.loadMoreError}
      announcement={list.announcement}
      moreLabel="Carregar mais shows"
      onLoadMore={list.loadMore}
      onRetry={list.reload}
      onChange={onChange}
    />
  );
}

function TargetSelect({
  label,
  emptyLabel,
  value,
  error,
  disabled,
  state,
  loadError,
  emptyText,
  options,
  hasMore,
  loadingMore,
  loadMoreError,
  announcement,
  moreLabel,
  onLoadMore,
  onRetry,
  onChange,
}: {
  label: string;
  emptyLabel: string;
  value: string;
  error?: string;
  disabled: boolean;
  state: "loading" | "ready" | "error";
  loadError: string | null;
  emptyText: string;
  options: { value: string; label: string }[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  announcement: string;
  moreLabel: string;
  onLoadMore: () => void;
  onRetry: () => void;
  onChange: (value: string) => void;
}) {
  const hint = state === "loading" ? "Carregando..." : state === "ready" && options.length === 0 ? emptyText : undefined;
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} error={error ?? loadError ?? undefined} hint={hint}>
        {({ id, describedBy, invalid }) => (
          <SelectInput id={id} describedBy={describedBy} invalid={invalid} value={value} disabled={disabled || state !== "ready" || options.length === 0} onChange={(event) => onChange(event.target.value)}>
            <option value="">{emptyLabel}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        {state === "error" ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : null}
        {hasMore && !disabled ? (
          <Button size="sm" variant="ghost" busy={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Carregando..." : moreLabel}
          </Button>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
        {loadMoreError ? <p className="m-0 text-[13px] text-danger">{loadMoreError}</p> : null}
      </div>
    </div>
  );
}
