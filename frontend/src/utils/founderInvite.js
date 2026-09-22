/**
 * Código de convite de fundador vindo do link `?founder=FND-XXXX-XXXX` (L1).
 *
 * ─── Por que persistir ───────────────────────────────────────────────────────
 *
 * O link do admin aponta para `/dashboard/plans`, que é rota protegida. Um
 * convidado deslogado é mandado para `/login`, e o `Login.jsx` navega direto
 * para `/dashboard` — o `state.from` guardado pelo `ProtectedRoute` é ignorado.
 * Sem guardar o código em algum lugar, ele se perde exatamente no caminho mais
 * provável do convidado e a vaga de fundador vira suporte manual.
 *
 * ─── Por que localStorage, e não sessionStorage ──────────────────────────────
 *
 * Aqui vivia um `sessionStorage`, escolhido para que um código velho não
 * ressurgisse meses depois numa aba nova. A intenção estava certa, a ferramenta
 * não: `sessionStorage` é POR ABA, e o percurso obrigatório do convidado troca
 * de aba no meio.
 *
 * Ele clica no link, se cadastra, e o login fica bloqueado até confirmar o
 * e-mail (`EMAIL_NOT_VERIFIED`). Para confirmar, abre a caixa de entrada e
 * clica no link de verificação, que o cliente de e-mail abre numa ABA NOVA. Ali
 * o `sessionStorage` está vazio: o convidado terminava o cadastro, chegava aos
 * planos e via só os planos normais, sem o card de fundador e sem campo para
 * digitar o código. Não era um caso de borda; era o caminho comum.
 *
 * O `localStorage` é compartilhado entre as abas do mesmo navegador e resolve
 * isso. O risco que motivou o `sessionStorage` continua real, e é tratado de
 * frente: o registro guarda a data da captura e vence em 7 dias. Prazo, e não
 * escopo de aba, é a forma correta de expressar "este convite vale para esta
 * visita".
 *
 * Sete dias porque é o intervalo em que alguém abre o convite, pensa, conversa
 * com o escritório e volta. Mais que isso e o preço travado por 12 meses estaria
 * sendo concedido a partir de uma decisão que já não é a mesma.
 */

const STORAGE_KEY = "founder_invite_code";
const QUERY_PARAM = "founder";

/** Prazo de validade do convite guardado no navegador. */
export const VALIDADE_CONVITE_MS = 7 * 24 * 60 * 60 * 1000;

function codigoDaUrl() {
  try {
    const bruto = new URLSearchParams(window.location.search).get(QUERY_PARAM);
    return bruto && bruto.trim() ? bruto.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

function lerRegistro() {
  try {
    const cru = localStorage.getItem(STORAGE_KEY);
    if (!cru) return null;
    const registro = JSON.parse(cru);
    // Sem data não dá para saber se venceu, e um convite sem prazo é
    // justamente o que a troca de storage existe para não criar.
    if (!registro?.codigo || typeof registro.capturadoEm !== "number") return null;
    return registro;
  } catch {
    // JSON inválido (versão anterior do formato, ou storage adulterado) ou
    // acesso bloqueado: trata como se não houvesse convite guardado.
    return null;
  }
}

function guardar(codigo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ codigo, capturadoEm: Date.now() }));
  } catch {
    // Storage bloqueado (modo restrito do navegador): o fluxo segue pela URL
    // enquanto ela existir.
  }
}

/**
 * Captura o código da URL atual, se houver, e guarda com a data.
 * Chamada uma vez na inicialização do app, antes de qualquer roteamento.
 */
export function captureFounderCode() {
  const daUrl = codigoDaUrl();
  if (daUrl) guardar(daUrl);
}

/**
 * Código ativo desta visita — da URL ou do que foi capturado antes do login.
 *
 * A URL tem precedência: se o convidado clicou num link novo, é esse convite
 * que ele quer resgatar, não o que estava guardado.
 */
export function getFounderCode() {
  const daUrl = codigoDaUrl();
  if (daUrl) return daUrl;

  const registro = lerRegistro();
  if (!registro) return null;

  if (Date.now() - registro.capturadoEm > VALIDADE_CONVITE_MS) {
    // Vencido some na leitura, e não só deixa de valer: registro morto que
    // fica no navegador é o que faz um código velho reaparecer meses depois.
    clearFounderCode();
    return null;
  }
  return registro.codigo;
}

/** Descarta o código — após resgate concluído ou quando o backend o recusa. */
export function clearFounderCode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada a fazer */
  }
}

/** Link completo que o admin entrega ao convidado. */
export function buildFounderLink(code) {
  return `${window.location.origin}/dashboard/plans?${QUERY_PARAM}=${encodeURIComponent(code)}`;
}
