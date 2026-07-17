import { Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

// Rotas Públicas
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";

// Layout e Proteção
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import DashboardLayout from "./components/Layout/DashboardLayout.jsx";

// Rotas Privadas (SaaS)
import Dashboard from "./pages/Dashboard.jsx";
import Analyze from "./pages/Analyze.jsx";

// Temporário para manter a v2.2 acessível enquanto construímos o dashboard do v3.0
import ForenseDocOld from "./ForenseDoc.jsx";

function App() {
  return (
    <>
      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#18181b', // zinc-900 (surface)
          color: '#fafafa', // zinc-50
          border: '1px solid #27272a', // zinc-800
        }
      }} />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/v2" element={<ForenseDocOld />} />
        
        {/* Rotas de Autenticação */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Rotas Protegidas do Dashboard */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="history" element={<div className="p-8 text-center text-zinc-400">Histórico de Laudos (Em breve - Módulo 4)</div>} />
          <Route path="plans" element={<div className="p-8 text-center text-zinc-400">Planos e Créditos (Em breve - Módulo 3)</div>} />
          <Route path="settings" element={<div className="p-8 text-center text-zinc-400">Configurações (Em breve)</div>} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
