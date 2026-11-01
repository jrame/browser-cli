const { spawn } = require('child_process');

function splitCommands(argv) {
  const commands = [[]];
  let positional = false;
  for (const arg of argv) {
    if (!positional && arg === '--then') {
      if (!commands.at(-1).length)
        throw new Error('Expected a command before --then.');
      commands.push([]);
    } else {
      commands.at(-1).push(arg);
      if (arg === '--')
        positional = true;
    }
  }
  if (commands.length === 1)
    return null;
  if (!commands.at(-1).length)
    throw new Error('Expected a command after --then.');

  const path = require('path');
  const { coreDirectory } = require('./runtime.cjs');
  const core = coreDirectory();
  const { minimist } = require(path.join(core, 'lib/tools/cli-client/minimist.js'));
  const { rejectSessionFlags, takeSessionArgument } = require(path.join(core, 'lib/tools/cli-client/program.js'));
  const help = require(path.join(core, 'lib/tools/cli-client/help.json'));
  const options = { boolean: [...help.booleanOptions, 'inline', 'all', 'g', 'help', 'json', 'raw', 'version'], string: ['_'] };
  let session;
  let unknownCommand = false;
  return commands.map(command => {
    if (unknownCommand)
      return command;
    const args = minimist(command, options);
    rejectSessionFlags(args);
    const name = args._[0];
    const metadata = help.commands[name];
    if (!metadata) {
      unknownCommand = true;
      return command;
    }
    if (metadata.session === 'none')
      return command;
    if (session === undefined) {
      takeSessionArgument(args, metadata);
      session = args.session;
      return command;
    }
    // Locate the command token, skipping any option values with the same text.
    const index = command.findIndex((arg, i) => arg === name && minimist(command.slice(0, i + 1), options)._[0] === name);
    const expanded = [...command];
    expanded.splice(index + 1, 0, session);
    return expanded;
  });
}

async function runCommands(commands, cliPath) {
  for (const [index, args] of commands.entries()) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        stdio: 'inherit', windowsHide: true,
        env: { ...process.env, BROWSER_CLI_CHAIN_SNAPSHOT: index === commands.length - 1 ? 'final' : 'intermediate' },
      });
      let interrupted;
      const interrupt = () => { interrupted = 130; child.kill('SIGINT'); };
      const terminate = () => { interrupted = 143; child.kill('SIGTERM'); };
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
        resolve(interrupted ?? code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
      });
    });
    if (code !== 0)
      return code;
  }
  return 0;
}

module.exports = { splitCommands, runCommands };
