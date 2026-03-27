# devctl

**Your personal dev toolkit for Claude Code — zero telemetry, zero registry.**

Scaffold typed API CLIs in seconds and manage your Claude Code skills directly from the terminal.

```bash
devctl skills add Hotfirenet/my-skill   # install a skill from GitHub
devctl cli create stripe \               # scaffold a full API CLI
  --base-url https://api.stripe.com/v1 \
  --auth-type bearer
devctl cli rebuild stripe                # build + link in one step
```

---

## Why devctl?

Most CLI scaffolding tools send telemetry on every command, rely on a centralized registry, and inject user input into generated code without sanitization.

devctl does the same job — skills management + CLI scaffolding — with none of that:

| | Other tools | devctl |
|---|---|---|
| Telemetry | Sent on every install | None |
| Registry | Centralized | None (GitHub raw) |
| Template injection | Unsanitized | Escaped |
| Skills targets | Multiple agents | Claude + Cursor |
| Source | Closed registry | Your GitHub |

---

## Install

**Requirements:** [Bun](https://bun.sh) ≥ 1.0, macOS or Linux.

```bash
git clone git@github.com:Hotfirenet/devctl.git ~/.cli/devctl
cd ~/.cli/devctl && bun install
bun build src/index.ts --outfile dist/index.js --target bun
ln -sf ~/.cli/devctl/dist/index.js ~/.local/bin/devctl
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

---

## Skills

Install Claude Code skills from any GitHub repo that has a `SKILL.md` at its root.

```bash
devctl skills add Hotfirenet/my-skill       # from GitHub
devctl skills add owner/repo                # any public repo with a SKILL.md
devctl skills add ./path/to/SKILL.md        # from local file
devctl skills add-local ./SKILL.md --name my-skill

devctl skills list                          # list installed skills with descriptions
devctl skills show my-skill                 # print SKILL.md content
devctl skills remove my-skill              # uninstall
```

Skills are installed to `~/.claude/skills/` (and `~/.cursor/skills/` if present).
A skill is just a `SKILL.md` file — see the [Claude Code skill format](https://docs.anthropic.com/en/docs/claude-code/skills).

---

## CLI scaffold

Generate a fully typed, Commander.js + Bun API CLI in one command.

```bash
devctl cli create stripe \
  --base-url https://api.stripe.com/v1 \
  --auth-type bearer

devctl cli bundle stripe    # build with bun
devctl cli link stripe      # symlink to ~/.local/bin/stripe-cli
devctl cli rebuild stripe   # bundle + link in one step

devctl cli list             # list all CLIs and their status
```

The scaffold generates `~/.cli/stripe-cli/` with a production-ready structure:

```
stripe-cli/
├── src/
│   ├── index.ts              # entry point
│   ├── lib/
│   │   ├── client.ts         # HTTP client with retry + auth
│   │   ├── config.ts         # token storage, base URL, global flags
│   │   ├── errors.ts         # typed error handling
│   │   └── output.ts         # JSON / text output
│   ├── commands/
│   │   └── auth.ts           # auth set / show / remove / test
│   └── resources/
│       └── example.ts        # starter resource to copy from
├── package.json
└── tsconfig.json
```

Add a resource, rebuild, done:

```bash
# 1. create src/resources/customers.ts
# 2. register it in src/index.ts
devctl cli rebuild stripe
stripe-cli customers list --json
```

### Auth options

| Flag | Values | Description |
|------|--------|-------------|
| `--auth-type` | `apikey` (default), `bearer` | How the token is sent |
| `--auth-header` | `api-key` (default) | Header name for apikey auth |

Token storage: `~/.config/tokens/{name}-cli` (mode 600).

```bash
stripe-cli auth set sk_live_xxx
stripe-cli auth show
stripe-cli auth remove
stripe-cli auth test        # makes a live API call to verify
```

---

## Update

```bash
cd ~/.cli/devctl && git pull
bun build src/index.ts --outfile dist/index.js --target bun
```

---

## License

[MIT](./LICENSE)
