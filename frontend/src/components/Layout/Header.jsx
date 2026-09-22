import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { cn } from "../../utils/cn";
import logoImg from "../../assets/logo.png";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    // `passive`: o handler nunca chama preventDefault, e sem a marcação o
    // navegador espera por ela antes de rolar a página.
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-transparent",
        scrolled ? "glass py-3 border-surface-border shadow-lg" : "bg-transparent py-5"
      )}
    >
      <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center group py-1">
          <img
            src={logoImg}
            alt="ForenseDoc"
            className="h-9 w-auto object-contain transition-opacity group-hover:opacity-90"
          />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#solucao" className="text-sm font-medium text-zinc-400 hover:text-foreground transition-colors">
            O laudo
          </a>
          <a href="#como-funciona" className="text-sm font-medium text-zinc-400 hover:text-foreground transition-colors">
            Como funciona
          </a>
          <a href="#planos" className="text-sm font-medium text-zinc-400 hover:text-foreground transition-colors">
            Planos
          </a>
          {/* Quem chega para conferir um laudo não é visitante de vendas: em
              geral recebeu o documento de outra pessoa e quer saber se é
              legítimo. Precisa achar a entrada sem rolar a página. */}
          <Link to="/verificar" className="text-sm font-medium text-zinc-400 hover:text-foreground transition-colors">
            Verificar laudo
          </Link>
        </nav>

        {/* Auth Buttons */}
        <div className="hidden md:flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium text-zinc-300 hover:text-foreground transition-colors">
            Entrar
          </Link>
          <Link
            to="/register"
            className="text-sm font-medium bg-foreground text-background px-4 py-2 rounded-full hover:bg-zinc-200 transition-colors shadow-[0_0_15px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(255,255,255,0.2)]"
          >
            Gerar laudos grátis
          </Link>
        </div>

        {/* Mobile Toggle */}
        <button 
          className="md:hidden text-zinc-400 hover:text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 glass border-b border-surface-border p-4 flex flex-col gap-4 shadow-xl">
          <a href="#solucao" className="text-sm font-medium text-zinc-400 p-2 rounded hover:bg-surface">O laudo</a>
          <a href="#como-funciona" className="text-sm font-medium text-zinc-400 p-2 rounded hover:bg-surface">Como funciona</a>
          <a href="#planos" className="text-sm font-medium text-zinc-400 p-2 rounded hover:bg-surface">Planos</a>
          <Link to="/verificar" className="text-sm font-medium text-zinc-400 p-2 rounded hover:bg-surface">Verificar laudo</Link>
          <div className="h-px bg-surface-border my-2" />
          <Link to="/login" className="text-sm font-medium text-zinc-300 p-2 rounded hover:bg-surface text-center">Entrar</Link>
          <Link to="/register" className="text-sm font-medium bg-primary text-white p-2 rounded text-center">Gerar laudos grátis</Link>
        </div>
      )}
    </header>
  );
}
