import { Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { captureFounderCode } from "./utils/founderInvite.js";

// Guarda o `?founder=` da URL antes de qualquer roteamento: o link do convite
// aponta para uma rota protegida e o convidado deslogado passa pelo login,
// que não preserva a query string.
captureFounderCode();

// Rotas Públicas
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";

// Layout e Proteção
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import DashboardLayout from "./components/Layout/DashboardLayout.jsx";

// Rotas Privadas (SaaS)
import Dashboard from "./pages/Dashboard.jsx";
import Analyze from "./pages/Analyze.jsx";
import Replica from "./pages/Replica.jsx";
import Laudo from "./pages/Laudo.jsx";
import History from "./pages/History.jsx";
import Plans from "./pages/Plans.jsx";
import Settings from "./pages/Settings.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Admin from "./pages/Admin.jsx";
import AdminRoute from "./components/AdminRoute.jsx";

// Temporário para manter a v2.2 acessível enquanto construímos o dashboard do v3.0
import ForenseDocOld from "./ForenseDoc.jsx";
import Termos from "./pages/legal/Termos.jsx";
import Privacidade from "./pages/legal/Privacidade.jsx";

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

        {/* Páginas jurídicas: PÚBLICAS de propósito. Quem ainda não é cliente
            precisa poder ler antes de decidir, e o titular de dado que aparece
            num contrato analisado não tem conta aqui (LGPD, art. 9º). */}
        <Route path="/termos" element={<Termos />} />
        <Route path="/privacidade" element={<Privacidade />} />
        {/* A v2.2 continua acessível, mas atrás de login.
            Como rota pública ela aceitava upload de contrato — documento com
            dados pessoais do cliente — de qualquer visitante, e o enviava para
            /api/analyze sem token. O backend recusava com 401, então nunca
            houve análise de graça; o problema era o oposto: a tela pedia um PDF
            sensível e não fazia nada com ele. */}
        <Route
          path="/v2"
          element={
            <ProtectedRoute>
              <ForenseDocOld />
            </ProtectedRoute>
          }
        />
        
        {/* Rotas de Autenticação */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Destino do link de convite montado em tenantController.inviteMember */}
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        {/* Rotas Protegidas do Dashboard */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="history" element={<History />} />
          <Route path="replica" element={<Replica />} />
          <Route path="laudo/:id" element={<Laudo />} />
          <Route path="plans" element={<Plans />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
