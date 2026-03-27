import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");
const CURSOR_SKILLS_DIR = join(homedir(), ".cursor", "skills");

const AGENT_DIRS = [
  { name: "Claude Code", path: CLAUDE_SKILLS_DIR },
  { name: "Cursor", path: CURSOR_SKILLS_DIR },
];

async function fetchSkillFile(owner: string, repo: string): Promise<string> {
  const branches = ["main", "master"];
  const paths = ["SKILL.md", "skill.md", "docs/SKILL.md"];

  for (const branch of branches) {
    for (const path of paths) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const res = await fetch(url);
      if (res.ok) return await res.text();
    }
  }

  throw new Error(`No SKILL.md found in ${owner}/${repo} (tried main/master branches)`);
}

function installSkill(name: string, content: string): void {
  for (const agent of AGENT_DIRS) {
    if (!existsSync(join(agent.path, ".."))) continue;
    const skillDir = join(agent.path, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content, "utf-8");
    console.log(`  ✓ ${agent.name}: ${skillDir}/SKILL.md`);
  }
}

export const skillsCommand = new Command("skills")
  .description("Manage Claude Code skills");

skillsCommand
  .command("add <source>")
  .description("Install a skill from GitHub (owner/repo) or a local file path")
  .option("--name <name>", "Override skill name (default: repo name)")
  .action(async (source: string, opts) => {
    // Local file
    if (source.startsWith("/") || source.startsWith(".")) {
      const content = readFileSync(source, "utf-8");
      const name = opts.name ?? source.split("/").pop()?.replace(/\.md$/i, "") ?? "skill";
      console.log(`Installing skill "${name}" from local file...`);
      installSkill(name, content);
      console.log(`\nDone.`);
      return;
    }

    // GitHub owner/repo
    const parts = source.replace("https://github.com/", "").split("/");
    if (parts.length < 2) {
      console.error("Error: source must be owner/repo or a file path");
      process.exit(1);
    }
    const [owner, repo] = parts;
    const name = opts.name ?? repo.replace(/-skill$/, "");

    console.log(`Fetching skill from github.com/${owner}/${repo}...`);
    const content = await fetchSkillFile(owner, repo);
    console.log(`Installing skill "${name}"...`);
    installSkill(name, content);
    console.log(`\nDone. Restart Claude Code to use the skill.`);
  });

skillsCommand
  .command("add-local <file>")
  .description("Install a skill from a local SKILL.md file")
  .requiredOption("--name <name>", "Skill name")
  .action((file: string, opts) => {
    if (!existsSync(file)) {
      console.error(`Error: file not found: ${file}`);
      process.exit(1);
    }
    const content = readFileSync(file, "utf-8");
    console.log(`Installing skill "${opts.name}"...`);
    installSkill(opts.name, content);
    console.log(`\nDone. Restart Claude Code to use the skill.`);
  });

skillsCommand
  .command("list")
  .description("List installed skills")
  .action(() => {
    if (!existsSync(CLAUDE_SKILLS_DIR)) {
      console.log("No skills directory found.");
      return;
    }
    const skills = readdirSync(CLAUDE_SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    if (skills.length === 0) {
      console.log("No skills installed.");
      return;
    }

    console.log(`Installed skills (${skills.length}):\n`);
    for (const skill of skills) {
      const skillFile = join(CLAUDE_SKILLS_DIR, skill, "SKILL.md");
      let description = "";
      if (existsSync(skillFile)) {
        const content = readFileSync(skillFile, "utf-8");
        const match = content.match(/^description:\s*[>|]?\s*\n?\s*(.+)/m);
        if (match) description = `— ${match[1].trim()}`;
      }
      console.log(`  ${skill} ${description}`);
    }
  });

skillsCommand
  .command("remove <name>")
  .description("Remove an installed skill")
  .action((name: string) => {
    let removed = false;
    for (const agent of AGENT_DIRS) {
      const skillDir = join(agent.path, name);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true });
        console.log(`  ✓ Removed from ${agent.name}`);
        removed = true;
      }
    }
    if (!removed) {
      console.error(`Skill "${name}" not found.`);
      process.exit(1);
    }
  });

skillsCommand
  .command("show <name>")
  .description("Show SKILL.md content for an installed skill")
  .action((name: string) => {
    const skillFile = join(CLAUDE_SKILLS_DIR, name, "SKILL.md");
    if (!existsSync(skillFile)) {
      console.error(`Skill "${name}" not found.`);
      process.exit(1);
    }
    console.log(readFileSync(skillFile, "utf-8"));
  });
