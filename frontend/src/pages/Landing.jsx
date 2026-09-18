import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  FileSearch, ShieldCheck, MapPin, Calculator, ListChecks, Scale, Ban, FileQuestion,
  ChevronRight, ChevronDown, CheckCircle2, Loader2,
} from "lucide-react";
import Header from "../components/Layout/Header";
import { api } from "../lib/axios";
import logoImg from "../assets/logo.png";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/*
  Este texto é publicidade, e pelo CDC (art. 30) ela VINCULA o fornecedor e
  integra o contrato. Publicidade que promete mais do que os Termos de Uso
  entregam derruba a limitação de responsabilidade em vez de conviver com ela.

  Por isso, cada frase desta página foi conferida no código:
  - não há IA no sistema: a extração é textual e o OCR (Tesseract) é local;
  - o limite de upload é de tamanho (MAX_PDF_MB, 30 MB), não de páginas;
  - contrato escaneado leva minutos, não segundos (OCR medido em até 112 s);
  - o PDF do laudo não recebe assinatura digital;
  - divergência é indício, NÃO prova de fraude, como o próprio laudo declara.
  A copy completa, com anotações, está em `copy-landing-page.md` na raiz do
  Forense_DOC. Mudou o produto, confira a página.
*/

/**
 * Preços e limites vêm sempre de `GET /billing/plans` (L3).
 *
 * Aqui ficam apenas os textos de marketing, que não têm equivalente no banco:
 * o público-alvo e os diferenciais qualitativos. Tudo que é número — preço,
 * laudos/mês, usuários — é lido da API, porque o admin pode alterar em runtime
 * via `PATCH /admin/plans/:id` e qualquer valor fixo aqui viraria propaganda
 * enganosa na primeira edição.
 */
const PLAN_COPY = {
  inicial: {
    tagline: "Para quem está começando a periciar.",
    features: ["Histórico ilimitado", "Laudo em PDF", "Suporte padrão"],
  },
  profissional: {
    tagline: "Para advogados independentes.",
    features: ["Histórico ilimitado", "Laudo em PDF", "Suporte prioritário"],
  },
  escritorio: {
    tagline: "Para bancas em crescimento.",
    features: ["Equipe com saldo compartilhado", "Histórico ilimitado", "Suporte prioritário"],
  },
  massa: {
    tagline: "Para litígio de massa.",
    features: ["Equipe com saldo compartilhado", "Volume alto de laudos", "Suporte dedicado"],
  },
};

// Plano-âncora da tabela 3.2 do PRD — recebe o destaque visual.
const HIGHLIGHT_SLUG = "profissional";

const TAREFAS = [
  { icon: ShieldCheck, title: "Hash do arquivo", desc: "Conferir o hash declarado contra o arquivo recebido." },
  { icon: MapPin, title: "GPS, IP e endereço", desc: "Medir a distância entre o GPS da assinatura, o IP e a casa do cliente." },
  { icon: Calculator, title: "Contas da operação", desc: "Refazer carência, CET e prêmio do seguro a partir da planilha." },
];

const EXAMES = [
  {
    icon: ShieldCheck,
    title: "Integridade do arquivo",
    desc: "SHA-256 calculado sobre o PDF recebido e comparado com o hash que o documento declara. Quando o valor declarado nem é um hash, como um UUID, o laudo diz isso.",
  },
  {
    icon: MapPin,
    title: "Onde a assinatura aconteceu",
    desc: "GPS do aceite, IPs da trilha, endereço do contrato e endereço que você informa são medidos em pares, com mapa. Par sem os dois pontos sai como não aferido, nunca como zero.",
  },
  {
    icon: ListChecks,
    title: "Trilha de eventos e autenticação",
    desc: "Cada evento transcrito com data, hora e IP. Um método de autenticação só aparece no laudo quando o documento o descreve como etapa da contratação.",
  },
  {
    icon: Calculator,
    title: "As contas da operação",
    desc: "Carência, prazo efetivo, CET implícito e prêmio do seguro prestamista refeitos a partir da planilha do próprio contrato.",
  },
  {
    icon: FileSearch,
    title: "Metadados e fundamentação",
    desc: "Autor, programa gerador, datas e assinatura digital incorporada ao PDF, com as normas aplicáveis citadas junto do achado que as aciona.",
  },
];

