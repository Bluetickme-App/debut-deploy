import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../auth.jsx";
import { Mono } from "../components/ui.jsx";

// In-app docs article for pointing a custom domain at a DebutDeploy service.
// Linked from the Add Custom Domain wizard ("Read the docs →").
export default function DocsCustomDomains() {
  const { user } = useAuth();
  const ip = user?.platformIp || "your server IP";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8" style={{ color: "var(--text)" }}>
      <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="text-2xl font-semibold">Custom Domains</h1>
      <p className="mt-2 text-[14px]" style={{ color: "var(--text-muted)" }}>
        Point your own domain (e.g. <Mono>example.com</Mono>) at a service. DebutDeploy issues and
        auto-renews a free TLS certificate once your DNS points here.
      </p>

      <Section title="1. Add the domain in the panel">
        <p>
          Open your service → <b>Custom Domains</b> → <b>Add Custom Domain</b>. Enter your domain and
          click <b>Add Domain</b>. We set up both the root (<Mono>example.com</Mono>) and
          <Mono>www.example.com</Mono>, and keep your free <Mono>.debutdepoly.com</Mono> subdomain.
        </p>
      </Section>

      <Section title="2. Configure DNS with your provider">
        <p className="mb-3">
          At your registrar (GoDaddy, Cloudflare, Namecheap…), add these records. The <Mono>www</Mono>
          record is a <Mono>CNAME</Mono> to your service's free subdomain; the root points at the server.
        </p>
        <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <Th>Type</Th><Th>Host</Th><Th>Value</Th>
            </tr>
          </thead>
          <tbody>
            <Row type="CNAME" host="www" value="{service}.debutdepoly.com" />
            <Row type="A" host="@ (root)" value={ip} />
          </tbody>
        </table>
        <p className="mt-3 text-[13px]" style={{ color: "var(--text-muted)" }}>
          <b>Root domains and CNAMEs:</b> most DNS providers don't allow a <Mono>CNAME</Mono> on the
          root (<Mono>@</Mono>), so use an <Mono>A</Mono> record → <Mono>{ip}</Mono>. If your provider
          supports <Mono>ALIAS</Mono>/<Mono>ANAME</Mono> flattening, you can point the root at
          <Mono>{"{service}.debutdepoly.com"}</Mono> instead. Never put an IP in a <Mono>CNAME</Mono> value.
        </p>
      </Section>

      <Section title="3. Verify & wait for TLS">
        <p>
          Back in the wizard, click <b>Verify</b>. Each record turns green once it resolves to the server.
          DNS changes can take up to 24 hours to propagate (often minutes). Once verified, a Let's Encrypt
          certificate is issued automatically — no action needed. If you're migrating from another host,
          remove the domain there after cutover so it isn't holding the old routing.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-7">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      <div className="text-[14px] leading-relaxed" style={{ color: "var(--text)" }}>{children}</div>
    </div>
  );
}

function Th({ children }) {
  return <th className="border-b py-1.5 pr-4 font-medium" style={{ borderColor: "var(--border)" }}>{children}</th>;
}

function Row({ type, host, value }) {
  return (
    <tr>
      <td className="border-b py-2 pr-4" style={{ borderColor: "var(--border)" }}><Mono>{type}</Mono></td>
      <td className="border-b py-2 pr-4" style={{ borderColor: "var(--border)" }}><Mono>{host}</Mono></td>
      <td className="border-b py-2 pr-4" style={{ borderColor: "var(--border)" }}><Mono>{value}</Mono></td>
    </tr>
  );
}
