import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
} from "firebase/firestore";

import { parseFanProfile, type FanProfile } from "@/lib/fan-profile";
import { createFanProfileReader, type FanProfileReader } from "@/lib/fan-profile-data";
import { parseLedgerEntry, parseReferral, parseWallet, joinFanCentrals, type FanCentral, type LedgerEntry, type Referral, type Wallet } from "@/lib/fans";
import { db } from "@/lib/firebase";
import { countOf, getPage, type PageCursor } from "@/lib/firestore-page";
import { parseLevels, type Level } from "@/lib/levels";
import { toDate } from "@/lib/staff";

/**
 * Leituras da seção Fãs, todas únicas. As regras (26.10) liberam a quem vê
 * `fans`: os perfis (`users`, ler e listar), a carteira, o extrato e os pontos
 * por central, os vínculos com as centrais, as curtidas e presenças, os
 * comentários (`postComments`, também em grupo), o convite (`fanInvites`,
 * `inviteLinks`, `referrals`) e os posts e shows citados. Os pedidos da loja
 * (`redemptions`) são só de quem vê Recompensas. Nada aqui grava.
 */

export const FAN_PAGE_SIZE = 25;
export const FAN_TAB_PAGE_SIZE = 20;

export interface FanRow {
  uid: string;
  profile: FanProfile | null;
  wallet: Wallet;
  /** Desde quando está na central (o filtro por central). */
  joinedAt: Date | null;
}

export type FanListMode =
  | { kind: "newest" }
  | { kind: "xp" }
  | { kind: "central"; artistId: string }
  | { kind: "goal"; seasonId: string }
  | { kind: "suspended" };

export interface Page<T> {
  items: T[];
  cursor: PageCursor | null;
  hasMore: boolean;
}

/** A temporada de agora (`config/season.season`), que a equipe ativa lê. */
export async function getCurrentSeason(): Promise<{ id: string; name: string } | null> {
  const snapshot = await getDoc(doc(db(), "config", "season"));
  const season = snapshot.data()?.season as { id?: unknown; name?: unknown } | undefined;
  return season && typeof season.id === "string" ? { id: season.id, name: typeof season.name === "string" ? season.name : season.id } : null;
}

/** A régua de níveis gravada, ou `null` sem ela. */
export async function getLevels(): Promise<Level[] | null> {
  const snapshot = await getDoc(doc(db(), "config", "points"));
  return parseLevels(snapshot.data());
}

export function getFansCount(): Promise<number> {
  return countOf(collection(db(), "users"));
}

async function getWallet(uid: string): Promise<Wallet> {
  const snapshot = await getDoc(doc(db(), "wallets", uid));
  return parseWallet(snapshot.data());
}

function listQuery(mode: FanListMode): Query<DocumentData> {
  switch (mode.kind) {
    case "newest":
      return query(collection(db(), "users"), orderBy("createdAt", "desc"));
    case "xp":
      return query(collection(db(), "wallets"), orderBy("xp", "desc"));
    case "central":
      return query(collectionGroup(db(), "centrals"), where("artistId", "==", mode.artistId), orderBy("joinedAt", "desc"));
    case "goal":
      return query(collection(db(), "wallets"), where("goalReached.seasonId", "==", mode.seasonId));
    case "suspended":
      return query(collection(db(), "users"), where("suspendedAt", "!=", null), orderBy("suspendedAt", "desc"));
  }
}

/**
 * Uma página da lista de fãs, 25 por vez. Cada linha lê o que a consulta não
 * trouxe (o perfil ou a carteira), em paralelo.
 */
