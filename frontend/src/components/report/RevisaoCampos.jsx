import { useState, useMemo } from "react";
import { ClipboardCheck, AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/axios.js";
import { Note } from "../UiComponents.jsx";

/**
 * § 0 — conferência do operador, antes de emitir o laudo.
 *
 * ─── Por que esta etapa existe ───────────────────────────────────────────────
 *
 * A extração é heurística e frágil a formato novo: três documentos de bancos
 * diferentes revelaram três falhas distintas, todas de interpretação. Corrigir
 * cada padrão é necessário e nunca vai cobrir o próximo banco.
 *
 * Deixar o operador conferir resolve por outro caminho, e um que FORTALECE a
 * peça: o laudo deixa de ser saída de heurística e passa a ser saída conferida
 * por pessoa identificada. Os Termos de Uso já dizem que o laudo depende de
 * conferência humana; aqui a exigência vira registro no próprio documento.
 *
 * ─── O que a tela prioriza ───────────────────────────────────────────────────
 *
 * O que NÃO foi encontrado vem primeiro e em destaque. Um campo vazio no meio de
 * vinte preenchidos passa despercebido, e é justamente o vazio que pede ação.
 * Campo crítico ausente ganha aviso próprio, porque a falta dele muda a
 * conclusão do laudo, e não apenas a apresentação.
 */

const CAMPOS = [
  { caminho: "cliente.nome", rotulo: "Nome do contratante", grupo: "Contratante", critico: true },
  { caminho: "cliente.cpf", rotulo: "CPF do contratante", grupo: "Contratante", critico: true },
  { caminho: "contrato.banco", rotulo: "Instituição financeira", grupo: "Contrato", critico: true },
  { caminho: "contrato.numero", rotulo: "Número do contrato", grupo: "Contrato" },
  { caminho: "contrato.valor_contratado", rotulo: "Valor contratado", grupo: "Contrato" },
  { caminho: "contrato.numero_parcelas", rotulo: "Parcelas", grupo: "Contrato" },
  {
    caminho: "assinatura.data_hora_assinatura",
    rotulo: "Data e hora da assinatura",
    grupo: "Assinatura",
    critico: true,
  },
  {
    caminho: "geolocalizacao_assinatura.latitude",
    rotulo: "Latitude declarada",
    grupo: "Geolocalização",
    critico: true,
    dica: "Formato: -7.115",
  },
  {
    caminho: "geolocalizacao_assinatura.longitude",
    rotulo: "Longitude declarada",
    grupo: "Geolocalização",
    critico: true,
    dica: "Formato: -34.86306",
  },
  {
    caminho: "ips.0.endereco",
    rotulo: "Endereço IP da assinatura",
    grupo: "Conexão",
    critico: true,
    dica: "IPv4 ou IPv6, como consta no documento",
  },
];

function ler(objeto, caminho) {
  return caminho.split(".").reduce((a, p) => (a == null ? undefined : a[p]), objeto);
}

export default function RevisaoCampos({ analysisId, extracted, revisados, onAtualizado }) {
  const [valores, setValores] = useState(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.caminho, ler(extracted, c.caminho) ?? ""]))
  );
  const [erros, setErros] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const originais = useMemo(
    () => Object.fromEntries(CAMPOS.map((c) => [c.caminho, ler(extracted, c.caminho) ?? ""])),
    [extracted]
  );

  const faltando = CAMPOS.filter((c) => !originais[c.caminho]);
  const faltandoCriticos = faltando.filter((c) => c.critico);
  const alterados = CAMPOS.filter((c) => (valores[c.caminho] || "") !== (originais[c.caminho] || ""));

  const salvar = async () => {
    const campos = Object.fromEntries(alterados.map((c) => [c.caminho, valores[c.caminho]]));
    setSalvando(true);
    setErros({});
    try {
      const { data } = await api.patch(`/analyses/${analysisId}/fields`, { campos });
      toast.success(
        `${data.alterados.length} campo(s) conferido(s). O laudo já reflete a correção.`
      );
      onAtualizado?.(data.result);
    } catch (err) {
      // O servidor devolve TODOS os erros de uma vez, para o operador não
      // corrigir um campo por vez com uma ida ao servidor para cada.
      const porCampo = err.response?.data?.campos;
      if (porCampo) {
        setErros(porCampo);
        toast.error("Há campos inválidos. Veja as marcações abaixo.");
      } else {
        toast.error(err.response?.data?.error || "Não foi possível salvar a conferência.");
      }
    } finally {
      setSalvando(false);
    }
  };

  const grupos = [...new Set(CAMPOS.map((c) => c.grupo))];

  return (
    <div
      data-report-block
      className="mb-6 rounded-2xl border border-primary/25 bg-primary/[0.04] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="text-[15px] font-bold text-foreground">
              Conferência antes de emitir o laudo
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
              A extração é automatizada e pode não localizar um campo quando o banco usa um
              formato diferente. Confira e complete o que faltar: o laudo registra o que foi
              conferido por você.
            </p>
          </div>
        </div>

        <button
          onClick={() => setAberto((v) => !v)}
          className="shrink-0 rounded-full border border-surface-border px-4 py-1.5 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-surface"
        >
          {aberto ? "Ocultar" : "Conferir campos"}
        </button>
      </div>

      {/* O que faltou vem primeiro: campo vazio no meio de vinte preenchidos
          passa despercebido, e é o vazio que pede ação. */}
      {faltandoCriticos.length > 0 && (
        <Note tone="warn">
          <strong>{faltandoCriticos.length} campo(s) essencial(is) não localizado(s):</strong>{" "}
          {faltandoCriticos.map((c) => c.rotulo.toLowerCase()).join("; ")}. A ausência muda a
          conclusão do laudo, não só a apresentação.
        </Note>
      )}

      {faltandoCriticos.length === 0 && faltando.length === 0 && !aberto && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-emerald-500">
          <CheckCircle2 className="h-4 w-4" />
          Todos os campos foram localizados. A conferência continua recomendada.
        </p>
      )}

      {aberto && (
        <div className="mt-5 space-y-5">
          {grupos.map((grupo) => (
            <div key={grupo}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                {grupo}
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {CAMPOS.filter((c) => c.grupo === grupo).map((c) => {
                  const vazio = !originais[c.caminho];
                  const erro = erros[c.caminho];
                  const jaRevisado = revisados?.[c.caminho];
                  return (
                    <div key={c.caminho}>
                      <label className="flex items-center gap-1.5 text-[12.5px] text-zinc-400">
                        {c.rotulo}
                        {c.critico && <span className="text-primary">*</span>}
                        {vazio && (
                          <span className="flex items-center gap-1 text-[11px] text-amber-500">
                            <AlertTriangle className="h-3 w-3" />
                            não localizado
                          </span>
                        )}
                      </label>
                      <input
                        value={valores[c.caminho]}
                        onChange={(e) =>
                          setValores((v) => ({ ...v, [c.caminho]: e.target.value }))
                        }
                        placeholder={c.dica || "Informe o valor conforme o documento"}
                        className={`mt-1 w-full rounded-lg border bg-background px-3 py-2 text-[13.5px] text-foreground placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-primary ${
                          erro ? "border-red-500/60" : "border-surface-border"
                        }`}
                      />
                      {erro && <p className="mt-1 text-[11.5px] text-red-400">{erro}</p>}
                      {jaRevisado && !erro && (
                        <p className="mt-1 text-[11.5px] text-emerald-500">
                          Conferido em {new Date(jaRevisado.em).toLocaleString("pt-BR")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
            <p className="text-[12.5px] text-zinc-500">
              {alterados.length === 0
                ? "Nenhuma alteração pendente."
                : `${alterados.length} campo(s) alterado(s), aguardando confirmação.`}
            </p>
            <button
              onClick={salvar}
              disabled={salvando || alterados.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13px] font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {salvando ? "Salvando..." : "Confirmar conferência"}
            </button>
          </div>

          <p className="text-[11.5px] leading-relaxed text-zinc-500">
            O laudo declara quais campos foram conferidos por você, com data e hora. Isso não
            enfraquece a peça: um dado conferido por pessoa identificada tem mais peso que um
            extraído automaticamente.
          </p>
        </div>
      )}
    </div>
  );
}
