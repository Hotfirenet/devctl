import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, unlinkSync, chmodSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";

const CLI_ROOT = join(homedir(), ".cli");
const BIN_DIR = join(homedir(), ".local", "bin");
const MARKER = "# >>> devctl >>>";
const MARKER_END = "# <<< devctl <<<";

function getCliDir(name: string): string {
  return join(CLI_ROOT, `${name}-cli`);
}

function ensureBinInPath(): void {
  const rc = process.env.ZDOTDIR
    ? join(process.env.ZDOTDIR, ".zshrc")
    : join(homedir(), ".zshrc");

  if (!existsSync(rc)) return;
  const content = readFileSync(rc, "utf-8");
  const exportLine = `export PATH="${BIN_DIR}:$PATH"`;

  if (content.includes(exportLine)) return; // already there

  if (content.includes(MARKER)) {
    // Update existing block
    const updated = content.replace(
      new RegExp(`${MARKER}[\\s\\S]*?${MARKER_END}`),
      `${MARKER}\n${exportLine}\n${MARKER_END}`
    );
    writeFileSync(rc, updated, "utf-8");
  } else {
    appendFileSync(rc, `\n${MARKER}\n${exportLine}\n${MARKER_END}\n`);
  }
}

// ─── Scaffold templates ───────────────────────────────────────────────────────

function templatePackageJson(name: string): string {
  return JSON.stringify({
    name: `${name}-cli`,
    version: "0.1.0",
    description: `CLI for the ${name} API`,
    type: "module",
    bin: { [`${name}-cli`]: "./dist/index.js" },
    scripts: {
      build: "bun build src/index.ts --outfile dist/index.js --target bun",
      dev: "bun run src/index.ts",
    },
    dependencies: { commander: "^13.0.0", picocolors: "^1.1.0" },
    devDependencies: { "@types/bun": "latest", typescript: "^5.7.0" },
  }, null, 2);
}

function templateTsConfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      outDir: "dist",
    },
    include: ["src"],
  }, null, 2);
}

function templateLibConfig(name: string): string {
  const upper = name.toUpperCase();
  return `import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "tokens");
const PROFILES_FILE = join(CONFIG_DIR, "${name}-cli-profiles.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  url: string;
  token: string;
}

interface ProfilesStore {
  default: string | null;
  profiles: Record<string, Profile>;
}

// ─── Global runtime flags (set by --profile in index.ts) ─────────────────────

export const globalFlags = {
  json: false,
  format: "text",
  verbose: false,
  profile: null as string | null,
};

// ─── Profiles file I/O ────────────────────────────────────────────────────────

function loadProfiles(): ProfilesStore {
  // Migrate legacy single-file config on first read
  if (!existsSync(PROFILES_FILE)) {
    const legacyToken = join(CONFIG_DIR, "${name}-cli");
    if (existsSync(legacyToken)) {
      const token = readFileSync(legacyToken, "utf-8").trim();
      const store: ProfilesStore = { default: "default", profiles: { default: { url: "http://localhost/api", token } } };
      _saveProfiles(store);
      return store;
    }
    return { default: null, profiles: {} };
  }
  try { return JSON.parse(readFileSync(PROFILES_FILE, "utf-8")) as ProfilesStore; }
  catch { return { default: null, profiles: {} }; }
}

function _saveProfiles(store: ProfilesStore): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PROFILES_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

function _normalizeUrl(url: string): string {
  return url.replace(/\\/$/, "");
}

// ─── Public profile API ───────────────────────────────────────────────────────

export function listProfiles(): Record<string, Profile> {
  return loadProfiles().profiles;
}

export function getDefaultProfileName(): string | null {
  return loadProfiles().default;
}

export function getProfile(name: string): Profile | null {
  return loadProfiles().profiles[name] ?? null;
}

export function getActiveProfile(): Profile | null {
  if (process.env.${upper}_URL && process.env.${upper}_TOKEN) {
    return { url: process.env.${upper}_URL!, token: process.env.${upper}_TOKEN! };
  }
  const store = loadProfiles();
  const name = globalFlags.profile ?? store.default;
  return name ? (store.profiles[name] ?? null) : null;
}

export function saveProfile(name: string, url: string, token: string, setDefault = false): void {
  const store = loadProfiles();
  store.profiles[name] = { url: _normalizeUrl(url), token };
  if (setDefault || !store.default) store.default = name;
  _saveProfiles(store);
}

export function deleteProfile(name: string): boolean {
  const store = loadProfiles();
  if (!store.profiles[name]) return false;
  delete store.profiles[name];
  if (store.default === name) {
    const remaining = Object.keys(store.profiles);
    store.default = remaining[0] ?? null;
  }
  _saveProfiles(store);
  return true;
}

export function setDefaultProfile(name: string): boolean {
  const store = loadProfiles();
  if (!store.profiles[name]) return false;
  store.default = name;
  _saveProfiles(store);
  return true;
}

// ─── Legacy single-profile helpers (used by auth command) ────────────────────

export function getToken(): string | null {
  return getActiveProfile()?.token ?? null;
}

export function getBaseUrl(): string {
  return getActiveProfile()?.url ?? "http://localhost/api";
}

export function saveToken(token: string): void {
  const store = loadProfiles();
  const name = globalFlags.profile ?? store.default ?? "default";
  const existing = store.profiles[name];
  if (existing) { existing.token = token; _saveProfiles(store); }
  else saveProfile(name, "http://localhost/api", token, true);
}

export function saveBaseUrl(url: string): void {
  const store = loadProfiles();
  const name = globalFlags.profile ?? store.default ?? "default";
  const existing = store.profiles[name];
  if (existing) { existing.url = _normalizeUrl(url); _saveProfiles(store); }
  else saveProfile(name, url, "", true);
}

export function removeToken(): void {
  const store = loadProfiles();
  const name = globalFlags.profile ?? store.default;
  if (name && store.profiles[name]) { store.profiles[name].token = ""; _saveProfiles(store); }
}
`;
}

