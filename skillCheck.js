/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// @ts-check

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function bundledSkillFile() {
  const corePath = require('./scripts/runtime.cjs').coreDirectory();
  return path.join(corePath, 'lib', 'tools', 'skills', 'browser', 'SKILL.md');
}

function installedSkillTargets() {
  const cwd = process.cwd();
  return [
    { dir: path.join(cwd, '.claude', 'skills', 'browser'), command: 'browser install --skills' },
    { dir: path.join(cwd, '.agents', 'skills', 'browser'), command: 'browser install --skills=agents' },
  ];
}

/**
 * @param {string} file
 * @returns
 */
function readSkill(file) {
  // Normalize line endings, they could be affected by git or editor settings.
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function frame(lines) {
  const width = Math.max(...lines.map(line => line.length));
  const top = '╔' + '═'.repeat(width + 2) + '╗';
  const bottom = '╚' + '═'.repeat(width + 2) + '╝';
  const body = lines.map(line => `║ ${line.padEnd(width)} ║`);
  return [top, ...body, bottom].join('\n') + '\n';
}

function checkInstalledSkills() {
  try {
    const bundled = readSkill(bundledSkillFile());
    if (!bundled)
      return;
    const cacheFile = path.join(process.cwd(), '.logs', 'browser-cli', 'skill-check.json');
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
    let changed = false;
    for (const target of installedSkillTargets()) {
      const installed = readSkill(path.join(target.dir, 'SKILL.md'));
      if (installed === null)
        continue;
      if (installed !== bundled) {
        const fingerprint = crypto.createHash('sha256').update(bundled + '\0' + installed).digest('hex');
        if (cache[target.dir] === fingerprint)
          continue;
        cache[target.dir] = fingerprint;
        changed = true;
        process.stderr.write(frame([
          `The browser skill at '${path.relative(process.cwd(), target.dir)}'`,
          `does not match the tool version.`,
          ``,
          `Run \`${target.command}\``,
          `to install the up-to-date skill.`,
        ]));
      }
    }
    if (changed) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache));
    }
  } catch {
  }
}

module.exports = { checkInstalledSkills, frame };
