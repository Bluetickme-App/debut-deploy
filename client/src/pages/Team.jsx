import { useEffect, useState } from "react";
import { Users, Copy, Trash2, ShieldCheck } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.jsx";
import { PageHeader, Card, Spinner, timeAgo } from "../components/ui.jsx";

const ROLES = ["owner", "manager", "deployer", "viewer"];

export default function Team() {
  const { user } = useAuth();
  const isOwner = user?.orgRole === "owner";
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState(null);
  const [link, setLink] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteEmail, setInviteEmail] = useState("");

  const load = () => {
    api.orgMembers().then(setMembers).catch(setError);
    if (isOwner) api.orgInvites().then(setInvites).catch(() => {});
  };
  useEffect(load, [isOwner]);

  const createInvite = async () => {
    const warn = inviteRole === "owner"
      ? confirm("Owners can invite users, change roles, remove members, and access billing controls. Continue?")
      : true;
    if (!warn) return;
    const { link } = await api.createInvite({ email: inviteEmail || null, role: inviteRole });
    setLink(link);
    setInviteEmail("");
    load();
  };

  if (error) return <div className="page"><p style={{ color: "var(--err)" }}>Failed: {error.message}</p></div>;
  if (!members) return <div className="flex h-40 items-center justify-center" style={{ color: "var(--text-muted)" }}><Spinner className="mr-2" /> Loading…</div>;

  return (
    <div className="page">
      <PageHeader title="Team" subtitle="People in your organization and what they can do." />

      {isOwner && (
        <Card className="mb-6">
          <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text)" }}>
            <Users size={16} /><span className="font-semibold text-sm">Invite a teammate</span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input" placeholder="email (optional)" value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)} style={{ minWidth: 220 }} />
            <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn btn-primary" onClick={createInvite}>Generate link</button>
          </div>
          {link && (
            <div className="mt-3 flex items-center gap-2">
              <input className="input mono" readOnly value={link} style={{ flex: 1 }} />
              <button className="btn" onClick={() => navigator.clipboard.writeText(link)}><Copy size={14} /> Copy</button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              {invites.length} pending invite{invites.length !== 1 ? "s" : ""}.
            </div>
          )}
        </Card>
      )}

      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
            <th className="px-4 py-3 font-semibold">Member</th>
            <th className="px-4 py-3 font-semibold">Role</th>
            <th className="px-4 py-3 font-semibold">Joined</th>
            {isOwner && <th className="px-4 py-3 font-semibold">Actions</th>}
          </tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                  {m.name || m.email}<div className="mono" style={{ color: "var(--text-muted)", fontSize: 12 }}>{m.email}</div>
                </td>
                <td className="px-4 py-3">
                  {isOwner ? (
                    <select className="input" value={m.role} onChange={async (e) => { await api.setMemberRole(m.id, e.target.value); load(); }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className={`pill ${m.role === "owner" ? "pill-accent" : "pill-neutral"}`}>
                      {m.role === "owner" && <ShieldCheck size={12} />}{m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>{m.created_at ? timeAgo(m.created_at) : "—"}</td>
                {isOwner && (
                  <td className="px-4 py-3">
                    {m.id !== user.id && (
                      <button className="btn btn-danger" onClick={async () => { if (confirm("Remove this member?")) { await api.removeMember(m.id); load(); } }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
