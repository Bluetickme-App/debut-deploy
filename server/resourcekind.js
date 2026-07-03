// Map Coolify resource metadata to a Render-style display kind. Pure + deterministic.
// cron_job / preview kinds are phase-2 and never derived here.
const KEY_VALUE = /^(redis|keydb|dragonfly|valkey)/i;

export function deriveResourceKind({ type, image = "", buildPack = "", hasDomain = true, startCommand = "" } = {}) {
  if (type === "database") {
    return KEY_VALUE.test(String(image).replace(/^.*\//, "")) ? "key_value" : "postgres";
  }
  if (String(buildPack).toLowerCase() === "static") return "static_site";
  const worker = /worker|queue|consumer|:workers\b/i.test(String(startCommand));
  if (worker && hasDomain === false) return "background_worker";
  return "web_service";
}