function templateLibErrors(): string {
  return `export class CliError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function handleError(err: unknown, asJson = false): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (asJson) {
    console.error(JSON.stringify({ error: msg }));
  } else {
    console.error(\`Error: \${msg}\`);
  }
  process.exit(1);
}
`;
}

function templateLibOutput(): string {
  return `import { globalFlags } from "./config.js";

export function output(data: unknown, opts: { json?: boolean; format?: string } = {}): void {
  const useJson = opts.json || globalFlags.json || opts.format === "json";
  if (useJson || data === null || typeof data !== "object") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}
`;
}

function templateLibClient(baseUrl: string, authType: string, authHeader: string): string {
  const buildHeaders = authType === "bearer"
    ? `"Authorization": \`Bearer \${token}\``
    : `"${authHeader}": token`;

  return `import { getToken, getBaseUrl } from "./config.js";
import { CliError } from "./errors.js";

const TIMEOUT_MS = 30_000;

function buildHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) throw new CliError(401, "No token. Run: ${"{CLI_NAME}"} profile add --name default --url <url> --token <token>");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ${buildHeaders},
  };
}

async function request(method: string, path: string, opts: { params?: Record<string, unknown>; body?: unknown } = {}): Promise<unknown> {
  const url0 = getBaseUrl();
  let url = \`\${url0}\${path}\`;
  if (opts.params) {
    const filtered = Object.fromEntries(
      Object.entries(opts.params).filter(([, v]) => v !== undefined && v !== "")
    );
    if (Object.keys(filtered).length) url += \`?\${new URLSearchParams(filtered as Record<string, string>)}\`;
  }

  const res = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as Record<string, unknown>)?.message ?? res.statusText;
    throw new CliError(res.status, \`\${res.status}: \${String(msg)}\`);
  }
  return data;
}

export const client = {
  get: (path: string, params?: Record<string, unknown>) => request("GET", path, { params }),
  post: (path: string, body?: unknown) => request("POST", path, { body }),
  patch: (path: string, body?: unknown) => request("PATCH", path, { body }),
  put: (path: string, body?: unknown) => request("PUT", path, { body }),
  delete: (path: string) => request("DELETE", path),
};
`;
}

