// Demo data mirroring the MFLH / TikTok / CryptoPilot / Aurora / Bluetick / QrConnect
// stack from the Hetzner + Coolify migration guide. Used when DEMO_MODE=true so the
// dashboard is fully clickable without a live Coolify instance.

const now = Date.now();
const minsAgo = (m) => new Date(now - m * 60_000).toISOString();

export const servers = [
  {
    uuid: "srv-cx32",
    name: "hetzner-cx32",
    description: "Shared box — web + automation services",
    ip: "65.21.0.10",
    region: "Frankfurt (fsn1)",
    spec: "4 vCPU · 8 GB · 80 GB SSD",
    reachable: true,
    cpu: 38,
    memory: 61,
    disk: 44,
  },
  {
    uuid: "srv-ccx13",
    name: "hetzner-ccx13",
    description: "Dedicated vCPU — CryptoPilot ML",
    ip: "65.21.0.22",
    region: "Frankfurt (fsn1)",
    spec: "2 dedicated vCPU · 8 GB",
    reachable: true,
    cpu: 72,
    memory: 80,
    disk: 31,
  },
];

export const services = [
  // --- MFLH / FansAutos ---
  { uuid: "app-mflh-web", name: "mflh-main-web", group: "MFLH", type: "web", runtime: "Node", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/mflh", domain: "api.mflh.io", lastDeployedAt: minsAgo(42), health: "healthy" },
  { uuid: "app-flyer-render", name: "flyer-render", group: "MFLH", type: "web", runtime: "Docker", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/flyer-render", domain: "flyer.mflh.io", lastDeployedAt: minsAgo(180), health: "healthy" },
  { uuid: "app-face-rec", name: "face-rec", group: "MFLH", type: "worker", runtime: "Docker", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/face-rec", domain: null, lastDeployedAt: minsAgo(305), health: "healthy" },
  { uuid: "app-research-browser", name: "research-browser", group: "MFLH", type: "worker", runtime: "Docker", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/research-browser", domain: null, lastDeployedAt: minsAgo(620), health: "healthy" },

  // --- TikTok Live AI ---
  { uuid: "app-tt-avatar", name: "tiktok-live-ai-avatar", group: "TikTok Live AI", type: "web", runtime: "Docker", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/tiktok-live-ai", domain: "avatar.tiktok-ai.io", lastDeployedAt: minsAgo(95), health: "healthy" },
  { uuid: "app-tt-orch", name: "tiktok-live-ai-orch", group: "TikTok Live AI", type: "worker", runtime: "Docker", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/tiktok-live-ai", domain: null, lastDeployedAt: minsAgo(95), health: "healthy" },
  { uuid: "app-tt-yt", name: "tiktok-live-ai-youtube-ingest", group: "TikTok Live AI", type: "worker", runtime: "Docker", status: "deploying", server: "srv-cx32", branch: "main", repo: "debutweb/tiktok-live-ai", domain: null, lastDeployedAt: minsAgo(2), health: "deploying" },

  // --- CryptoPilot (CCX13) ---
  { uuid: "app-cp-prod", name: "platform-production-1", group: "CryptoPilot", type: "web", runtime: "Docker", status: "running", server: "srv-ccx13", branch: "main", repo: "debutweb/cryptopilot", domain: "app.cryptopilot.io", lastDeployedAt: minsAgo(410), health: "healthy" },
  { uuid: "app-cp-ml", name: "ml-server", group: "CryptoPilot", type: "worker", runtime: "Docker", status: "running", server: "srv-ccx13", branch: "main", repo: "debutweb/cryptopilot-ml", domain: null, lastDeployedAt: minsAgo(410), health: "degraded" },
  { uuid: "app-cp-chroma", name: "chromadb", group: "CryptoPilot", type: "service", runtime: "Docker", status: "running", server: "srv-ccx13", branch: "main", repo: "debutweb/cryptopilot-ml", domain: null, lastDeployedAt: minsAgo(1440), health: "healthy" },

  // --- Aurora ---
  { uuid: "app-aurora", name: "aurora", group: "Aurora", type: "web", runtime: "Docker", status: "stopped", server: "srv-cx32", branch: "main", repo: "debutweb/aurora", domain: "aurora.mflh.io", lastDeployedAt: minsAgo(2880), health: "stopped" },

  // --- Bluetick ---
  { uuid: "app-bt-web", name: "bluetick-v2-web", group: "Bluetick", type: "web", runtime: "Node", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/bluetick-v2", domain: "bluetick.me", lastDeployedAt: minsAgo(70), health: "healthy" },
  { uuid: "app-bt-api", name: "bluetickme-api-v4", group: "Bluetick", type: "web", runtime: "Node", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/bluetick-api", domain: "api.bluetick.me", lastDeployedAt: minsAgo(70), health: "healthy" },

  // --- QrConnect ---
  { uuid: "app-qr", name: "qrconnect", group: "QrConnect", type: "web", runtime: "Node", status: "running", server: "srv-cx32", branch: "main", repo: "debutweb/qrconnect", domain: "qrconnect.io", lastDeployedAt: minsAgo(515), health: "healthy" },
];

export const databases = [
  { uuid: "db-postgres", name: "postgres-16", type: "postgresql", version: "16", status: "running", server: "srv-cx32", logicalDbs: ["fansauto_db", "tiktok_db", "aurora_db", "bluetick_db", "pulse_db"], sizeMb: 2480, connections: 34, internalUrl: "postgres://postgres@postgres-16:5432" },
  { uuid: "db-valkey", name: "valkey-8", type: "redis", version: "8", status: "running", server: "srv-cx32", logicalDbs: [], sizeMb: 180, connections: 12, internalUrl: "redis://valkey-8:6379" },
  { uuid: "db-cp-pg", name: "cryptopilot-pg", type: "postgresql", version: "16", status: "running", server: "srv-ccx13", logicalDbs: ["cryptopilot_db"], sizeMb: 5120, connections: 18, internalUrl: "postgres://postgres@cryptopilot-pg:5432" },
];

export const envsByApp = {
  "app-mflh-web": [
    { uuid: "e1", key: "NODE_ENV", value: "production", is_secret: false },
    { uuid: "e2", key: "DATABASE_URL", value: "postgres://mflh_user:••••••@postgres-16:5432/fansauto_db", is_secret: true },
    { uuid: "e3", key: "REDIS_URL", value: "redis://valkey-8:6379", is_secret: false },
    { uuid: "e4", key: "STRIPE_SECRET_KEY", value: "sk_live_••••••••••••", is_secret: true },
    { uuid: "e5", key: "PORT", value: "3000", is_secret: false },
  ],
  "app-cp-ml": [
    { uuid: "e1", key: "MODEL_DIR", value: "/models", is_secret: false },
    { uuid: "e2", key: "CHROMA_URL", value: "http://chromadb:8000", is_secret: false },
    { uuid: "e3", key: "DATABASE_URL", value: "postgres://cp_user:••••••@cryptopilot-pg:5432/cryptopilot_db", is_secret: true },
    { uuid: "e4", key: "WORKERS", value: "4", is_secret: false },
  ],
};

const defaultEnvs = [
  { uuid: "e1", key: "NODE_ENV", value: "production", is_secret: false },
  { uuid: "e2", key: "PORT", value: "3000", is_secret: false },
];

export function getEnvs(appUuid) {
  return envsByApp[appUuid] ? [...envsByApp[appUuid]] : [...defaultEnvs];
}

const commitMsgs = [
  "fix: handle empty webhook payload",
  "feat: add retry on upstream timeout",
  "chore: bump deps",
  "fix: correct env var name for redis",
  "feat: new dashboard metrics endpoint",
  "perf: cache creator lookups",
];

export function getDeployments(appUuid) {
  const app = services.find((s) => s.uuid === appUuid);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const isLatest = i === 0;
    const deploying = app?.status === "deploying" && isLatest;
    out.push({
      uuid: `dep-${appUuid}-${i}`,
      status: deploying ? "in_progress" : i === 2 ? "failed" : "success",
      commit: Math.random().toString(16).slice(2, 9),
      message: commitMsgs[(i + appUuid.length) % commitMsgs.length],
      branch: app?.branch || "main",
      startedAt: minsAgo(i * 240 + 5),
      durationSec: deploying ? null : 40 + ((i * 17) % 90),
      trigger: i % 3 === 0 ? "git push" : "manual",
    });
  }
  return out;
}

export function buildLog(appName) {
  return [
    `==> Cloning from github.com/debutweb/${appName}`,
    "==> Checking out commit a3f9c21 in branch main",
    "==> Using Dockerfile build",
    "Step 1/8 : FROM node:20-slim",
    "Step 2/8 : WORKDIR /app",
    "Step 3/8 : COPY package*.json ./",
    "Step 4/8 : RUN npm ci --omit=dev",
    "  added 412 packages in 9s",
    "Step 5/8 : COPY . .",
    "Step 6/8 : RUN npm run build",
    "  ✓ build complete",
    "Step 7/8 : EXPOSE 3000",
    'Step 8/8 : CMD ["node", "server.js"]',
    "==> Pushing image to registry",
    "==> Deploying via Traefik (auto SSL)",
    "==> Container started, health check passing",
    "==> Deploy live 🚀",
  ];
}
