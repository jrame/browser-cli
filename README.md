# browser

Local fork of [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli)
with ATML snapshots, URL-specific filtering and compact actionable references.
The installed command is **browser**.

## Install

### Windows and WSL/Linux releases

Download `browser-windows.zip` or `browser-linux.tar.gz` and its `.sha256` file
from [Releases](https://github.com/jrame/browser-cli/releases). These light
archives contain the compiled engine and runtime dependencies. Install
**Node.js 20 or newer** separately (Linux Node.js inside WSL). Git, npm and
compilation are not needed to install a release.

Windows, from the directory containing the downloaded files:

```powershell
$expected = ((Get-Content .\browser-windows.zip.sha256) -split '\s+')[0]
if ((Get-FileHash .\browser-windows.zip -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum mismatch' }
Expand-Archive .\browser-windows.zip -DestinationPath .\browser-release
cd .\browser-release\browser-windows
.\install.ps1
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
browser --help
```

WSL/Linux, from the directory containing the downloaded files:

```sh
sha256sum -c browser-linux.tar.gz.sha256
tar -xzf browser-linux.tar.gz
cd browser-linux
sh install.sh
export PATH="$HOME/.local/bin:$PATH"
browser --help
```

Installers copy the application to `%LOCALAPPDATA%\browser-cli` on Windows or
`~/.local/share/browser-cli` on Linux, and create a launcher in `~/.local/bin`.
Add this bin directory to your Windows **user PATH** or your WSL shell profile
to keep the command available in new terminals. Installers do not change PATH
or shell profiles. The extracted archive can be deleted after installation.

Chromium and Firefox are downloaded by default. For an offline CLI install or
to choose browsers later, use `.\install.ps1 -SkipBrowsers` or
`sh install.sh --skip-browsers`, then run `browser install-browser chromium`
and/or `browser install-browser firefox` when connected. Linux may also need
system libraries: run `browser install-browser --with-deps chromium` (and/or
`firefox`); installing system libraries may require sudo. WSL uses Linux
browsers; headed sessions require a graphical environment such as WSLg.

Custom locations: `.\install.ps1 -InstallDir C:\Tools\browser-cli -BinDir C:\Tools\bin`
or `sh install.sh --install-dir /path/to/browser-cli --bin-dir /path/to/bin`.
Close active sessions with `browser close-all` before installing a newer
release into the same location. Configuration and browser caches are separate
from the installed application.

### From source

Requires Node.js 20 or newer, npm and Git. The first build downloads pinned
Playwright sources and build dependencies.

```powershell
npm ci
npm run build
node .artifacts/playwright-core/cli.js install chromium firefox
npm link
browser --help
```

Without a global install, use `node browser.js` or `npm run browser --`.
Generated sources live under `.upstream/`, the compiled engine under
`.artifacts/` and build logs under `.logs/browser-cli/build/`.

## Use

```powershell
browser open https://example.com
browser snapshot --inline
browser fill :email 'user@example.com'
browser click :submit
browser click :13
browser snapshot '#form' --depth=2 --inline
browser find 'Connexion'
browser snapshot --format=yaml
browser snapshot --filename=page.atml
browser close
```

Chain commands on one line with `--then`:

```powershell
browser -s=ff type "Buy groceries" --then press Enter
browser -s=ff click :email --then type "user@example.com" --then press Tab
```

Commands run sequentially and stop at the first failure. Each command inherits
the preceding session (`-s=ff`, `-s ff`, `--session=ff` or `--session ff`), unless
it selects another session. Other flags apply only to their own command; output
is printed for each command, with one automatic snapshot after the final
command. Explicit `snapshot` commands still capture their requested state.
Intermediate steps refresh element references without writing snapshot files.
Put `--` before positional arguments to pass a
literal `--then` (for example `browser type -- --then`); this also ends chain
parsing for the rest of the invocation.

Shell separators such as `;` and `&` are handled by your shell. With `;`, repeat
the executable: `browser -s=ff type "Buy groceries"; browser -s=ff press Enter`.
That PowerShell form runs the second command even if the first fails.

Snapshots are saved as `.atml` files under `.logs/browser-cli/` by default;
successful responses print `ok` followed by the plain file path. ATML files
start with `url:` and `title:` lines, followed by a blank line and the tree.
Errors and useful events remain visible. `--inline` prints the snapshot instead.
`--filename` selects a file and cannot be combined with `--inline`.
`--format=atml|yaml` also applies to automatic snapshots after actions.
`type` captures the entered value in ATML even without `--submit`.
`find` stays inline unless `--filename` is supplied. `--json` and `--raw`
preserve upstream response modes.

```text
:email input type=email value=user@example.com
:submit button
  : Connexion
:13 button
  : Continuer
```

Interactive elements use a unique usable HTML ID (`:submit`) or a numeric
reference (`:13`). Numeric references retain DOM identity within the active tab
and are never reused for another element. Stale references fail explicitly.
Duplicate IDs, numeric IDs and IDs containing whitespace or quotes use numeric
references. Structural elements keep `id=value` and can be targeted by selectors.
Test IDs stay visible as attributes. Native `e13` / `f2e13` references and
`#id` targets also work.

`: ` (colon followed by a space) starts a text line; `:13` or `:submit`
starts an actionable element. Numeric references and simple named references
can be passed without quotes in Bash, PowerShell and cmd. Quote targets that
contain shell metacharacters. The former `@` reference prefix is no longer supported.

ATML omits the body wrapper, starts at column zero and indents children by two
spaces. Text lines start with `: `. Generic tags are suppressed unless retained
by configuration. Hidden content and script/style nodes are omitted. Snapshots
include live form state, iframe and open shadow-root content. Filled password
inputs show `value=****` (a fixed mask); empty ones show a bare `value`.
Closed shadow roots are inaccessible. Event hints cover inline
handlers and tracked element listeners registered after instrumentation; document
and window delegation is not attributed to individual descendants.

Snapshots, executed JavaScript logs and screenshots use `date_title.ext`
filenames with UTC milliseconds and a sanitized page title. Artifacts from one
command share a basename. Code is saved as a `.js` file beside the snapshot;
its link is omitted from compact output. Raw and JSON
modes still save code logs but omit their links. Console logs use
`date_title_console.log`. Explicit filenames are preserved.

Sessions, tabs, screenshots, PDF, dashboard, recording and code execution remain
available; see `browser --help` and [the bundled skill](skills/browser/SKILL.md).
Browser JSON options live in `.config/browser-cli/cli.config.json`, with
`~/.config/browser-cli/cli.config.json` providing global defaults.
Sessions use a separate daemon cache. Ignore `.logs/browser-cli/` in Git.

## ATML configuration

Lookup order: `--atml-config`, `BROWSER_ATML_CONFIG`,
`.config/browser-cli/config.toml` in the working directory, then
`~/.config/browser-cli/config.toml`. Explicit paths must exist.

```toml
[atml]
keep_attrs = []
keep_tags = []
remove_selectors = [".cookie-banner"]

[atml.rules.app]
url = "https://example.com/app/**"
keep_attrs = ["data-testid"]
remove_selectors = [".sidebar"]
class_regex = "selected|active"
```

URL queries and fragments are ignored. `*` stays within one path segment;
`**` crosses segments. Rules apply from broadest to most specific: lists merge
with deduplication and `class_regex` takes the most specific value. Ties require
distinct integer priorities. Each iframe uses its own URL. Rules reload on each
snapshot. Filters affect output only. Invalid configurations and selectors fail
explicitly.

## Navigation allowlist

Add this table to the same TOML file to restrict page navigation:

```toml
[navigation]
allowed_urls = ["https://example.com/app/**", "https://example.org/exact-page"]
```

Omitting `allowed_urls` allows unrestricted navigation; an empty list blocks
all HTTP(S) pages. `about:blank` remains available. Patterns require HTTP(S), an
exact host and optional path wildcards, without credentials, queries or fragments.
Scheme, host, default ports and dot segments are normalized before matching.

Chromium/Chrome enforce the list for links, redirects, popups, iframes and
JavaScript navigation before requests are sent. Subresources and API calls are
unaffected; existing JSON network restrictions still apply. User route mocks
cannot bypass the list. Enforcement requires a local connection with service
workers blocked; unsupported remote or preexisting contexts are rejected.
New sessions block service workers automatically when the list is enabled.

Firefox checks explicit `open` and `goto` commands only. Redirect destinations,
clicked links, popups, iframes and script-driven navigation remain unrestricted.
WebKit rejects the allowlist. This is a page navigation policy, not a network
sandbox for code execution or browser extensions.

The policy loads at session startup; restart with `browser close` then
`browser open ...` after edits. Use `BROWSER_ATML_CONFIG` to select another
policy file; `--atml-config` selects snapshot filters only.

## Development

To create a light release after building the engine:

```powershell
npm run package:release
npm run verify:release
```

Packaging creates `dist/browser-windows.zip` on Windows or
`dist/browser-linux.tar.gz` on Linux, with a separate `.sha256` checksum.
Verification extracts and installs the archive outside the checkout, removes
the extracted files, then checks the installed launcher, Chromium/Firefox,
command chaining and TOML filters. Install those browsers before verifying.

The **Release** GitHub Actions workflow builds and verifies both archives.
Run it manually to download test artifacts without publishing, or push a
`v<package.json version>` tag to publish the verified archives in GitHub
Releases. Tags containing a prerelease suffix create prereleases. npm and
GitHub Packages are not used.

```powershell
npm test
npm run test:unit
npm run test:browser
npm run test:types
node scripts/verify-clean-build.cjs
```

[upstream.json](upstream.json) pins the source revisions. Engine changes live in
[patches/playwright](patches/playwright); the build applies them before compiling.
ATML modules live in [src/atml](src/atml). After editing engine files under
`.upstream/playwright/`, run `npm run patch:update`, then `npm run build`.
Edit ATML modules directly in `src/atml`. Generated caches are not committed.
The clean-build check uses a temporary checkout under `.build/`.

[Reference fixtures](tests/fixtures/README.md) verify historical renderer content
and browser extraction. Separate tests cover exact layout, actionable references,
live state, event tracking and navigation rules.

This package is private and performs no npm update checks. See [LICENSE](LICENSE)
and [NOTICE](NOTICE) for licensing and attribution.
