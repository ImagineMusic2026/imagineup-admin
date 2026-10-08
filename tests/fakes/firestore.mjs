// Dublê do `firebase/firestore` para os testes das leituras (`src/lib/*-data.ts`).
//
// Tem tudo que a fundação e as telas importam do Firestore (o `mock.module`
// com `namedExports` quebra o import do lib testado quando falta um nome):
// collection, collectionGroup, doc, query, where, orderBy, limit, startAfter,
// startAt, endAt, documentId, getDocs, getDoc, getCountFromServer e Timestamp.
// Nunca `onSnapshot`: nenhuma tela nova escuta em tempo real.
//
// Os documentos moram num mapa por caminho, e as consultas são respondidas de
// verdade (filtros, ordem, cursor e limite), para os testes conferirem as
// páginas. Cada consulta montada fica anotada (coleção ou grupo, filtros,
// ordem, cursor, limite), para o teste conferir a forma que o servidor indexa.
//
// Uso, antes do import dinâmico do lib:
//   const firestore = installFirestoreFake();
//   const { getStatsDays } = await import("@/lib/stats-data");

import { mock } from "node:test";

export class Timestamp {
  constructor(ms) {
    this.ms = ms;
  }
  static fromDate(date) {
    return new Timestamp(date.getTime());
  }
  static fromMillis(ms) {
    return new Timestamp(ms);
  }
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

const DOCUMENT_ID = Object.freeze({ kind: "documentId" });

function joinPath(base, segments) {
  return [base, ...segments].filter(Boolean).join("/");
}

function valueAt(data, id, field) {
  if (field === DOCUMENT_ID) return id;
  return String(field)
    .split(".")
    .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), data);
}

function comparable(value) {
  if (value instanceof Timestamp) return value.ms;
  if (value instanceof Date) return value.getTime();
  return value;
}

function compare(a, b) {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 0;
  if (x === undefined || x === null) return -1;
  if (y === undefined || y === null) return 1;
  return x < y ? -1 : 1;
}

function matches(data, id, filter) {
  const value = valueAt(data, id, filter.field);
  switch (filter.op) {
    case "==":
      return compare(value, filter.value) === 0;
    case "!=":
      return value !== undefined && compare(value, filter.value) !== 0;
    case "<":
      return value !== undefined && compare(value, filter.value) < 0;
    case "<=":
      return value !== undefined && compare(value, filter.value) <= 0;
    case ">":
      return value !== undefined && compare(value, filter.value) > 0;
    case ">=":
      return value !== undefined && compare(value, filter.value) >= 0;
    case "array-contains":
      return Array.isArray(value) && value.some((item) => compare(item, filter.value) === 0);
    case "in":
      return filter.value.some((item) => compare(value, item) === 0);
    default:
      throw new Error(`Operador sem dublê: ${filter.op}`);
  }
}

function snapshotOf(path, data) {
  const id = path.split("/").pop();
  return {
    id,
    ref: { type: "doc", path, id },
    exists: () => data !== undefined,
    // O próprio objeto guardado (um clone perderia a classe do Timestamp).
    data: () => data,
    get: (field) => valueAt(data, id, field),
  };
}

/** Descrição legível de uma consulta, para o teste conferir. */
function describe(target) {
  return {
    source: target.type === "group" ? { group: target.id } : { collection: target.path },
    where: target.where.map((filter) => ({
      field: filter.field === DOCUMENT_ID ? "__id__" : filter.field,
      op: filter.op,
      value: filter.value,
    })),
    orderBy: target.orderBy.map((order) => ({
      field: order.field === DOCUMENT_ID ? "__id__" : order.field,
      direction: order.direction,
    })),
    startAfter: target.startAfter ? target.startAfter.id : null,
    startAt: target.startAt ?? null,
    endAt: target.endAt ?? null,
    limit: target.limit ?? null,
  };
}

