import { getDocsFromServer, type DocumentData, type Query, type QuerySnapshot } from "firebase/firestore";

/**
 * Leitura única de uma consulta, sempre do servidor. Sem rede, o `getDocs`
 * resolve com o retrato do cache, e o cache em memória do painel só guarda o
 * que alguma escuta segura: a consulta voltava vazia, e a tela ficava "pronta
 * e vazia", sem nunca ler de novo (os nomes das centrais sumiam dos filtros
 * depois de uma queda de rede). Aqui, sem rede, a leitura falha com
 * `unavailable` ("Sem conexão"): a tela mostra o erro, e o `useLoad` lê de
 * novo quando a conexão volta. O `getDoc` já falha sozinho sem rede.
 */
export function readQuery<AppModelType, DbModelType extends DocumentData>(
  target: Query<AppModelType, DbModelType>,
): Promise<QuerySnapshot<AppModelType, DbModelType>> {
  return getDocsFromServer(target);
}
