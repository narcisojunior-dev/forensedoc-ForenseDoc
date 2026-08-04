import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";

/**
 * Cadastro e gestão do segundo fator (TOTP).
 *
 * ─── Por que os códigos de recuperação ocupam tanto espaço aqui ──────────────
 *
 * Eles são a única saída quando o celular se perde, e existem em texto claro
 * uma única vez: o servidor guarda apenas hashes. Uma tela que os mostrasse de
 * passagem produziria, meses depois, um operador trancado fora do próprio
 * painel. Por isso eles ficam num bloco que exige confirmação explícita de que
 * foram guardados antes de sumir.
 */

function CampoSenha({ label, valor, onChange, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      <input
        {...props}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full px-4 py-2.5 bg-surface border border-surface-border rounded-lg text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
      />
    </div>
  );
}

function CodigosDeRecuperacao({ codigos, aoConfirmar }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigos.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Área de transferência bloqueada por permissão do navegador: os códigos
      // continuam visíveis na tela, que é o que importa.
      toast.error("Não foi possível copiar. Anote os códigos manualmente.");
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Guarde os códigos de recuperação</p>
          <p className="mt-1 text-zinc-400">
            Cada um funciona uma única vez e substitui o aplicativo se você perder o celular.
            Eles não serão exibidos novamente.
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-foreground">
        {codigos.map((codigo) => (
          <li key={codigo} className="rounded-lg bg-surface px-3 py-2 text-center tracking-wider">
            {codigo}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copiar}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-border text-sm text-zinc-300 hover:text-foreground transition-colors"
        >
          {copiado ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copiado ? "Copiado" : "Copiar todos"}
        </button>
        <button
          type="button"
          onClick={aoConfirmar}
          className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Guardei os códigos
        </button>
      </div>
    </div>
  );
}

export default function SegundoFator() {
  const [status, setStatus] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cadastro, setCadastro] = useState(null); // { qrSvg, segredoParaDigitacao }
  const [codigosNovos, setCodigosNovos] = useState(null);

  const carregarStatus = async () => {
    try {
      const { data } = await api.get("/auth/totp");
      setStatus(data);
    } catch {
      toast.error("Não foi possível carregar o status da verificação em duas etapas.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarStatus();
  }, []);

  const limpar = () => {
    setSenha("");
    setCodigo("");
    setCadastro(null);
  };

  const erroDe = (err, padrao) => toast.error(err.response?.data?.error || padrao);

  const iniciar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const { data } = await api.post("/auth/totp/setup", { senha });
      setCadastro(data);
      setSenha("");
    } catch (err) {
      erroDe(err, "Não foi possível iniciar o cadastro.");
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const { data } = await api.post("/auth/totp/enable", { codigo: codigo.trim() });
      setCodigosNovos(data.codigosDeRecuperacao);
      limpar();
      await carregarStatus();
      toast.success("Verificação em duas etapas ativada.");
    } catch (err) {
      setCodigo("");
      erroDe(err, "Código inválido.");
    } finally {
      setOcupado(false);
    }
  };

  const desativar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      await api.post("/auth/totp/disable", { senha, codigo: codigo.trim() });
      limpar();
      await carregarStatus();
      // As outras sessões são revogadas no servidor, inclusive a atual: sem o
      // aviso, o próximo clique devolveria um 401 sem explicação.
      toast.success("Verificação desativada. Entre novamente para continuar.");
    } catch (err) {
      erroDe(err, "Não foi possível desativar.");
    } finally {
      setOcupado(false);
    }
  };

  const regerar = async (e) => {
    e.preventDefault();
    setOcupado(true);
    try {
      const { data } = await api.post("/auth/totp/recovery-codes", {
        senha,
        codigo: codigo.trim(),
      });
      setCodigosNovos(data.codigosDeRecuperacao);
      limpar();
      await carregarStatus();
    } catch (err) {
      erroDe(err, "Não foi possível gerar novos códigos.");
    } finally {
      setOcupado(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
      </div>
    );
  }

  if (codigosNovos) {
    return <CodigosDeRecuperacao codigos={codigosNovos} aoConfirmar={() => setCodigosNovos(null)} />;
  }

  // ── Ativo ────────────────────────────────────────────────────────────────
  if (status?.ativo) {
    const poucosCodigos = status.codigosDeRecuperacaoRestantes <= 2;
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <span className="text-foreground font-medium">Ativa</span>
          <span className={poucosCodigos ? "text-amber-500" : "text-zinc-500"}>
            · {status.codigosDeRecuperacaoRestantes} código(s) de recuperação restante(s)
          </span>
        </div>

        <form onSubmit={desativar} className="space-y-3">
          <p className="text-sm text-zinc-400">
            Para desativar ou gerar novos códigos, confirme a senha e um código do aplicativo.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoSenha
              label="Senha"
              type="password"
              valor={senha}
              onChange={setSenha}
              required
              autoComplete="current-password"
            />
            <CampoSenha
              label="Código do aplicativo"
              valor={codigo}
              onChange={setCodigo}
              required
              inputMode="numeric"
              placeholder="000000"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={ocupado}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Desativar
            </button>
            <button
              type="button"
              onClick={regerar}
              disabled={ocupado}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-surface-border text-sm text-zinc-300 hover:text-foreground transition-colors disabled:opacity-50"
            >
              Gerar novos códigos de recuperação
            </button>
          </div>
          {status.obrigatorio && (
            <p className="text-xs text-amber-500/90">
              Sua conta administra a plataforma: desativar bloqueia o acesso ao painel
              administrativo até você cadastrar um aplicativo novamente.
            </p>
          )}
        </form>
      </div>
    );
  }

  // ── Cadastro em andamento ────────────────────────────────────────────────
  if (cadastro) {
    return (
      <form onSubmit={confirmar} className="space-y-4">
        <p className="text-sm text-zinc-400">
          Leia o código abaixo no seu aplicativo autenticador (Google Authenticator, Authy,
          1Password, Bitwarden) e informe o número de 6 dígitos que ele mostrar.
        </p>

        {/*
          O QR entra como IMAGEM, e não como HTML injetado.

          O SVG vem pronto do servidor, mas usá-lo com `dangerouslySetInnerHTML`
          traria markup de fora para dentro da árvore do React e quebraria uma
          propriedade que a auditoria verificou e registrou: o projeto não tem
          nenhuma ocorrência dessa API. Como `data:` URI o conteúdo é tratado
          como imagem pelo navegador, sem executar nada, e a propriedade
          continua valendo.
        */}
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(cadastro.qrSvg)}`}
          alt="QR code para cadastrar o aplicativo autenticador"
          width={220}
          height={220}
          className="inline-block rounded-xl bg-white p-3"
        />

        <div className="text-sm">
          <p className="text-zinc-400">Não consegue ler o código? Digite esta chave no aplicativo:</p>
          <code className="mt-1 block font-mono text-foreground tracking-wider break-all">
            {cadastro.segredoParaDigitacao}
          </code>
        </div>

        <CampoSenha
          label="Código do aplicativo"
          valor={codigo}
          onChange={setCodigo}
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={ocupado}
            className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
            Ativar
          </button>
          <button
            type="button"
            onClick={limpar}
            className="px-4 py-2.5 rounded-lg border border-surface-border text-sm text-zinc-300 hover:text-foreground transition-colors"
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  // ── Inativo ──────────────────────────────────────────────────────────────
  return (
    <form onSubmit={iniciar} className="space-y-4">
      {status?.obrigatorio ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-zinc-300">
            <span className="font-medium text-foreground">Obrigatória para esta conta.</span> O
            painel administrativo concede crédito, suspende escritórios e edita preços, e por isso
            exige verificação em duas etapas além da restrição de origem por IP.
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">
          Acrescenta um código de 6 dígitos, gerado no seu celular, ao login. Uma senha vazada
          deixa de ser suficiente para entrar na sua conta.
        </p>
      )}

      <CampoSenha
        label="Confirme sua senha para começar"
        type="password"
        valor={senha}
        onChange={setSenha}
        required
        autoComplete="current-password"
      />

      <button
        type="submit"
        disabled={ocupado}
        className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
        Cadastrar aplicativo
      </button>
    </form>
  );
}
