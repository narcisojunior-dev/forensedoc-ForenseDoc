/**
 * Versão vigente dos documentos jurídicos, no cliente.
 *
 * Espelha `backend/src/legal/termsVersion.js`. Os dois precisam concordar: o
 * cadastro envia esta versão e o servidor recusa qualquer outra, para que o
 * aceite registrado seja o do texto que a pessoa efetivamente viu.
 *
 * Se divergirem, o cadastro para de funcionar por inteiro — o que é o modo certo
 * de falhar. A alternativa (aceitar qualquer versão) registraria consentimento
 * sobre um texto que ninguém sabe qual era.
 */
export const TERMS_VERSION = "2026-07-31";
