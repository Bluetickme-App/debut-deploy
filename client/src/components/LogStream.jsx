import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { Spinner } from "./ui.jsx";

// Pulls log lines from the proxy and reveals them one-by-one to mimic a live
// streaming build log (Render-style). Against a real Coolify backend you'd swap
// the timed reveal for Server-Sent Events / WebSocket.
export default function LogStream({ serviceId, live }) {
  const [all, setAll] = useState(null);
  const [shown, setShown] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setAll(null);
    setShown(0);
    api.logs(serviceId).then((lines) => {
      if (!cancelled) setAll(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  useEffect(() => {
    if (!all) return;
    if (shown >= all.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), live ? 280 : 60);
    return () => clearTimeout(t);
  }, [all, shown, live]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown]);

  if (!all)
    return (
      <div className="text-sm text-zinc-500">
        <Spinner className="mr-2 inline" /> Fetching logs…
      </div>
    );

  const done = shown >= all.length;
  return (
    <div className="overflow-hidden rounded-lg border border-white/8 bg-[#0a0c10]">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">Build &amp; deploy log</span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className={`h-2 w-2 rounded-full ${done ? "bg-emerald-400" : "bg-sky-400 animate-pulse"}`} />
          <span className={done ? "text-emerald-300" : "text-sky-300"}>
            {done ? "Completed" : "Streaming"}
          </span>
        </span>
      </div>
      <pre
        ref={boxRef}
        className="max-h-[420px] overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-300"
      >
        {all.slice(0, shown).map((l, i) => (
          <div key={i} className={lineClass(l)}>
            <span className="mr-3 select-none text-zinc-600">{String(i + 1).padStart(2, " ")}</span>
            {l}
          </div>
        ))}
        {!done && <span className="animate-pulse text-zinc-500">▋</span>}
      </pre>
    </div>
  );
}

function lineClass(l) {
  if (/error|failed/i.test(l)) return "text-rose-300";
  if (/✓|live|passing|complete|🚀/i.test(l)) return "text-emerald-300";
  if (l.startsWith("==>")) return "text-sky-300";
  return "";
}
