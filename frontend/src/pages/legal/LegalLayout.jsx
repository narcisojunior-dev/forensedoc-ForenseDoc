import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";

/**
 * Moldura das páginas jurídicas (termos de uso e política de privacidade).
 *
 * São páginas PÚBLICAS: precisam abrir sem sessão, porque quem ainda não é
 * cliente tem que poder ler antes de decidir, e porque o titular de dado que
 * aparece num contrato analisado não tem conta aqui e mesmo assim precisa saber
 * como o tratamento acontece (LGPD, art. 9º).
 *
 * A leitura é longa por natureza, então o texto fica numa coluna estreita e a
 * data de vigência aparece no topo: quem revisita procura o que mudou.
 */
export const VIGENCIA = "31 de julho de 2026";

/*
 * A plataforma se identifica por si: o laudo e as páginas públicas respondem
 * pelo ForenseDoc, não por um escritório. Mesma decisão de
 * backend/src/reports/laudoTexts.js (FIRM).
 */
export const FIRM = {
  nome: "ForenseDoc",
  descricao: "verificação técnica e validação de cadeia de custódia documental",
  sistema: "ForenseDoc",
};

export function Secao({ numero, titulo, children }) {
  return (
    <section className="mt-10 scroll-mt-24" id={`secao-${numero}`}>
      <h2 className="text-[17px] font-bold text-foreground">
        <span className="text-primary">{numero}.</span> {titulo}
      </h2>
      <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-zinc-300">{children}</div>
    </section>
  );
}

/** Destaque para o que o leitor precisa notar mesmo lendo em diagonal. */
export function Destaque({ children, tom = "info" }) {
  const cor =
    tom === "alerta"
      ? "border-amber-500/30 bg-amber-500/[0.06]"
      : "border-primary/25 bg-primary/[0.05]";
  return (
    <div className={`my-4 rounded-xl border px-5 py-4 text-[14px] leading-relaxed ${cor}`}>
      {children}
    </div>
  );
}

export function Tabela({ cabecalho, linhas }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-surface-border">
      <table className="w-full text-left text-[13.5px]">
        <thead className="bg-surface/50">
          <tr>
            {cabecalho.map((c) => (
              <th key={c} className="px-4 py-2.5 font-semibold text-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i} className="border-t border-surface-border/60">
              {linha.map((celula, j) => (
                <td key={j} className="px-4 py-2.5 align-top text-zinc-300">
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalLayout({ titulo, resumo, children }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-surface-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar ao início
          </Link>
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {FIRM.sistema}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-bold sm:text-3xl">{titulo}</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Em vigor desde {VIGENCIA}</p>

        {resumo && (
          <div className="mt-6 rounded-xl border border-surface-border bg-surface/30 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Em resumo
            </p>
            <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-zinc-300">{resumo}</div>
          </div>
        )}

        {children}

        <footer className="mt-14 border-t border-surface-border pt-6 text-[13px] text-zinc-500">
          <p>
            {FIRM.sistema}: {FIRM.descricao}.
          </p>
          <p className="mt-2">
            Dúvidas sobre este documento ou sobre tratamento de dados pessoais:{" "}
            <a href="mailto:contato@forensedoc.com.br" className="text-primary hover:underline">
              contato@forensedoc.com.br
            </a>
          </p>
          <div className="mt-4 flex gap-4">
            <Link to="/termos" className="hover:text-foreground">
              Termos de Uso
            </Link>
            <Link to="/privacidade" className="hover:text-foreground">
              Política de Privacidade
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