const PASSOS = [
  {
    num: "01",
    title: "Envie o contrato",
    desc: "PDF de até 30 MB. Documento escaneado passa por OCR automaticamente.",
  },
  {
    num: "02",
    title: "Informe o endereço do cliente",
    desc: "É a referência para medir as distâncias. Se ele divergir do endereço do contrato, o laudo registra a divergência em vez de escolher um lado.",
  },
  {
    num: "03",
    title: "Baixe o laudo em PDF",
    desc: "Um contrato com texto pesquisável costuma ficar pronto em segundos. Um escaneado leva alguns minutos.",
  },
];

const POSTURA = [
  {
    icon: Scale,
    title: "Divergência é indício, não prova.",
    desc: "O laudo descreve o que o documento mostra. A conclusão jurídica é sua.",
  },
  {
    icon: Ban,
    title: "Sem inteligência artificial.",
    desc: "A leitura é textual e o OCR roda nos nossos servidores. O texto do contrato não é enviado a nenhum modelo de linguagem.",
  },
  {
    icon: FileQuestion,
    title: "Lacuna declarada, nunca preenchida.",
    desc: "Quando o material não traz a informação, o laudo escreve “não localizado no material”.",
  },
];

const PERGUNTAS = [
  {
    pergunta: "Funciona com contrato escaneado?",
    resposta: "Sim. O OCR é aplicado automaticamente. Digitalização ruim reduz o que dá para ler, e o laudo não inventa o que não conseguiu ler.",
  },
  {
    pergunta: "Quais bancos o ForenseDoc aceita?",
    resposta: "Contratos de crédito consignado em PDF, de bancos e financeiras. A instituição é identificada pelo CNPJ que consta no documento.",
  },
  {
    pergunta: "Posso juntar o laudo ao processo?",
    resposta: "O laudo é um documento técnico em PDF que identifica o arquivo examinado pelo SHA-256. Como e quando usá-lo na causa é decisão sua.",
  },
  {
    pergunta: "O que acontece depois dos 3 laudos grátis?",
    resposta: "Você compra laudos avulsos quando precisar ou assina um plano mensal. Os valores estão logo abaixo.",
  },
];

