/**
 * Código de convite de fundador vindo do link `?founder=FND-XXXX-XXXX` (L1).
 *
 * Por que persistir: o link do admin aponta para `/dashboard/plans`, que é
 * rota protegida. Um convidado deslogado é mandado para `/login`, e o
 * `Login.jsx` navega direto para `/dashboard` — o `state.from` guardado pelo
 * `ProtectedRoute` é ignorado. Sem guardar o código em algum lugar, ele se
 * perde exatamente no caminho mais provável do convidado (clicar no link sem
 * estar logado) e a vaga de fundador vira suporte manual.
 *
 * `sessionStorage` e não `localStorage`: o convite vale para esta visita. Não
 * queremos que um código velho ressurja meses depois numa aba nova.
 */

const STORAGE_KEY = "founder_invite_code";
const QUERY_PARAM = "founder";

/**
 * Captura o código da URL atual, se houver, e guarda para o resto da sessão.
 * Chamada uma vez na inicialização do app, antes de qualquer roteamento.
 */
export function captureFounderCode() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(QUERY_PARAM);
    if (fromUrl && fromUrl.trim()) {
      sessionStorage.setItem(STORAGE_KEY, fromUrl.trim().toUpperCase());
    }
  } catch {
    // sessionStorage bloqueado (modo restrito do navegador): o fluxo segue
    // pela URL enquanto ela existir.
  }
}

/** Código ativo desta sessão — da URL ou do que foi capturado antes do login. */
export function getFounderCode() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(QUERY_PARAM);
    if (fromUrl && fromUrl.trim()) return fromUrl.trim().toUpperCase();
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Descarta o código — após resgate concluído ou quando o backend o recusa. */
export function clearFounderCode() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada a fazer */
  }
}

/** Link completo que o admin entrega ao convidado. */
export function buildFounderLink(code) {
  return `${window.location.origin}/dashboard/plans?${QUERY_PARAM}=${encodeURIComponent(code)}`;
}
