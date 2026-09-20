import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ShieldX, EyeOff, Search, Loader2, ArrowLeft } from "lucide-react";
import { api } from "../lib/axios";
import { cn } from "../utils/cn";
import logoImg from "../assets/logo.png";

/**
 * Verificação pública de autenticidade de laudo.
 *
 * Página aberta, sem sessão: quem confere um laudo é justamente quem não tem
 * conta aqui, como o juízo, a parte contrária e o titular do dado que aparece
 * no contrato analisado.
 *
 * Chega-se aqui de duas formas: pelo QR impresso no laudo, que traz a chave na
 * URL e dispensa digitação, ou pelo formulário, colando o hash que está no
 * corpo do documento. As duas terminam na mesma tela.
 */

const SITUACOES = {
  VALIDO: {
    titulo: "Laudo autêntico",
    Icone: ShieldCheck,
    cor: "text-emerald-500",
    borda: "border-emerald-500/30",
    fundo: "bg-emerald-500/[0.06]",
  },
  SUBSTITUIDO: {
    titulo: "Laudo substituído",
    Icone: ShieldAlert,
    cor: "text-amber-500",
    borda: "border-amber-500/30",
    fundo: "bg-amber-500/[0.06]",
  },
  CANCELADO: {
    titulo: "Laudo cancelado",
    Icone: ShieldX,
    cor: "text-red-500",
    borda: "border-red-500/30",
    fundo: "bg-red-500/[0.06]",
  },
  DADOS_REMOVIDOS: {
    titulo: "Laudo autêntico, dados removidos",
    Icone: EyeOff,
    cor: "text-zinc-300",
    borda: "border-surface-border",
    fundo: "bg-surface/40",
  },
};

function Campo({ rotulo, valor, mono = false }) {
  if (!valor) return null;
  return (
    <div className="border-b border-surface-border/60 py-3 last:border-b-0">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{rotulo}</div>
      <div className={cn("mt-1 break-all text-[13px] text-foreground", mono && "font-mono text-[12px]")}>
        {valor}
      </div>
    </div>
  );
}

export default function VerificarLaudo() {
  const { chave } = useParams();
  const navigate = useNavigate();
  const [entrada, setEntrada] = useState(chave || "");
  const [estado, setEstado] = useState(chave ? "carregando" : "ocioso");
  const [dados, setDados] = useState(null);

  const consultar = useCallback(async (valor) => {
    setEstado("carregando");
    try {
      const { data } = await api.get(`/public/laudos/${encodeURIComponent(valor)}`);
      setDados(data);
      setEstado("achado");
    } catch (erro) {
      setDados(null);
      setEstado(erro?.response?.status === 404 ? "ausente" : "erro");
    }
  }, []);

  useEffect(() => {
    if (chave) consultar(chave);
  }, [chave, consultar]);

  const enviar = (e) => {
    e.preventDefault();
    const valor = entrada.trim();
    if (!valor) return;
    // A URL passa a carregar a chave para que o resultado seja compartilhável
    // e sobreviva a um recarregamento da página.
    navigate(`/verificar/${encodeURIComponent(valor)}`);
  };

  const s = dados ? SITUACOES[dados.situacao] || SITUACOES.VALIDO : null;

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          <img src={logoImg} alt="ForenseDoc" className="h-6 w-auto object-contain" />
        </Link>

        <h1 className="text-2xl font-bold text-foreground">Verificar autenticidade de laudo</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Informe o código de verificação impresso no laudo (formato FD-0000-0000-0000) ou o resumo
          SHA-256 do laudo. A consulta é pública e não exige cadastro.
        </p>

        <form onSubmit={enviar} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="chave" className="sr-only">
            Código ou hash do laudo
          </label>
          <input
            id="chave"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="FD-0000-0000-0000"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border border-surface-border bg-surface px-4 py-3 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <Search className="h-4 w-4" />
            Verificar
          </button>
        </form>

        {estado === "carregando" && (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {estado === "ausente" && (
          <div className="mt-8 rounded-xl border border-surface-border bg-surface/40 p-6">
            <p className="text-sm text-zinc-300">Nenhum laudo corresponde a este código ou hash.</p>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
              Confira se a chave foi copiada por inteiro. O código tem o formato FD-0000-0000-0000 e
              o resumo SHA-256 tem 64 caracteres.
            </p>
          </div>
        )}

        {estado === "erro" && (
          <div className="mt-8 rounded-xl border border-surface-border bg-surface/40 p-6">
            <p className="text-sm text-zinc-300">
              Não foi possível consultar agora. Tente novamente em alguns instantes.
            </p>
          </div>
        )}

        {estado === "achado" && dados && (
          <div className="mt-8 space-y-4">
            <div className={cn("flex items-start gap-3 rounded-xl border p-5", s.borda, s.fundo)}>
              <s.Icone className={cn("mt-0.5 h-6 w-6 shrink-0", s.cor)} />
              <div>
                <h2 className={cn("text-lg font-bold", s.cor)}>{s.titulo}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{dados.aviso}</p>
                {dados.substituidoPor && (
                  <p className="mt-3 text-[13px] text-zinc-300">
                    Laudo vigente:{" "}
                    <Link
                      to={`/verificar/${dados.substituidoPor}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {dados.substituidoPor}
                    </Link>
                  </p>
                )}
                {dados.cancelamento?.motivo && (
                  <p className="mt-3 text-[13px] text-zinc-300">
                    Motivo informado pelo emissor: {dados.cancelamento.motivo}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-surface-border bg-surface/40 p-5">
              <Campo rotulo="Código de verificação" valor={dados.codigo} mono />
              <Campo rotulo="Protocolo do laudo" valor={dados.protocolo} mono />
              <Campo
                rotulo="Emitido em"
                valor={new Date(dados.emitidoEm).toLocaleString("pt-BR", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
              />
              <Campo rotulo="Emissor" valor={dados.emissor} />
              <Campo rotulo="SHA-256 do laudo" valor={dados.laudo?.sha256} mono />
              <Campo rotulo="SHA-256 do documento analisado" valor={dados.documentoAnalisado?.sha256} mono />
              <Campo rotulo="SHA-1 do documento analisado" valor={dados.documentoAnalisado?.sha1} mono />
              <Campo rotulo="Titular" valor={dados.titular?.nome} />
              <Campo rotulo="CPF do titular" valor={dados.titular?.cpf} mono />
            </div>

            <p className="text-[12px] leading-relaxed text-zinc-500">
              Nome e CPF aparecem parcialmente ocultos porque esta página é pública e o titular do
              dado não é cliente do ForenseDoc. O que está visível basta para confirmar que o laudo
              em mãos é o mesmo registrado aqui, sem revelar a identidade a quem não a conhece
              (LGPD, art. 6º, III).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
