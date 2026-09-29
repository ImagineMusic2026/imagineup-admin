import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";

/**
 * SDK do cliente do Firebase (projeto `imagine-up-app`, o mesmo do app).
 *
 * A inicialização é preguiçosa de propósito: nada roda no import. Sem as
 * variáveis de ambiente o painel mostra "Firebase não configurado" em vez de
 * estourar, e o prerender do `next build` não abre conexão nenhuma.
 *
 * Componentes não importam o Firebase: tudo passa por `src/lib`.
 */

/** Região das Cloud Functions da equipe (a mesma do Firestore). */
export const FUNCTIONS_REGION = "southamerica-east1";

/** Projeto usado com os emuladores (`demo-` impede falar com a nuvem). */
export const EMULATOR_PROJECT_ID = "demo-imagine-up-app";

const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST?.trim() || "";

const REAL_CONFIG: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Com o emulador ligado, o projeto é sempre o `demo-imagine-up-app`, mesmo que
 * o `.env.local` tenha as chaves reais: um teste local nunca fala com o projeto
 * de verdade. O emulador aceita qualquer chave de API.
 */
const CONFIG: FirebaseOptions = EMULATOR_HOST
  ? {
      apiKey: REAL_CONFIG.apiKey || "demo-api-key",
      authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT_ID,
      appId: REAL_CONFIG.appId || "demo-app-id",
    }
  : REAL_CONFIG;

export function isFirebaseConfigured(): boolean {
  return Boolean(CONFIG.apiKey && CONFIG.projectId && CONFIG.appId);
}

export function usesEmulators(): boolean {
  return Boolean(EMULATOR_HOST);
}

function app(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase não configurado. Preencha o .env.local do painel.");
  }
  return getApps().length ? getApp() : initializeApp(CONFIG);
}

export function auth(): Auth {
  const instance = getAuth(app());
  if (EMULATOR_HOST && !instance.emulatorConfig) {
    connectAuthEmulator(instance, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  }
  return instance;
}

let firestoreEmulatorConnected = false;

export function db(): Firestore {
  const instance = getFirestore(app());
  if (EMULATOR_HOST && !firestoreEmulatorConnected) {
    firestoreEmulatorConnected = true;
    try {
      connectFirestoreEmulator(instance, EMULATOR_HOST, 8080);
    } catch {
      // Recarga do módulo em desenvolvimento: a instância já estava ligada.
    }
  }
  return instance;
}

let functionsEmulatorConnected = false;

export function functions(): Functions {
  const instance = getFunctions(app(), FUNCTIONS_REGION);
  if (EMULATOR_HOST && !functionsEmulatorConnected) {
    functionsEmulatorConnected = true;
    connectFunctionsEmulator(instance, EMULATOR_HOST, 5001);
  }
  return instance;
}