function templateAuthCommand(name: string): string {
  return `import { Command } from "commander";
import { getToken, saveToken, saveBaseUrl, getBaseUrl, removeToken } from "../lib/config.js";
import { client } from "../lib/client.js";

export const authCommand = new Command("auth").description("Manage authentication for the active profile");

authCommand
  .command("set <token>")
  .description("Save API token for the active profile")
  .action((token: string) => {
    saveToken(token);
    console.log("Token saved.");
  });

authCommand
  .command("url <url>")
  .description("Set the base URL for the active profile")
  .action((url: string) => {
    saveBaseUrl(url);
    console.log(\`URL saved: \${getBaseUrl()}\`);
  });

authCommand
  .command("show")
  .description("Show token for the active profile (masked)")
  .option("--reveal", "Show full token")
  .action((opts) => {
    const token = getToken();
    if (!token) { console.log("No token configured."); return; }
    console.log(opts.reveal ? token : \`\${token.slice(0, 8)}...\${token.slice(-4)}\`);
  });

authCommand
  .command("remove")
  .description("Remove token for the active profile")
  .action(() => {
    removeToken();
    console.log("Token removed.");
  });

authCommand
  .command("test")
  .description("Test the API connection for the active profile")
  .action(async () => {
    try {
      await client.get("/");
      console.log("Connection OK.");
    } catch (err) {
      console.error("Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });
`;
}

function templateProfileCommand(name: string): string {
  return `import { Command } from "commander";
import {
  listProfiles,
  getDefaultProfileName,
  saveProfile,
  deleteProfile,
  setDefaultProfile,
  getProfile,
  globalFlags,
} from "../lib/config.js";
import { client } from "../lib/client.js";

export const profileCommand = new Command("profile").description("Manage instances/profiles (multiple API endpoints)");

profileCommand
  .command("list")
  .description("List all configured profiles")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const profiles = listProfiles();
    const def = getDefaultProfileName();
    if (opts.json) { console.log(JSON.stringify({ default: def, profiles }, null, 2)); return; }
    const entries = Object.entries(profiles);
    if (!entries.length) {
      console.log("No profiles. Run: ${name}-cli profile add --name prod --url https://... --token ...");
      return;
    }
    const rows = entries.map(([n, p]) => ({
      name: n === def ? \`\${n} *\` : n,
      url: p.url,
      token: p.token ? \`\${p.token.slice(0, 6)}...\${p.token.slice(-3)}\` : "(none)",
    }));
    const w = { name: 4, url: 3, token: 5 };
    for (const r of rows) { w.name = Math.max(w.name, r.name.length); w.url = Math.max(w.url, r.url.length); w.token = Math.max(w.token, r.token.length); }
    const fmt = (r: typeof rows[0]) => \`  \${r.name.padEnd(w.name)}  \${r.url.padEnd(w.url)}  \${r.token}\`;
    console.log(\`\\n  \${"NAME".padEnd(w.name)}  \${"URL".padEnd(w.url)}  TOKEN\\n  \${"─".repeat(w.name)}  \${"─".repeat(w.url)}  \${"─".repeat(w.token)}\`);
    for (const r of rows) console.log(fmt(r));
    console.log(\`\\n  * = default\\n\`);
  });

profileCommand
  .command("add")
  .description("Add or update a profile")
  .requiredOption("--name <s>", "Profile name (e.g. prod, staging)")
  .requiredOption("--url <s>",  "API base URL")
  .requiredOption("--token <s>", "API token")
  .option("--default", "Set as default profile")
  .action((opts) => {
    saveProfile(opts.name, opts.url, opts.token, opts.default ?? false);
    console.log(\`✓ Profile '\${opts.name}' saved.\${opts.default ? " (set as default)" : ""}\`);
  });

profileCommand
  .command("use <name>")
  .description("Set the default profile")
  .action((name) => {
    if (!setDefaultProfile(name)) { console.error(\`Profile '\${name}' not found.\`); process.exit(1); }
    console.log(\`✓ Default profile set to '\${name}'.\`);
  });

profileCommand
  .command("show <name>")
  .description("Show a profile's details")
  .action((name) => {
    const p = getProfile(name);
    if (!p) { console.error(\`Profile '\${name}' not found.\`); process.exit(1); }
    console.log(\`\\n  name   \${name}\\n  url    \${p.url}\\n  token  \${p.token ? \`\${p.token.slice(0, 6)}...\${p.token.slice(-3)}\` : "(none)"}\\n\`);
  });

profileCommand
  .command("remove <name>")
  .description("Remove a profile")
  .option("--yes", "Skip confirmation")
  .action(async (name, opts) => {
    if (!opts.yes) {
      process.stdout.write(\`Remove profile '\${name}'? [y/N] \`);
      const answer = await new Promise<string>(r => process.stdin.once("data", d => r(d.toString().trim())));
      if (!["y", "yes"].includes(answer.toLowerCase())) { console.log("Aborted."); return; }
    }
    if (!deleteProfile(name)) { console.error(\`Profile '\${name}' not found.\`); process.exit(1); }
    console.log(\`✓ Profile '\${name}' removed.\`);
  });

profileCommand
  .command("test [name]")
  .description("Test connection for a profile (defaults to active profile)")
  .action(async (name) => {
    if (name) {
      if (!getProfile(name)) { console.error(\`Profile '\${name}' not found.\`); process.exit(1); }
      globalFlags.profile = name;
    }
    try {
      await client.get("/");
      console.log(\`✓ Connection OK\${name ? \` (\${name})\` : ""}.\`);
    } catch (err) {
      console.error("Connection failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });
`;
}

