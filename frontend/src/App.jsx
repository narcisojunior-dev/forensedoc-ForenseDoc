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

// Layout e Proteção
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import DashboardLayout from "./components/Layout/DashboardLayout.jsx";

// Rotas Privadas (SaaS)
import Dashboard from "./pages/Dashboard.jsx";
import Analyze from "./pages/Analyze.jsx";
import History from "./pages/History.jsx";
import Plans from "./pages/Plans.jsx";
import Settings from "./pages/Settings.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Admin from "./pages/Admin.jsx";
import AdminRoute from "./components/AdminRoute.jsx";

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
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

        {/* Rotas Protegidas do Dashboard */}
        <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="history" element={<History />} />
          <Route path="plans" element={<Plans />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
        </Route>
      </Routes>
    </>
  );
}

export default App;
