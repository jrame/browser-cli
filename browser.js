#!/usr/bin/env node
// Local fork of microsoft/playwright-cli, licensed under Apache-2.0.
const path = require('path');
const { coreDirectory } = require('./scripts/runtime.cjs');
const { checkInstalledSkills } = require('./skillCheck');
const { splitCommands, runCommands } = require('./scripts/command-chain.cjs');

async function main() {
  const argv = process.argv.slice(2);
  const commands = splitCommands(argv);
  if (commands) {
    process.exitCode = await runCommands(commands, __filename);
    return;
  }
  const core = coreDirectory();
  if (!process.env.CI && !process.env.NO_UPDATE_NOTIFIER)
    checkInstalledSkills();
  const { program } = require(path.join(core, 'lib', 'tools', 'cli-client', 'program.js'));
  const optionEnd = argv.indexOf('--');
  const flags = optionEnd === -1 ? argv : argv.slice(0, optionEnd);
  if ((!argv.length || flags.some(arg => arg === '--help' || arg === '-h')) && !flags.some(arg => /^--json(?:=|$)/.test(arg)))
    process.stdout.write('Command chaining: browser -s=ff type "Buy groceries" --then press Enter\nRuns in order, inherits the session, stops on failure, and emits one final automatic snapshot. Other flags apply per command.\n\n');
  await program({ embedderVersion: require('./package.json').version });
}

main().catch(error => {
  process.stderr.write(`browser: ${error.message}\n`);
  process.exitCode = 1;
});