export async function getFanListPage(mode: FanListMode, after: PageCursor | null, reader: FanProfileReader): Promise<Page<FanRow>> {
  const page = await getPage(listQuery(mode), { size: FAN_PAGE_SIZE, after });
  const items = await Promise.all(
    page.docs.map(async (item): Promise<FanRow> => {
      const data = item.data();
      if (mode.kind === "newest" || mode.kind === "suspended") {
        return { uid: item.id, profile: parseFanProfile(item.id, data), wallet: await getWallet(item.id), joinedAt: null };
      }
      if (mode.kind === "xp" || mode.kind === "goal") {
        return { uid: item.id, profile: await reader.get(item.id), wallet: parseWallet(data), joinedAt: null };
      }
      const uid = typeof data.uid === "string" ? data.uid : (item.ref.parent.parent?.id ?? item.id);
      const [profile, wallet] = await Promise.all([reader.get(uid), getWallet(uid)]);
      return { uid, profile, wallet, joinedAt: toDate(data.joinedAt) };
    }),
  );
  return { items, cursor: page.cursor, hasMore: page.hasMore };
}

/** Linhas a partir de perfis já lidos (a busca): só falta a carteira. */
export async function rowsOfProfiles(profiles: FanProfile[]): Promise<FanRow[]> {
  return Promise.all(profiles.map(async (profile) => ({ uid: profile.uid, profile, wallet: await getWallet(profile.uid), joinedAt: null })));
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

export interface FanOrigin {
  referral: Referral;
  inviter: FanProfile | null;
  /** O texto do post do link, ou o nome da central, quando o link aponta para um. */
  postText: string | null;
  artistName: string | null;
  /** Os pontos que entraram no extrato de quem convidou no claim. */
  points: { visit: number | null; signup: number | null };
}

export interface FanCard {
  profile: FanProfile | null;
  wallet: Wallet;
  /** `null`: cadastro direto, sem convite. */
  origin: FanOrigin | null;
}

function snippet(text: unknown, max = 60): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function readOrigin(uid: string, reader: FanProfileReader): Promise<FanOrigin | null> {
  const snapshot = await getDoc(doc(db(), "referrals", uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const referral = parseReferral(data);
  const target = referral.link?.targetId ?? null;
  const [inviter, postText, artistName, points] = await Promise.all([
    referral.inviterUid ? reader.get(referral.inviterUid) : Promise.resolve(null),
    referral.link?.kind === "post" && target
      ? getDoc(doc(db(), "posts", target)).then((post) => snippet(post.data()?.text), () => null)
      : Promise.resolve(null),
    referral.link?.kind === "artist" && target
      ? getDoc(doc(db(), "artists", target)).then((artist) => (typeof artist.data()?.name === "string" ? (artist.data()?.name as string) : null), () => null)
      : Promise.resolve(null),
    referral.inviterUid && data.claimedAt
      ? getDocs(query(collection(db(), "wallets", referral.inviterUid, "ledger"), where("createdAt", "==", data.claimedAt))).then(
          (ledger) => {
            const entries = ledger.docs.map((entry) => parseLedgerEntry(entry.id, entry.data()));
            const of = (source: string) => {
              const found = entries.find((entry) => entry.source === source && (!entry.subject || entry.subject.id === referral.code));
              return found ? found.points : null;
            };
            return { visit: of("invite_visit"), signup: of("invite_signup") };
          },
          () => ({ visit: null, signup: null }),
        )
      : Promise.resolve({ visit: null, signup: null }),
  ]);
  return { referral, inviter, postText, artistName, points };
}

/** O cabeçalho e os cartões da ficha: o perfil, a carteira e a origem do cadastro. */
export async function getFanCard(uid: string, reader: FanProfileReader = createFanProfileReader()): Promise<FanCard> {
  const [profile, wallet, origin] = await Promise.all([reader.get(uid), getWallet(uid), readOrigin(uid, reader)]);
  return { profile, wallet, origin };
}

/** O extrato, do mais novo, 20 por vez. */
export async function getLedgerPage(uid: string, after: PageCursor | null): Promise<Page<LedgerEntry>> {
  const page = await getPage(query(collection(db(), "wallets", uid, "ledger"), orderBy("createdAt", "desc")), { size: FAN_TAB_PAGE_SIZE, after });
  return { items: page.docs.map((item) => parseLedgerEntry(item.id, item.data())), cursor: page.cursor, hasMore: page.hasMore };
}

/** Um lançamento do ajuste pela tentativa (o "Conferir o extrato"), ou `null`. */
export async function getAdjustmentEntry(uid: string, adjustmentId: string): Promise<LedgerEntry | null> {
  const snapshot = await getDoc(doc(db(), "wallets", uid, "ledger", `adjustment:${adjustmentId}`));
  return snapshot.exists() ? parseLedgerEntry(snapshot.id, snapshot.data()) : null;
}

/** As centrais do fã: os vínculos de agora e os pontos de cada uma (também das que ele saiu). */
export async function getFanCentrals(uid: string): Promise<FanCentral[]> {
  const [links, points] = await Promise.all([
    getDocs(collection(db(), "users", uid, "centrals")),
    getDocs(collection(db(), "wallets", uid, "centralPoints")),
  ]);
  return joinFanCentrals(
    links.docs.map((item) => ({ id: item.id, data: item.data() })),
    points.docs.map((item) => ({ id: item.id, data: item.data() })),
  );
}

export interface LikeRow {
  postId: string;
  artistId: string | null;
  at: Date | null;
  postText: string | null;
  postKind: string | null;
}

/** As curtidas ativas, das mais novas, com o texto do post. */
export async function getLikesPage(uid: string, after: PageCursor | null): Promise<Page<LikeRow>> {
  const page = await getPage(
    query(collection(db(), "users", uid, "postLikes"), where("liked", "==", true), orderBy("updatedAt", "desc")),
    { size: FAN_TAB_PAGE_SIZE, after },
  );
  const items = await Promise.all(
    page.docs.map(async (item) => {
      const data = item.data();
      const post = await getDoc(doc(db(), "posts", item.id)).then((snapshot) => snapshot.data(), () => undefined);
      return {
        postId: item.id,
        artistId: typeof data.artistId === "string" ? data.artistId : null,
        at: toDate(data.updatedAt),
        postText: snippet(post?.text),
        postKind: typeof post?.kind === "string" ? post.kind : null,
      };
    }),
  );
  return { items, cursor: page.cursor, hasMore: page.hasMore };
}

export interface RsvpRow {
  eventId: string;
  at: Date | null;
  title: string | null;
  startsAt: Date | null;
}

/** As presenças confirmadas ("Eu vou"), das mais novas, com o show. */
export async function getRsvpsPage(uid: string, after: PageCursor | null): Promise<Page<RsvpRow>> {
  const page = await getPage(
    query(collection(db(), "users", uid, "eventRsvps"), where("going", "==", true), orderBy("updatedAt", "desc")),
    { size: FAN_TAB_PAGE_SIZE, after },
  );
  const items = await Promise.all(
    page.docs.map(async (item) => {
      const event = await getDoc(doc(db(), "events", item.id)).then((snapshot) => snapshot.data(), () => undefined);
      return {
        eventId: item.id,
        at: toDate(item.data().updatedAt),
        title: typeof event?.title === "string" ? event.title : null,
        startsAt: toDate(event?.startsAt),
      };
    }),
  );
  return { items, cursor: page.cursor, hasMore: page.hasMore };
}

export interface CommentRow {
  commentId: string;
  postId: string;
  artistId: string | null;
  text: string;
  status: "visible" | "hidden";
  createdAt: Date | null;
  postText: string | null;
}

/** Os comentários do fã (grupo `postComments`), do mais novo. */
export async function getFanCommentsPage(uid: string, after: PageCursor | null): Promise<Page<CommentRow>> {
  const page = await getPage(
    query(collectionGroup(db(), "postComments"), where("authorUid", "==", uid), orderBy("createdAt", "desc")),
    { size: FAN_TAB_PAGE_SIZE, after },
  );
  const posts = new Map<string, Promise<string | null>>();
  const postText = (postId: string) => {
    let pending = posts.get(postId);
    if (!pending) {
      pending = getDoc(doc(db(), "posts", postId)).then((snapshot) => snippet(snapshot.data()?.text), () => null);
      posts.set(postId, pending);
    }
    return pending;
  };
  const items = await Promise.all(
    page.docs.map(async (item) => {
      const data = item.data();
      const postId = typeof data.postId === "string" ? data.postId : (item.ref.parent.parent?.id ?? "");
      return {
        commentId: item.id,
        postId,
        artistId: typeof data.artistId === "string" ? data.artistId : null,
        text: typeof data.text === "string" ? data.text : "",
        status: data.status === "hidden" ? ("hidden" as const) : ("visible" as const),
        createdAt: toDate(data.createdAt),
        postText: postId ? await postText(postId) : null,
      };
    }),
  );
  return { items, cursor: page.cursor, hasMore: page.hasMore };
}

export interface InviteSummary {
  code: string | null;
  links: { id: string; kind: string; targetId: string | null; createdAt: Date | null }[];
  broughtCount: number;
}

/** O código, os links criados e quantas pessoas o fã trouxe (`count()`). */
export async function getInviteSummary(uid: string): Promise<InviteSummary> {
  const [invite, links, brought] = await Promise.all([
    getDoc(doc(db(), "fanInvites", uid)),
    getDocs(query(collection(db(), "fanInvites", uid, "inviteLinks"), orderBy("createdAt", "desc"))),
    countOf(query(collection(db(), "referrals"), where("inviterUid", "==", uid))),
  ]);
  return {
    code: typeof invite.data()?.code === "string" ? (invite.data()?.code as string) : null,
    links: links.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        kind: typeof data.kind === "string" ? data.kind : "",
        targetId: typeof data.targetId === "string" ? data.targetId : null,
        createdAt: toDate(data.createdAt),
      };
    }),
    broughtCount: brought,
  };
}