export function createFirestoreFake() {
  const documents = new Map();
  const queries = [];
  const reads = [];
  const counts = [];
  let failNext = null;

  function base(target) {
    return { where: [], orderBy: [], startAfter: null, startAt: null, endAt: null, limit: null, ...target };
  }

  function candidates(target) {
    const found = [];
    for (const [path, data] of documents) {
      const segments = path.split("/");
      if (target.type === "group") {
        if (segments.length % 2 === 0 && segments[segments.length - 2] === target.id) found.push([path, data]);
      } else if (segments.length === target.path.split("/").length + 1 && path.startsWith(`${target.path}/`)) {
        found.push([path, data]);
      }
    }
    return found;
  }

  function run(target) {
    let rows = candidates(target).filter(([path, data]) => {
      const id = path.split("/").pop();
      return target.where.every((filter) => matches(data, id, filter));
    });
    const orders = target.orderBy.length > 0 ? target.orderBy : [{ field: DOCUMENT_ID, direction: "asc" }];
    rows.sort(([pathA, a], [pathB, b]) => {
      for (const order of orders) {
        const result = compare(valueAt(a, pathA.split("/").pop(), order.field), valueAt(b, pathB.split("/").pop(), order.field));
        if (result !== 0) return order.direction === "desc" ? -result : result;
      }
      return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
    });
    // startAt e endAt valem no primeiro campo da ordem (a busca pelo @ por começo).
    if (target.startAt || target.endAt) {
      const field = orders[0].field;
      rows = rows.filter(([path, data]) => {
        const value = valueAt(data, path.split("/").pop(), field);
        if (target.startAt && compare(value, target.startAt[0]) < 0) return false;
        if (target.endAt && compare(value, target.endAt[0]) > 0) return false;
        return true;
      });
    }
    if (target.startAfter) {
      const at = rows.findIndex(([path]) => path === target.startAfter.ref.path);
      rows = at >= 0 ? rows.slice(at + 1) : rows;
    }
    if (target.limit !== null) rows = rows.slice(0, target.limit);
    return rows.map(([path, data]) => snapshotOf(path, data));
  }

  function maybeFail() {
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
  }

  const api = {
    Timestamp,
    collection: (parent, ...segments) => base({ type: "collection", path: joinPath(parent?.path, segments) }),
    collectionGroup: (_db, id) => base({ type: "group", id }),
    doc: (parent, ...segments) => {
      const path = joinPath(parent?.path, segments);
      return { type: "doc", path, id: path.split("/").pop() };
    },
    query: (target, ...constraints) => {
      const next = { ...target, where: [...target.where], orderBy: [...target.orderBy] };
      for (const constraint of constraints) {
        if (constraint.kind === "where") next.where.push(constraint);
        else if (constraint.kind === "orderBy") next.orderBy.push(constraint);
        else if (constraint.kind === "limit") next.limit = constraint.count;
        else if (constraint.kind === "startAfter") next.startAfter = constraint.cursor;
        else if (constraint.kind === "startAt") next.startAt = constraint.values;
        else if (constraint.kind === "endAt") next.endAt = constraint.values;
      }
      return next;
    },
    where: (field, op, value) => ({ kind: "where", field, op, value }),
    orderBy: (field, direction = "asc") => ({ kind: "orderBy", field, direction }),
    limit: (count) => ({ kind: "limit", count }),
    startAfter: (cursor) => ({ kind: "startAfter", cursor }),
    startAt: (...values) => ({ kind: "startAt", values }),
    endAt: (...values) => ({ kind: "endAt", values }),
    documentId: () => DOCUMENT_ID,
    getDoc: async (ref) => {
      reads.push(ref.path);
      maybeFail();
      return snapshotOf(ref.path, documents.get(ref.path));
    },
    getDocs: async (target) => {
      queries.push(describe(target));
      maybeFail();
      const docs = run(target);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
    getCountFromServer: async (target) => {
      counts.push(describe(target));
      maybeFail();
      const count = run({ ...target, limit: null, startAfter: null }).length;
      return { data: () => ({ count }) };
    },
  };

  return {
    api,
    db: { path: "" },
    /** Grava um documento pelo caminho (`statsDaily/2026-10-07`). */
    set(path, data) {
      documents.set(path, data);
    },
    remove(path) {
      documents.delete(path);
    },
    /** Esquece documentos e anotações. */
    reset() {
      documents.clear();
      queries.length = 0;
      reads.length = 0;
      counts.length = 0;
      failNext = null;
    },
    /** A próxima leitura falha com este erro. */
    failNext(error) {
      failNext = error;
    },
    queries,
    reads,
    counts,
  };
}

/**
 * Troca o `firebase/firestore` e o `db()` de `@/lib/firebase` pelo dublê.
 * Chame antes do import dinâmico do lib testado.
 */
export function installFirestoreFake() {
  const fake = createFirestoreFake();
  mock.module("firebase/firestore", { namedExports: fake.api });
  mock.module("@/lib/firebase", { namedExports: { db: () => fake.db, functions: () => ({ name: "functions-de-teste" }), storage: () => ({}) } });
  return fake;
}
