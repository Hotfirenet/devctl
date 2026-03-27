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
  return `import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "tokens");
const TOKEN_FILE = join(CONFIG_DIR, "${name}-cli");

export function getToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  return readFileSync(TOKEN_FILE, "utf-8").trim() || null;
}

export function saveToken(token: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
}

export function removeToken(): void {
  if (existsSync(TOKEN_FILE)) {
    const { unlinkSync } = require("fs");
    unlinkSync(TOKEN_FILE);
  }
}

export const BASE_URL = process.env.${name.toUpperCase()}_BASE_URL ?? "https://api.example.com/v1";

export const globalFlags = {
  json: false,
  format: "text",
  verbose: false,
  noColor: false,
  noHeader: false,
};
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

  return `import { getToken, BASE_URL } from "./config.js";
import { CliError } from "./errors.js";

const TIMEOUT_MS = 30_000;

function buildHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) throw new CliError(401, "No API token. Run: ${"{CLI_NAME}"} auth set <token>");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ${buildHeaders},
  };
}

async function request(method: string, path: string, opts: { params?: Record<string, unknown>; body?: unknown } = {}): Promise<unknown> {
  let url = \`\${BASE_URL}\${path}\`;
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
import { getToken, saveToken, removeToken } from "../lib/config.js";
import { client } from "../lib/client.js";

export const authCommand = new Command("auth").description("Manage API authentication");

authCommand
  .command("set <token>")
  .description("Save your API token")
  .action((token: string) => {
    saveToken(token);
    console.log("Token saved.");
  });

authCommand
  .command("show")
  .description("Show current token (masked)")
  .option("--reveal", "Show full token")
  .action((opts) => {
    const token = getToken();
    if (!token) { console.log("No token configured."); return; }
    console.log(opts.reveal ? token : \`\${token.slice(0, 8)}...\${token.slice(-4)}\`);
  });

authCommand
  .command("remove")
  .description("Delete the saved token")
  .action(() => {
    removeToken();
    console.log("Token removed.");
  });

authCommand
  .command("test")
  .description("Test the API connection")
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

function templateIndex(name: string): string {
  return `#!/usr/bin/env bun
import { Command } from "commander";
import { globalFlags } from "./lib/config.js";
import { authCommand } from "./commands/auth.js";
// import { exampleResource } from "./resources/example.js";

const program = new Command();

program
  .name("${name}-cli")
  .description("CLI for the ${name} API")
  .version("0.1.0")
  .option("--json", "Output as JSON", false)
  .option("--format <fmt>", "Output format: text, json, csv, yaml", "text")
  .option("--verbose", "Enable verbose logging", false)
  .hook("preAction", (_cmd, action) => {
    const o = action.optsWithGlobals();
    globalFlags.json = o.json ?? false;
    globalFlags.format = o.format ?? "text";
    globalFlags.verbose = o.verbose ?? false;
  });

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
    console.log(`  # edit src/resources/example.ts`);
    console.log(`  devctl cli bundle ${name}`);
    console.log(`  devctl cli link ${name}`);
    console.log(`  devctl cli auth set <your-api-key>`);
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