function templateIndex(name: string): string {
  return `#!/usr/bin/env bun
import { Command } from "commander";
import { globalFlags } from "./lib/config.js";
import { authCommand } from "./commands/auth.js";
import { profileCommand } from "./commands/profile.js";
// import { exampleResource } from "./resources/example.js";

const program = new Command();

program
  .name("${name}-cli")
  .description("CLI for the ${name} API")
  .version("0.1.0")
  .option("--json", "Output as JSON", false)
  .option("--profile <name>", "Use a specific profile (overrides default)")
  .option("--verbose", "Enable verbose logging", false)
  .hook("preAction", (_cmd, action) => {
    const o = action.optsWithGlobals();
    globalFlags.json    = o.json    ?? false;
    globalFlags.verbose = o.verbose ?? false;
    globalFlags.profile = o.profile ?? null;
  });

program.addCommand(profileCommand);
program.addCommand(authCommand);
// program.addCommand(exampleResource);

program.parse();
`;
}

function templateExampleResource(name: string): string {
  return `import { Command } from "commander";
import { client } from "../lib/client.js";
import { output } from "../lib/output.js";
import { handleError } from "../lib/errors.js";

export const exampleResource = new Command("example")
  .description("Example resource — replace this with your first resource");

exampleResource
  .command("list")
  .description("List all items")
  .option("--limit <n>", "Max results", "50")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    try {
      const data = await client.get("/items", { limit: opts.limit });
      output(data, { json: opts.json });
    } catch (err) { handleError(err, opts.json); }
  });
`;
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export const cliCommand = new Command("cli")
  .description("Scaffold, build and link API CLIs");

cliCommand
  .command("create <name>")
  .description("Scaffold a new CLI project in ~/.cli/{name}-cli/")
  .requiredOption("--base-url <url>", "API base URL (e.g. https://api.brevo.com/v3)")
  .option("--auth-type <type>", "Auth type: apikey or bearer", "apikey")
  .option("--auth-header <header>", "API key header name", "api-key")
  .option("--force", "Overwrite if already exists")
  .addHelpText("after", "\nExample:\n  devctl cli create stripe --base-url https://api.stripe.com/v1 --auth-type bearer")
  .action((name: string, opts) => {
    const dir = getCliDir(name);
    if (existsSync(dir) && !opts.force) {
      console.error(`"${name}-cli" already exists at ${dir}. Use --force to overwrite.`);
      process.exit(1);
    }

    console.log(`Scaffolding ${name}-cli in ${dir}...`);

    const dirs = [
      dir,
      join(dir, "src"),
      join(dir, "src", "lib"),
      join(dir, "src", "commands"),
      join(dir, "src", "resources"),
      join(dir, "dist"),
    ];
    for (const d of dirs) mkdirSync(d, { recursive: true });

    const files: Record<string, string> = {
      "package.json": templatePackageJson(name),
      "tsconfig.json": templateTsConfig(),
      "src/lib/config.ts": templateLibConfig(name),
      "src/lib/errors.ts": templateLibErrors(),
      "src/lib/output.ts": templateLibOutput(),
      "src/lib/client.ts": templateLibClient(opts.baseUrl, opts.authType, opts.authHeader)
        .replace(/\$\{"{CLI_NAME}"\}/g, `${name}-cli`),
      "src/commands/auth.ts": templateAuthCommand(name),
      "src/commands/profile.ts": templateProfileCommand(name),
      "src/index.ts": templateIndex(name),
      "src/resources/example.ts": templateExampleResource(name),
    };

    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content, "utf-8");
    }

    console.log(`\nCreated:\n  ${Object.keys(files).map(f => `  ${f}`).join("\n  ")}`);
    console.log(`\nNext steps:`);
    console.log(`  cd ${dir}`);
    console.log(`  bun install`);
    console.log(`  devctl cli bundle ${name}`);
    console.log(`  devctl cli link ${name}`);
    console.log(`  ${name}-cli profile add --name default --url <base-url> --token <api-token>`);
    console.log(`  # add more instances:`);
    console.log(`  ${name}-cli profile add --name staging --url <staging-url> --token <token>`);
    console.log(`  # edit src/resources/example.ts then devctl cli rebuild ${name}`);
  });

