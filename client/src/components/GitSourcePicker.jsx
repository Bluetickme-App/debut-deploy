import { useEffect, useState } from "react";
import { Spinner } from "./ui.jsx";
import { api } from "../lib/api.js";

// Repo + branch as real dropdowns fed from the connected GitHub App, so switching a
// service onto a test branch is a pick rather than typing a name from memory and
// finding out at the next deploy whether it existed.
//
// Degrades on purpose. GitHub is not the only way a service gets its source — apps
// created from a deploy key, or pointed at a non-GitHub remote, will not appear in the
// installation's repo list. In that case (and when GitHub isn't connected at all) both
// fields fall back to free text rather than trapping the user in a list their repo is
// missing from.

// git@github.com:owner/name.git | https://github.com/owner/name → "owner/name"
export function repoFullName(url) {
  const m = String(url || "").match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  return m ? m[1] : null;
}

const toSshUrl = (fullName) => `git@github.com:${fullName}.git`;

export default function GitSourcePicker({ repo, branch, onChange, disabled = false }) {
  const [repos, setRepos] = useState(null);      // null = loading, [] = unavailable
  const [branches, setBranches] = useState(null);
  const [branchErr, setBranchErr] = useState(null);
  const [manual, setManual] = useState(false);   // user chose to type instead

  const current = repoFullName(repo);

  useEffect(() => {
    let off = false;
    api.getRepos()
      .then((d) => {
        if (off) return;
        setRepos(d?.needsConnect || !Array.isArray(d) ? [] : d);
      })
      .catch(() => { if (!off) setRepos([]); });
    return () => { off = true; };
  }, []);

  // Branches follow whichever repo is selected.
  useEffect(() => {
    if (!current) { setBranches([]); return; }
    let off = false;
    setBranches(null); setBranchErr(null);
    const [owner, name] = current.split("/");
    api.getBranches(owner, name)
      .then((d) => {
        if (off) return;
        setBranches(Array.isArray(d) ? d : []);
      })
      .catch((e) => {
        if (off) return;
        setBranches([]);
        setBranchErr(e.status === 409 ? "Connect GitHub to list branches" : "Couldn't list branches");
      });
    return () => { off = true; };
  }, [current]);

  // The service's repo may not be in the installation list (deploy-key or non-GitHub
  // source) — keep it selectable so saving never silently repoints the service.
  const known = repos || [];
  const inList = current && known.some((r) => r.full_name === current);
  const useSelect = !manual && known.length > 0;

  const branchOptions = (() => {
    const list = branches || [];
    if (branch && !list.includes(branch)) return [branch, ...list]; // current branch always selectable
    return list;
  })();

  return (
    <div className="flex flex-col gap-3">
      {/* --- repository --- */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".04em" }}>
          Repository
        </span>
        {repos === null ? (
          <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            <Spinner className="mr-2 inline" /> Loading repositories…
          </span>
        ) : useSelect ? (
          <select
            className="input"
            style={{ fontFamily: "var(--font-mono, monospace)", minWidth: 280 }}
            value={current || ""}
            disabled={disabled}
            onChange={(e) => onChange({ repo: toSshUrl(e.target.value), branch: "" })}
          >
            {!inList && current && <option value={current}>{current} (current)</option>}
            {!inList && !current && <option value="">— select a repository —</option>}
            {known.map((r) => (
              <option key={`${r.installation_id}:${r.full_name}`} value={r.full_name}>
                {r.full_name}{r.private ? " · private" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input"
            style={{ fontFamily: "var(--font-mono, monospace)", minWidth: 280 }}
            value={repo || ""}
            disabled={disabled}
            placeholder="git@github.com:owner/name.git"
            onChange={(e) => onChange({ repo: e.target.value })}
          />
        )}
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {repos !== null && known.length === 0
            ? "GitHub isn't connected, so repositories can't be listed — enter the git URL."
            : useSelect
              ? <>Repositories the DebutDeploy GitHub App can access. <button type="button" className="underline" onClick={() => setManual(true)}>Enter a URL instead</button></>
              : <button type="button" className="underline" onClick={() => setManual(false)}>Pick from GitHub instead</button>}
        </span>
      </label>

      {/* --- branch --- */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--text-muted)", letterSpacing: ".04em" }}>
          Branch
        </span>
        {branches === null ? (
          <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            <Spinner className="mr-2 inline" /> Loading branches…
          </span>
        ) : branchOptions.length > 0 ? (
          <select
            className="input"
            style={{ fontFamily: "var(--font-mono, monospace)", minWidth: 280 }}
            value={branch || ""}
            disabled={disabled}
            onChange={(e) => onChange({ branch: e.target.value })}
          >
            {!branch && <option value="">— select a branch —</option>}
            {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <input
            className="input"
            style={{ fontFamily: "var(--font-mono, monospace)", minWidth: 280 }}
            value={branch || ""}
            disabled={disabled}
            placeholder="main"
            onChange={(e) => onChange({ branch: e.target.value })}
          />
        )}
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {branchErr || "Applied on the next deploy — switch to a test branch, then redeploy."}
        </span>
      </label>
    </div>
  );
}