function formatBRL(value) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export default function Landing() {
  const container = useRef(null);

  const [plans, setPlans] = useState([]);
  const [avulsoPrice, setAvulsoPrice] = useState(null);
  const [pricingState, setPricingState] = useState("loading"); // loading | ready | error

  useEffect(() => {
    api
      .get("/billing/plans")
      .then(({ data }) => {
        // O plano fundador nunca entra na vitrine pública: só é alcançável
        // pelo link com código de convite (ver L1).
        setPlans(data.plans.filter((p) => !p.isFounder));
        setAvulsoPrice(data.avulso?.priceBrl ?? null);
        setPricingState("ready");
      })
      .catch(() => setPricingState("error"));
  }, []);

  useGSAP(() => {
    // Hero Animations
    const tl = gsap.timeline();
    tl.from(".hero-badge", { y: -20, opacity: 0, duration: 0.6, ease: "back.out(1.7)" })
      .from(".hero-title", { y: 30, opacity: 0, duration: 0.8, ease: "power3.out" }, "-=0.2")
      .from(".hero-desc", { y: 20, opacity: 0, duration: 0.6, ease: "power2.out" }, "-=0.4")
      .from(".hero-cta", { y: 20, opacity: 0, duration: 0.5, stagger: 0.1, ease: "power2.out" }, "-=0.2")
      .from(".hero-image", { y: 40, opacity: 0, duration: 1, ease: "power3.out" }, "-=0.4");

    // Scroll Animations for Sections
    gsap.utils.toArray(".fade-up").forEach((element) => {
      gsap.from(element, {
        scrollTrigger: {
          trigger: element,
          start: "top 85%",
        },
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
      });
    });

    // Staggered Cards: cada grade dispara os próprios cards, porque agora há
    // mais de uma na página (problema, exames e postura).
    gsap.utils.toArray(".features-grid").forEach((grid) => {
      gsap.from(grid.querySelectorAll(".feature-card"), {
        scrollTrigger: {
          trigger: grid,
          start: "top 80%",
        },
        y: 30,
        opacity: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power2.out",
      });
    });

  }, { scope: container });

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden" ref={container}>
      <Header />

      {/* ─── HERO SECTION ──────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-4 flex flex-col items-center text-center">
        {/* Background Effects */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

        <div className="hero-badge inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-surface-border text-sm text-zinc-300 mb-8 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Perícia digital de contratos de consignado
        </div>

        <h1 className="hero-title text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight max-w-4xl mb-6 leading-tight">
          Mostre ao juiz onde, quando e como{" "}
          <span className="text-gradient">o consignado foi assinado.</span>
        </h1>

        <p className="hero-desc text-lg md:text-xl text-zinc-400 max-w-2xl mb-10 leading-relaxed">
          Envie o PDF do contrato. O ForenseDoc confere a integridade do arquivo, cruza o GPS da
          assinatura com os IPs da trilha e o endereço do seu cliente, refaz as contas da operação e
          entrega um laudo em que cada achado cita a página de onde saiu.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4 hero-cta">
          <Link
            to="/register"
            className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 bg-foreground text-background font-semibold rounded-full hover:bg-zinc-200 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_30px_rgba(255,255,255,0.25)] hover:-translate-y-1"
          >
            Gerar meus 3 laudos grátis
            <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href="#solucao"
            className="px-8 py-4 rounded-full text-zinc-300 font-medium hover:text-white transition-colors"
          >
            Ver o que o laudo examina
          </a>
        </div>
        <p className="hero-cta mt-6 text-sm text-zinc-500">Sem cartão de crédito. O cadastro já vem com 3 laudos.</p>

        {/* Dashboard Mockup - Abstract Representation */}
        <div className="hero-image mt-20 relative w-full max-w-5xl rounded-xl border border-surface-border bg-surface/50 p-2 shadow-2xl backdrop-blur-sm">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10" />
          <div className="rounded-lg overflow-hidden border border-surface-border/50 bg-[#121214] aspect-[16/9] flex items-center justify-center relative">
            {/* Elementos abstratos de UI */}
            <div className="absolute top-4 left-4 right-4 flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/20" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
              <div className="w-3 h-3 rounded-full bg-green-500/20" />
            </div>
            <div className="w-3/4 max-w-lg space-y-4">
              <div className="h-8 bg-surface-border/30 rounded w-1/3 animate-pulse" />
              <div className="h-4 bg-surface-border/20 rounded w-full" />
              <div className="h-4 bg-surface-border/20 rounded w-5/6" />
              <div className="h-4 bg-surface-border/20 rounded w-4/6" />

              <div className="mt-8 p-4 rounded-lg bg-primary/10 border border-primary/20 flex gap-4">
                <FileSearch className="w-8 h-8 text-primary shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-primary/30 rounded w-1/4" />
                  <div className="h-3 bg-primary/20 rounded w-full" />
                  <div className="h-3 bg-primary/20 rounded w-2/3" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PROBLEM & AGITATE ─────────────────────────────────────────────────── */}
      <section id="problema" className="py-24 px-4 bg-surface/30 border-y border-surface-border">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-6 fade-up">
            No consignado digital, <span className="text-red-400">a assinatura é um rastro de dados.</span>
          </h2>
          <p className="text-lg text-zinc-400 mb-12 fade-up">
            Não existe caneta para periciar. O que sustenta a contratação está espalhado pelo PDF: o hash
            declarado, a selfie, a geolocalização do aceite, os IPs da trilha de eventos, a planilha de
            cálculo. Conferir tudo à mão, contrato por contrato, toma horas, e um número lido errado vira
            argumento do banco.
          </p>

          <div className="grid md:grid-cols-3 gap-6 features-grid text-left mt-16">
            {TAREFAS.map((item) => (
              <div key={item.title} className="feature-card glass p-6 rounded-xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-surface-border mb-4 text-primary">
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-zinc-400 mt-12 fade-up">
            Cada contrato pede as três, e cada uma pede uma ferramenta diferente.
          </p>
        </div>
      </section>

      {/* ─── O QUE O LAUDO EXAMINA ─────────────────────────────────────────────── */}
      <section id="solucao" className="py-24 px-4 scroll-mt-16">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 fade-up">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Um laudo, cinco exames, <span className="text-gradient">cada achado com a página ao lado.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 features-grid">
            {EXAMES.map((item) => (
              <div key={item.title} className="feature-card glass p-6 rounded-xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-surface-border mb-4 text-primary">
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────────────────────────────────── */}
      <section id="como-funciona" className="py-24 px-4 bg-surface/30 border-y border-surface-border scroll-mt-16">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 fade-up">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Do PDF ao laudo em três passos</h2>
          </div>

          <div className="space-y-12 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-surface-border before:to-transparent">
            {PASSOS.map((step) => (
              <div key={step.num} className={`relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group fade-up`}>
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background bg-primary text-white font-bold shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] z-10">
                  {step.num}
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] glass p-6 md:p-8 rounded-2xl border-surface-border group-hover:border-primary/30 transition-colors">
                  <h3 className="text-2xl font-bold mb-3">{step.title}</h3>
                  <p className="text-zinc-400 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── POSTURA E PERGUNTAS ───────────────────────────────────────────────── */}
      <section id="postura" className="py-24 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16 fade-up">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              O que o laudo afirma, <span className="text-gradient">e o que ele deixa com você.</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 features-grid">
            {POSTURA.map((item) => (
              <div key={item.title} className="feature-card glass p-6 rounded-xl relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center border border-surface-border mb-4 text-primary">
                  <item.icon className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="max-w-3xl mx-auto mt-20">
            <h3 className="text-2xl md:text-3xl font-bold mb-8 text-center fade-up">Perguntas frequentes</h3>
            <div className="space-y-4">
              {PERGUNTAS.map((q) => (
                <details key={q.pergunta} className="fade-up glass rounded-xl group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 font-semibold [&::-webkit-details-marker]:hidden">
                    {q.pergunta}
                    <ChevronDown className="w-5 h-5 text-primary shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-6 pb-6 text-zinc-400 leading-relaxed">{q.resposta}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── PRICING ───────────────────────────────────────────────────────────── */}
      <section id="planos" className="py-24 px-4 bg-surface/30 border-y border-surface-border">
        <div className="container mx-auto max-w-6xl text-center">
          <h2 className="text-3xl md:text-5xl font-bold mb-4 fade-up">Pague por laudo ou assine um plano</h2>
          <p className="text-zinc-400 text-lg mb-16 max-w-2xl mx-auto fade-up">
            Compre laudos avulsos quando precisar, ou assine um plano para ter laudos todo mês.
          </p>

          {pricingState === "loading" && (
            <div className="flex justify-center py-16 fade-up">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          )}

          {/* Se a API falhar, nenhum preço é exibido. Mostrar um valor de
              reserva seria pior que não mostrar: um número errado na vitrine
              vira promessa que o checkout não cumpre. */}
          {pricingState === "error" && (
            <div className="max-w-md mx-auto glass rounded-2xl border border-surface-border p-8 fade-up">
              <p className="text-zinc-300 font-medium">Não conseguimos carregar os planos agora.</p>
              <p className="text-zinc-500 text-sm mt-2">
                Crie sua conta para ver os valores atualizados. O cadastro é gratuito e inclui 3 laudos.
              </p>
              <Link
                to="/register"
                className="inline-block mt-6 px-6 py-3 rounded-full bg-primary hover:bg-blue-600 text-white font-medium transition-colors"
              >
                Criar conta grátis
              </Link>
            </div>
          )}

          {pricingState === "ready" && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto fade-up">
              {plans.map((plan) => {
                const copy = PLAN_COPY[plan.slug] || { tagline: "", features: [] };
                const destaque = plan.slug === HIGHLIGHT_SLUG;

                return (
                  <div
                    key={plan.id}
                    className={
                      destaque
                        ? "glass p-8 rounded-3xl border-primary/50 bg-primary/5 relative flex flex-col text-left shadow-[0_0_30px_rgba(59,130,246,0.15)]"
                        : "glass p-8 rounded-3xl border-surface-border flex flex-col text-left"
                    }
                  >
                    {destaque && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider whitespace-nowrap">
                        Recomendado
                      </div>
                    )}
                    <div className="mb-8">
                      <h3 className={`text-2xl font-bold mb-2 ${destaque ? "text-primary" : ""}`}>{plan.name}</h3>
                      <p className="text-zinc-400 text-sm">{copy.tagline}</p>
                    </div>
                    <div className="mb-8 flex items-baseline gap-2">
                      <span className="text-5xl font-bold">{formatBRL(plan.priceBrl)}</span>
                      <span className="text-zinc-500">/mês</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                      {/* Os dois primeiros itens são números do banco: nunca
                          divergem do que o checkout cobra. */}
                      <li className="flex items-center gap-3 text-zinc-300">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                        {plan.creditsMonthly} laudos por mês
                      </li>
                      <li className="flex items-center gap-3 text-zinc-300">
                        <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                        {plan.maxUsers === 1 ? "1 usuário" : `Até ${plan.maxUsers} usuários`}
                      </li>
                      {copy.features.map((feat, i) => (
                        <li key={i} className="flex items-center gap-3 text-zinc-300">
                          <CheckCircle2 className="w-5 h-5 text-primary shrink-0" /> {feat}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/register"
                      className={
                        destaque
                          ? "w-full py-3 rounded-full bg-primary hover:bg-blue-600 text-white text-center font-medium transition-colors shadow-lg shadow-primary/25"
                          : "w-full py-3 rounded-full border border-surface-border hover:bg-surface text-center font-medium transition-colors"
                      }
                    >
                      Assinar o {plan.name}
                    </Link>
                  </div>
                );
              })}

              {avulsoPrice != null && (
                <div className="glass p-8 rounded-3xl border-surface-border flex flex-col text-left">
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold mb-2">Laudo avulso</h3>
                    <p className="text-zinc-400 text-sm">Sem mensalidade.</p>
                  </div>
                  <div className="mb-8 flex items-baseline gap-2">
                    <span className="text-5xl font-bold">{formatBRL(avulsoPrice)}</span>
                    <span className="text-zinc-500">/laudo</span>
                  </div>
                  <ul className="space-y-4 mb-8 flex-1">
                    {[
                      "Compre quando precisar",
                      "O crédito não expira",
                      "Assinantes pagam menos",
                    ].map((feat, i) => (
                      <li key={i} className="flex items-center gap-3 text-zinc-300">
                        <CheckCircle2 className="w-5 h-5 text-zinc-500 shrink-0" /> {feat}
                      </li>
                    ))}
                  </ul>
                  <Link to="/register" className="w-full py-3 rounded-full border border-surface-border hover:bg-surface text-center font-medium transition-colors">
                    Comprar laudo avulso
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ─── CTA FOOTER ────────────────────────────────────────────────────────── */}
      <section className="py-32 px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[300px] bg-primary/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="container mx-auto max-w-3xl text-center relative z-10 fade-up">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">Faça o primeiro laudo com um contrato que você já conhece.</h2>
          <p className="text-xl text-zinc-400 mb-10">
            O cadastro é gratuito e inclui 3 laudos. Escolha um caso que você estudou a fundo e compare o que o
            laudo encontrou com o que você já sabe.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center justify-center gap-2 px-10 py-5 bg-foreground text-background font-bold rounded-full hover:bg-zinc-200 transition-all duration-300 shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-105"
          >
            Gerar meus 3 laudos grátis
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-surface-border bg-background px-4 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-sm text-zinc-500 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <img src={logoImg} alt="ForenseDoc" className="h-6 w-auto object-contain opacity-75" />
            <p>© {new Date().getFullYear()} ForenseDoc. Todos os direitos reservados.</p>
          </div>

          {/* Os dois documentos precisam ser alcançáveis SEM login: quem ainda
              não é cliente lê antes de decidir, e o titular de dado que aparece
              num contrato analisado nunca terá conta aqui. */}
          <nav className="flex items-center gap-5">
            <Link to="/termos" className="transition-colors hover:text-foreground">
              Termos de Uso
            </Link>
            <Link to="/privacidade" className="transition-colors hover:text-foreground">
              Política de Privacidade
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
