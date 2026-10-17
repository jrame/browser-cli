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

  let session = [];
  return commands.map(command => {
    const optionEnd = command.indexOf('--');
    const end = optionEnd === -1 ? command.length : optionEnd;
    let explicitSession = false;
    for (let i = 0; i < end; i++) {
      const arg = command[i];
      if (arg === '-s' || arg === '--session') {
        if (i + 1 >= end || command[i + 1].startsWith('-'))
          throw new Error(`${arg} requires a session name.`);
        session = [arg, command[++i]];
        explicitSession = true;
      } else if (arg.startsWith('-s=') || arg.startsWith('--session=')) {
        if (arg.endsWith('=') && arg.indexOf('=') === arg.length - 1)
          throw new Error('Expected a nonempty session name.');
        session = [arg];
        explicitSession = true;
      }
    }
    return explicitSession ? command : [...session, ...command];
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