export interface BroughtRow {
  uid: string;
  profile: FanProfile | null;
  referral: Referral;
}

/** As pessoas que o fã trouxe, das mais novas, com o nome de cada uma. */
export async function getBroughtPage(uid: string, after: PageCursor | null, reader: FanProfileReader): Promise<Page<BroughtRow>> {
  const page = await getPage(
    query(collection(db(), "referrals"), where("inviterUid", "==", uid), orderBy("claimedAt", "desc")),
    { size: FAN_TAB_PAGE_SIZE, after },
  );
  const items = await Promise.all(
    page.docs.map(async (item) => ({ uid: item.id, profile: await reader.get(item.id), referral: parseReferral(item.data()) })),
  );
  return { items, cursor: page.cursor, hasMore: page.hasMore };
}

export interface FanRedemptionRow {
  code: string;
  rewardTitle: string;
  points: number;
  status: string;
  requestedAt: Date | null;
}

/** Os pedidos da loja do fã (só quem vê Recompensas), dos mais novos. */
export async function getFanRedemptionsPage(uid: string, after: PageCursor | null): Promise<Page<FanRedemptionRow>> {
  const page = await getPage(
    query(collection(db(), "redemptions"), where("uid", "==", uid), orderBy("requestedAt", "desc")),
    { size: FAN_TAB_PAGE_SIZE, after },
  );
  return {
    items: page.docs.map((item) => {
      const data = item.data();
      return {
        code: item.id,
        rewardTitle: typeof data.rewardTitle === "string" ? data.rewardTitle : (typeof data.rewardId === "string" ? data.rewardId : ""),
        points: typeof data.points === "number" ? data.points : 0,
        status: typeof data.status === "string" ? data.status : "",
        requestedAt: toDate(data.requestedAt),
      };
    }),
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
}
