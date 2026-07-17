import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Scale, Fingerprint, MapPin, Navigation2, ArrowRight, Sparkles } from "lucide-react";
import { useAuthStore } from "../store/authStore";

const TOUR_CARDS = [
  {
    icon: Fingerprint,
    title: "Hash forense (SHA-256 / SHA-1)",
    description: "Calculamos a impressão digital criptográfica do arquivo original e conferimos contra o hash declarado no documento, quando existir.",
  },
  {
    icon: MapPin,
    title: "Geolocalização de IP",
    description: "Cada endereço IP encontrado no contrato é geolocalizado e comparado com o endereço residencial do cliente.",
  },
  {
    icon: Navigation2,
    title: "Confronto de GPS da assinatura",
    description: "Se o documento traz coordenadas GPS do momento da assinatura, calculamos a distância até a residência declarada.",
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const finish = () => {
    if (user) localStorage.setItem(`onboarding_seen_${user.id}`, "1");
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center py-12 px-4 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 w-full max-w-2xl">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
            <Scale className="w-6 h-6 text-primary" />
          </div>
          <span className="font-bold text-2xl tracking-tight text-foreground">
            Forense<span className="text-primary">Doc</span>
          </span>
        </div>

        <div className="glass p-8 sm:p-10 rounded-2xl border border-surface-border shadow-2xl">
          {step === 0 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="w-8 h-8 text-accent" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-3">Bem-vindo(a), {user?.name?.split(" ")[0]}!</h1>
              <p className="text-zinc-400 leading-relaxed">
                Sua conta já está pronta e você tem <strong className="text-foreground">3 laudos periciais gratuitos</strong> para
                testar o ForenseDoc sem compromisso. Vamos te mostrar rapidamente como funciona.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="animate-fade-in">
              <h2 className="text-xl font-bold text-foreground text-center mb-2">O que o motor de análise faz</h2>
              <p className="text-zinc-400 text-center mb-8 text-sm">Três verificações forenses automáticas em cada contrato enviado.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {TOUR_CARDS.map((card) => (
                  <div key={card.title} className="bg-surface border border-surface-border rounded-xl p-5 flex flex-col items-center text-center gap-3">
                    <card.icon className="w-8 h-8 text-primary" />
                    <div className="text-sm font-bold text-foreground">{card.title}</div>
                    <div className="text-xs text-zinc-400 leading-relaxed">{card.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-6">
                <ArrowRight className="w-8 h-8 text-green-500" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-3">Pronto para começar</h1>
              <p className="text-zinc-400 leading-relaxed mb-2">
                Clique em <strong className="text-foreground">Nova Análise</strong> no painel e envie o primeiro contrato em PDF.
              </p>
              <p className="text-zinc-500 text-sm">O laudo técnico completo fica pronto em poucos minutos.</p>
            </div>
          )}

          <div className="flex items-center justify-between mt-10">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-surface-border"}`} />
              ))}
            </div>

            {step < 2 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
              >
                Continuar
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={finish}
                className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
              >
                Ir para o Dashboard
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
