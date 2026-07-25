import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Lock, Users, Loader2, Trash2, UserPlus, Clock, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/axios";
import { useAuthStore } from "../store/authStore";

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="glass rounded-2xl border border-surface-border p-6">
      <div className="flex items-center gap-2 mb-6">
        <Icon className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function TextField({ label, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      <input
        {...props}
        className="block w-full px-4 py-2.5 bg-surface border border-surface-border rounded-lg text-foreground placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
      />
    </div>
  );
}

export default function Settings() {
  const { user, checkAuth, logout } = useAuthStore();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || "");
  const [oabNumber, setOabNumber] = useState(user?.oabNumber || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const [members, setMembers] = useState([]);
  // Convites pendentes ocupam vaga do plano — sem exibi-los, o titular não
  // entende por que o limite foi atingido com menos membros que o permitido.
  const [pendingInvites, setPendingInvites] = useState([]);
  const [seats, setSeats] = useState(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [busyInviteId, setBusyInviteId] = useState(null);

  const isOwner = user?.role === "OWNER";

  const loadTeam = async () => {
    try {
      const { data } = await api.get("/tenant/members");
      setMembers(data.members);
      setPendingInvites(data.pendingInvites || []);
      setSeats(data.seats || null);
    } catch {
      toast.error("Erro ao carregar membros da equipe.");
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    loadTeam();
  }, []);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch("/auth/me", { name, oabNumber });
      await checkAuth();
      toast.success("Perfil atualizado com sucesso.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao atualizar perfil.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      toast.success("Senha alterada. Faça login novamente.");
      await logout();
      navigate("/login");
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao trocar senha.");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    try {
      await api.post("/tenant/invite", { email: inviteEmail });
      toast.success("Convite enviado com sucesso.");
      setInviteEmail("");
      await loadTeam();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao enviar convite.");
    } finally {
      setInviting(false);
    }
  };

  // Reenviar é o mesmo POST /tenant/invite: o backend detecta o convite
  // pendente, renova o token e NÃO consome outra vaga (tenantController.js).
  const handleResendInvite = async (email) => {
    setBusyInviteId(email);
    try {
      await api.post("/tenant/invite", { email });
      toast.success(`Convite reenviado para ${email}.`);
      await loadTeam();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao reenviar convite.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const handleRevokeInvite = async (invite) => {
    if (!window.confirm(`Revogar o convite de ${invite.email}? A vaga do plano será liberada.`)) return;
    setBusyInviteId(invite.id);
    try {
      await api.delete(`/tenant/invites/${invite.id}`);
      toast.success("Convite revogado.");
      await loadTeam();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao revogar convite.");
    } finally {
      setBusyInviteId(null);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm("Remover este membro da equipe? Ele perderá o acesso imediatamente.")) return;
    setRemovingId(memberId);
    try {
      await api.delete(`/tenant/members/${memberId}`);
      toast.success("Membro removido.");
      await loadTeam();
    } catch (error) {
      toast.error(error.response?.data?.error || "Erro ao remover membro.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-zinc-400">Gerencie sua conta e sua equipe.</p>
      </div>

      <SectionCard icon={User} title="Conta">
        <div className="space-y-4 mb-6 text-sm">
          <div className="flex justify-between border-b border-surface-border/50 pb-2">
            <span className="text-zinc-500">E-mail</span>
            <span className="text-foreground font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between border-b border-surface-border/50 pb-2">
            <span className="text-zinc-500">Escritório</span>
            <span className="text-foreground font-medium">{user?.tenant?.name}</span>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <TextField label="Nome completo" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} />
          <TextField label="Número da OAB" value={oabNumber} onChange={(e) => setOabNumber(e.target.value)} placeholder="Opcional" />
          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar alterações
          </button>
        </form>
      </SectionCard>

      <SectionCard icon={Lock} title="Trocar senha">
        <form onSubmit={handleChangePassword} className="space-y-4">
          <TextField
            label="Senha atual"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <TextField
            label="Nova senha"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          <button
            type="submit"
            disabled={changingPassword}
            className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {changingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
            Trocar senha
          </button>
          <p className="text-xs text-zinc-500">Ao trocar a senha, você precisará fazer login novamente em todos os dispositivos.</p>
        </form>
      </SectionCard>

      <SectionCard icon={Users} title="Equipe">
        {seats && (
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-border/50">
            <span className="text-xs text-zinc-500">Vagas do plano</span>
            <span className={`text-xs font-medium ${seats.total >= seats.maxUsers ? "text-amber-500" : "text-zinc-400"}`}>
              {seats.total} de {seats.maxUsers} ocupada{seats.maxUsers > 1 ? "s" : ""}
              {seats.pendingInvites > 0 && ` · ${seats.pendingInvites} aguardando aceite`}
            </span>
          </div>
        )}

        {loadingMembers ? (
          <div className="flex justify-center p-6"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
        ) : (
          <div className="space-y-3 mb-6">
            {/* Remoção é soft-delete (`active: false`): sem este filtro, o
                ex-membro continuaria listado como se ainda tivesse acesso. */}
            {members.filter((m) => m.active !== false).map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2.5 border-b border-surface-border/50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-zinc-200">{member.name} {member.id === user?.id && <span className="text-xs text-zinc-500">(você)</span>}</div>
                  <div className="text-xs text-zinc-500">{member.email} · {member.role === "OWNER" ? "Proprietário" : "Membro"}</div>
                </div>
                {isOwner && member.id !== user?.id && (
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    disabled={removingId === member.id}
                    className="text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-colors disabled:opacity-50"
                    title="Remover membro"
                  >
                    {removingId === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))}

            {pendingInvites.length > 0 && (
              <div className="pt-3">
                <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                  Convites aguardando aceite
                </p>
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between py-2.5 border-b border-surface-border/50 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">{invite.email}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        Expira em {new Date(invite.expiresAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · ocupa uma vaga do plano
                      </div>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleResendInvite(invite.email)}
                          disabled={busyInviteId === invite.email || busyInviteId === invite.id}
                          className="text-zinc-400 hover:text-primary hover:bg-primary/10 p-2 rounded-lg transition-colors disabled:opacity-50"
                          title="Reenviar convite (renova o prazo de 72h)"
                        >
                          {busyInviteId === invite.email ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleRevokeInvite(invite)}
                          disabled={busyInviteId === invite.email || busyInviteId === invite.id}
                          className="text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-colors disabled:opacity-50"
                          title="Revogar convite e liberar a vaga"
                        >
                          {busyInviteId === invite.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isOwner ? (
          <form onSubmit={handleInvite} className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <TextField
                label="Convidar novo membro (e-mail)"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colega@escritorio.com.br"
                required
              />
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center gap-2 bg-primary hover:bg-blue-600 text-white px-5 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 shrink-0"
            >
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Convidar
            </button>
          </form>
        ) : (
          <p className="text-xs text-zinc-500">Apenas o proprietário do escritório pode convidar ou remover membros.</p>
        )}
      </SectionCard>
    </div>
  );
}
