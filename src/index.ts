#!/usr/bin/env bun
import { Command } from "commander";
import { skillsCommand } from "./commands/skills.js";
import { cliCommand } from "./commands/cli.js";

const program = new Command();

program
  .name("devctl")
  .description("Personal dev tools — skills & CLI manager (no telemetry)")
  .version("1.0.0");

program.addCommand(skillsCommand);
program.addCommand(cliCommand);

program.parse();
