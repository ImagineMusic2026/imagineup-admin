import {
  getDocFromServer,
  getDocsFromServer,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";

/**
 * Leitura única de uma consulta, sempre do servidor. Sem rede, o `getDocs`
 * resolve com o retrato do cache, que traz o que as escutas e as leituras de
 * antes guardaram: vazio ou velho. A tela ficava "pronta e vazia", sem nunca
 * ler de novo (os nomes das centrais sumiam dos filtros depois de uma queda de
 * rede). Aqui, sem rede, a leitura falha com `unavailable` ("Sem conexão"): a
 * tela mostra o erro, e o `useLoad` lê de novo quando a conexão volta.
 */
export function readQuery<AppModelType, DbModelType extends DocumentData>(
  target: Query<AppModelType, DbModelType>,
): Promise<QuerySnapshot<AppModelType, DbModelType>> {
  return getDocsFromServer(target);
}

/**
 * Leitura única de um documento, sempre do servidor. Sem rede, o `getDoc` só
 * falha sozinho com o documento que nunca foi lido nesta sessão: o que já foi
 * lido volta do cache em memória (`fromCache`), e a tela mostrava "Atualizado
 * às" com o dado de antes da queda. Passam por aqui as leituras de documento
 * das telas que mostram a hora da última leitura; o `getArtist` e o
 * `getArtistPrivate` ficam no `getDoc`, porque a escuta das centrais mantém o
 * cache delas em dia.
 */
export function readDoc<AppModelType, DbModelType extends DocumentData>(
  target: DocumentReference<AppModelType, DbModelType>,
): Promise<DocumentSnapshot<AppModelType, DbModelType>> {
  return getDocFromServer(target);
}