cliCommand
  .command("bundle <name>")
  .description("Build a CLI project with bun")
  .action(async (name: string) => {
    const dir = getCliDir(name);
    if (!existsSync(dir)) {
      console.error(`CLI "${name}" not found at ${dir}`);
      process.exit(1);
    }

    // bun install first if needed
    if (!existsSync(join(dir, "node_modules"))) {
      console.log("Installing dependencies...");
      const install = spawnSync("bun", ["install"], { cwd: dir, stdio: "inherit" });
      if (install.status !== 0) process.exit(1);
    }

    console.log(`Building ${name}-cli...`);
    const build = spawnSync("bun", ["build", "src/index.ts", "--outfile", "dist/index.js", "--target", "bun"], {
      cwd: dir,
      stdio: "inherit",
    });

    if (build.status !== 0) {
      console.error("Build failed.");
      process.exit(1);
    }

    const size = Bun.file(join(dir, "dist/index.js")).size;
    console.log(`✓ Built ${name}-cli (${(size / 1024).toFixed(1)}KB)`);
  });

cliCommand
  .command("link <name>")
  .description("Symlink CLI to ~/.local/bin/")
  .action((name: string) => {
    const dir = getCliDir(name);
    const dist = join(dir, "dist", "index.js");

    if (!existsSync(dist)) {
      console.error(`No build found. Run: devctl cli bundle ${name}`);
      process.exit(1);
    }

    mkdirSync(BIN_DIR, { recursive: true });
    chmodSync(dist, 0o755);

    const linkPath = join(BIN_DIR, `${name}-cli`);
    if (existsSync(linkPath)) unlinkSync(linkPath);
    symlinkSync(dist, linkPath);

    ensureBinInPath();
    console.log(`✓ Linked ${name}-cli → ${linkPath}`);
    console.log(`  (PATH updated in ~/.zshrc if needed)`);
  });

cliCommand
  .command("list")
  .description("List all CLIs in ~/.cli/")
  .action(() => {
    if (!existsSync(CLI_ROOT)) {
      console.log("No CLIs found.");
      return;
    }
    const clis = readdirSync(CLI_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.endsWith("-cli"))
      .map(d => d.name.replace(/-cli$/, ""));

    if (clis.length === 0) { console.log("No CLIs found."); return; }
    console.log(`CLIs in ${CLI_ROOT}:\n`);
    for (const name of clis) {
      const distDir = join(getCliDir(name), "dist");
      const hasDistrib = existsSync(join(distDir, "index.js")) || existsSync(join(distDir, `${name}-cli.js`));
      const isLinked = existsSync(join(BIN_DIR, `${name}-cli`));
      const status = hasDistrib ? (isLinked ? "built + linked" : "built") : "not built";
      console.log(`  ${name}-cli  [${status}]`);
    }
  });

