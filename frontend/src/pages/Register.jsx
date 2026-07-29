import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Scale, Loader2, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuthStore } from "../store/authStore";
import { MIN_LENGTH } from "../utils/passwordRules";

export default function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    cpfCnpj: "",
    oabNumber: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const navigate = useNavigate();
  const register = useAuthStore((state) => state.register);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Removendo formatação básica se houver
    const payload = {
      ...formData,
      cpfCnpj: formData.cpfCnpj.replace(/\D/g, "")
    };

    const result = await register(payload);
    setIsSubmitting(false);

    if (result.success) {
      setSuccess(true);
      toast.success("Conta criada com sucesso!");
    } else {
      toast.error(result.error);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center glass p-10 rounded-2xl border-primary/30">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-foreground mb-4">Verifique seu E-mail</h2>
          <p className="text-zinc-400 mb-8">
            Enviamos um link de confirmação para <strong className="text-zinc-200">{formData.email}</strong>. 
            Clique no link para ativar seus 3 laudos gratuitos.
          </p>
          <Link to="/login" className="text-primary hover:text-blue-400 font-medium">
            Voltar para o Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-xl relative z-10 text-center mb-8">
        <Link to="/" className="inline-flex items-center gap-2 group mb-6">
          <div className="bg-primary/10 p-2 rounded-lg border border-primary/20">
            <Scale className="w-6 h-6 text-primary" />
          </div>
          <span className="font-bold text-2xl tracking-tight text-foreground">
            Forense<span className="text-primary">Doc</span>
          </span>
        </Link>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Comece seus 3 laudos grátis</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Já possui uma conta?{" "}
          <Link to="/login" className="font-medium text-primary hover:text-blue-400 transition-colors">
            Fazer login
          </Link>
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-xl relative z-10">
        <div className="glass p-8 shadow-2xl rounded-2xl border border-surface-border">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">Nome Completo</label>
                <input type="text" name="name" value={formData.name} onChange={handleChange} required
                  className="w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none" 
                  placeholder="Dr. João Silva" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">E-mail Corporativo</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} required
                  className="w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none" 
                  placeholder="joao@advocacia.com.br" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">CPF ou CNPJ (somente números)</label>
                <input type="text" name="cpfCnpj" value={formData.cpfCnpj} onChange={handleChange} required
                  className="w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none" 
                  placeholder="00000000000" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Número da OAB <span className="text-zinc-500">(Opcional)</span></label>
                <input type="text" name="oabNumber" value={formData.oabNumber} onChange={handleChange}
                  className="w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none" 
                  placeholder="Ex: 123456" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-zinc-300 mb-1">Senha Segura</label>
                <input type="password" name="password" value={formData.password} onChange={handleChange} required minLength={MIN_LENGTH}
                  className="w-full px-4 py-3 bg-surface border border-surface-border rounded-xl text-foreground placeholder-zinc-500 focus:ring-2 focus:ring-primary focus:outline-none" 
                  placeholder="••••••••" />
                <p className="text-xs text-zinc-500 mt-2">Mínimo de {MIN_LENGTH} caracteres, sem usar seu nome ou e-mail.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-6 flex justify-center py-4 px-4 border border-transparent rounded-xl shadow-[0_0_15px_rgba(59,130,246,0.2)] text-sm font-bold text-white bg-primary hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary disabled:opacity-50 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Criando conta...
                </>
              ) : (
                "Criar Conta e Ganhar 3 Laudos"
              )}
            </button>
            <p className="text-xs text-center text-zinc-500 mt-4">
              Ao criar uma conta, você concorda com nossos Termos de Serviço e Política de Privacidade.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