cliCommand
  .command("migrate <name>")
  .description("Upgrade an existing CLI to multi-profile support")
  .option("--dry-run", "Show what would change without writing")
  .action((name: string, opts) => {
    const dir = getCliDir(name);
    if (!existsSync(dir)) {
      console.error(`CLI "${name}" not found at ${dir}`);
      process.exit(1);
    }

    // Detect CLI name from package.json if available
    let cliName = name;
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        cliName = pkg.name?.replace(/-cli$/, "") ?? name;
      } catch { /* ignore */ }
    }

    const overwrites: Record<string, string> = {};

    // config.ts: only replace if it's still the old single-token format
    const currentConfig = join(dir, "src/lib/config.ts");
    if (!existsSync(currentConfig) || !readFileSync(currentConfig, "utf-8").includes("PROFILES_FILE")) {
      overwrites["src/lib/config.ts"] = templateLibConfig(cliName);
    }

    // client.ts: only patch if it still uses the old BASE_URL import
    const clientPath = join(dir, "src/lib/client.ts");
    if (existsSync(clientPath)) {
      const clientSrc = readFileSync(clientPath, "utf-8");
      if (clientSrc.includes("BASE_URL") && clientSrc.includes("from \"./config.js\"")) {
        overwrites["src/lib/client.ts"] = clientSrc
          .replace(/import\s*\{([^}]*)\bBASE_URL\b([^}]*)\}\s*from\s*"\.\/config\.js"/, (_, pre, post) => {
            const parts = (pre + post).split(",").map((s: string) => s.trim()).filter(Boolean);
            if (!parts.includes("getBaseUrl")) parts.push("getBaseUrl");
            return `import { ${parts.join(", ")} } from "./config.js"`;
          })
          .replace(/`\$\{BASE_URL\}/g, "`${getBaseUrl()}");
      }
    }

    // auth.ts: only patch if it uses the old single-token imports
    const authPath = join(dir, "src/commands/auth.ts");
    if (existsSync(authPath)) {
      const authSrc = readFileSync(authPath, "utf-8");
      if (!authSrc.includes("saveBaseUrl")) {
        overwrites["src/commands/auth.ts"] = templateAuthCommand(cliName);
      }
    }

    // profile.ts: add if missing
    const profilePath = join(dir, "src/commands/profile.ts");
    if (!existsSync(profilePath)) {
      overwrites["src/commands/profile.ts"] = templateProfileCommand(cliName);
    }

    // index.ts: patch to add --profile flag and profileCommand
    const indexPath = join(dir, "src/index.ts");
    if (existsSync(indexPath)) {
      let src = readFileSync(indexPath, "utf-8");
      let changed = false;

      // Add profile import if missing
      if (!src.includes("profileCommand")) {
        src = src.replace(
          /import \{ authCommand \} from "\.\/commands\/auth\.js";/,
          `import { authCommand } from "./commands/auth.js";\nimport { profileCommand } from "./commands/profile.js";`
        );
        changed = true;
      }

      // Add --profile option if missing
      if (!src.includes("--profile")) {
        src = src.replace(
          /\.option\("--json"/,
          `.option("--profile <name>", "Use a specific profile (overrides default)")\n  .option("--json"`
        );
        changed = true;
      }

      // Add globalFlags.profile in hook if missing
      if (!src.includes("globalFlags.profile")) {
        // Match any assignment to globalFlags.json regardless of the variable name used
        src = src.replace(
          /globalFlags\.json\s*=[^\n]+\n/,
          (m) => m + `    globalFlags.profile = (actionCmd ?? _cmd).optsWithGlobals().profile ?? null;\n`
        );
        changed = true;
      }

      // Register profileCommand if missing
      if (!src.includes("addCommand(profileCommand)")) {
        src = src.replace(
          /program\.addCommand\(authCommand\)/,
          `program.addCommand(profileCommand);\nprogram.addCommand(authCommand)`
        );
        changed = true;
      }

      if (changed) overwrites["src/index.ts"] = src;
    }

    // Scan all .ts files (excluding the ones we're overwriting) for imports
    // of legacy config constants that won't exist in the new config.ts
    const legacyConfigExports = ["TOKEN_PATH", "BASE_URL", "AUTH_TYPE", "AUTH_HEADER", "APP_CLI"];
    const newConfigExports = [
      "globalFlags", "getToken", "getBaseUrl", "saveToken", "saveBaseUrl", "removeToken",
      "getActiveProfile", "getProfile", "listProfiles", "getDefaultProfileName",
      "saveProfile", "deleteProfile", "setDefaultProfile", "Profile",
    ];
    const warnings: string[] = [];

    const srcDir = join(dir, "src");
    function scanDir(d: string) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) { scanDir(full); continue; }
        if (!entry.name.endsWith(".ts")) continue;
        const rel = full.replace(dir + "/", "");
        if (overwrites[rel]) continue; // will be replaced anyway
        const src = readFileSync(full, "utf-8");
        // Find imports from config.js
        const match = src.match(/import\s*\{([^}]+)\}\s*from\s*["'].*config\.js["']/);
        if (!match) continue;
        const imported = match[1].split(",").map((s: string) => s.trim().split(/\s+as\s+/)[0].trim());
        const broken = imported.filter((i: string) => legacyConfigExports.includes(i) && !newConfigExports.includes(i));
        if (broken.length > 0) {
          warnings.push(`  ⚠  ${rel} imports { ${broken.join(", ")} } from config.ts — needs manual update`);
        }
      }
    }
    if (existsSync(srcDir)) scanDir(srcDir);

    if (Object.keys(overwrites).length === 0 && warnings.length === 0) {
      console.log(`✓ ${name}-cli is already up to date.`);
      return;
    }

    console.log(`\nMigrating ${name}-cli to multi-profile support:\n`);
    for (const rel of Object.keys(overwrites)) {
      const exists = existsSync(join(dir, rel));
      console.log(`  ${exists ? "update" : "create"}  ${rel}`);
    }

    if (warnings.length > 0) {
      console.log(`\nManual fixes required after migration:\n${warnings.join("\n")}`);
      console.log(`  → Replace legacy config imports with getActiveProfile(), saveToken(), etc.`);
    }

    if (opts.dryRun) {
      console.log("\n(dry run — nothing written)");
      return;
    }

    for (const [rel, content] of Object.entries(overwrites)) {
      writeFileSync(join(dir, rel), content, "utf-8");
    }

    if (warnings.length > 0) {
      console.log(`\n⚠  Migration done with warnings — fix the files above before rebuilding.`);
    } else {
      console.log(`\n✓ Migration done. Run: devctl cli rebuild ${name}`);
    }
  });

cliCommand
  .command("rebuild <name>")
  .description("Bundle + link in one step")
  .action(async (name: string) => {
    // delegate to bundle then link
    console.log(`Rebuilding ${name}-cli...`);
    const dir = getCliDir(name);
    if (!existsSync(dir)) {
      console.error(`CLI "${name}" not found.`); process.exit(1);
    }
    const build = spawnSync("bun", ["build", "src/index.ts", "--outfile", "dist/index.js", "--target", "bun"], {
      cwd: dir, stdio: "inherit",
    });
    if (build.status !== 0) { console.error("Build failed."); process.exit(1); }

    const dist = join(dir, "dist", "index.js");
    chmodSync(dist, 0o755);
    const linkPath = join(BIN_DIR, `${name}-cli`);
    if (existsSync(linkPath)) unlinkSync(linkPath);
    symlinkSync(dist, linkPath);
    ensureBinInPath();
    const size = Bun.file(dist).size;
    console.log(`✓ Rebuilt and linked ${name}-cli (${(size / 1024).toFixed(1)}KB)`);
  });
