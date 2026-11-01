# Multiline insertion investigation — 2026-10-31

The reported Firefox/Monaco duplication is **not isolated**. The local native
fixtures do not reproduce two copies after one insertion. No browser CLI engine
fix or input workaround is justified by these results. Monaco dependencies were
not available in this checkout or its pinned Playwright build, so the actual
editor interaction remains unverified.

## Environment and payload

- Windows, Node 24.13.0.
- CLI package: `0.1.22-atml.1`.
- Published and patched Playwright: `1.64.0-alpha-1790635538000`.
- Pinned source: `e8149b8257d32dcf8f72573ecc43e72439da7080`.
- Firefox 156.0 (Playwright revision 1553).
- Chromium 155.0.8059.12 (headless shell revision 1247).

`tests/fixtures/multiline-source.txt` contains the Java payload extracted from
`B:\dev\test-cli\.logs\browser-cli\2026_10_31T08_48_06_210Z_Coding_Games_and_Programming_Cha.js`,
stored with LF. Reconstructing CRLF gives the exact original string:
1001 UTF-16 code units, 39 CRLF sequences, SHA-256
`cc58926c4080797f2e396f8e5d60a53e6638308704bb7a1fbddec3ed0ddcaf01`.
The LF form has 962 code units. A separate Unicode payload covers accented and
CJK text, a surrogate-pair emoji, a combining accent, tabs, quotes, backticks,
backslash and a literal dollar sign. Both payloads end with a newline.

The original observation was 2002 characters containing two complete copies of
a 1001-character source. Normalization of 39 line endings cannot explain that
observation, and these local results do not establish its cause.

## Reproduce locally

After the repository's normal install/build and browser installation:

```powershell
node scripts/repro-multiline-insertion.cjs firefox textarea CRLF
node scripts/repro-multiline-insertion.cjs firefox contenteditable LF
node scripts/repro-multiline-insertion.cjs chromium contenteditable CRLF
node node_modules/@playwright/test/cli.js test tests/multiline-insertion.browser.spec.ts --workers=2 --output=.logs/multiline-results
```

The small runner uses published Playwright directly, with no CLI or ATML. It
prints the full payload, complete values, contenteditable DOM/selection details,
event records and execution counter. It shares the fixture and scenario with the
comparison suite. It requires no external site, account, network fetch or
clipboard access.

The comparison suite runs each payload/EOL/element/browser combination through:

1. Published Playwright directly.
2. Patched Playwright directly, without the ATML event tracker.
3. Patched Playwright with the ATML event tracker installed before page scripts.
4. CLI `run-code` with code passed as an argument.
5. CLI `run-code --filename` with a UTF-8 source file.

Each scenario seeds existing text, focuses the editor, selects all, inserts the
payload once, inserts it again at the resulting caret, then selects all and
replaces it again. Each phase calls `keyboard.insertText` once. The second phase
deliberately requests another insertion; its result must not be mistaken for a
duplicate first action. Two animation frames allow editor processing before
each full-value read. CLI values and counters are checked again after automatic
ATML snapshot capture.

One document-level capture listener per event type records `beforeinput`,
`input`, `compositionstart`, `compositionupdate` and `compositionend`. A guard
prevents recorder reinstallation; it never cancels or synthesizes input. The
scenario increments a document counter before any editing, and expects exactly
one execution. Tests compare complete values, event sequences and DOM details
against the published baseline, then assert explicit expected text (including
the native limitations below). They also compare browser versions/user agents.
JSON attachments under `.logs/multiline-results/*/insertion-observations.json` retain all
observations, including failures.

## Observations

Across native textarea and contenteditable, the five execution paths produced
the same complete text, events and selection observations for each browser.
Every scenario counter was 1, recorder installations stayed at 1, and automatic
CLI snapshot capture did not change the final text or execution counter.

| Fixture | Firefox 156.0 | Chromium 155.0.8059.12 |
| --- | --- | --- |
| Native textarea, LF/CRLF | Exact LF-normalized value on replacement, repeated insertion and replacement again | Same |
| Contenteditable, first replacement | Exact LF-normalized text; no duplicate source | No duplicate source; `innerText` includes presentation newlines from block markup |
| Contenteditable, repeated insertion | Caret before terminal LF affects insertion location | LF repeats insert; in the tested replacement sequence identical CRLF repeats emit only `beforeinput` and leave the DOM unchanged |
| Local Monaco | Not run: dependency unavailable | Not run: dependency unavailable |

Firefox's insertions produce a composition sequence and one `input` event.
Chromium may emit multiple `input` events while handling one multiline
`insertText`, including in a textarea. Therefore neither composition events nor
the number of `input` events alone establishes multiple calls or duplicate text.

Two native contenteditable limitations have explicit expectations in the tests:

- For a string `s` ending in LF, Firefox places the caret before the trailing
  LF. A second insertion at that caret gives `s.slice(0, -1) + s + '\n'`, rather
  than `s + s`. The complete DOM text preserves the terminal LF at its new
  position; this is not whole-source duplication from one action.
- Chromium creates block markup. For these fixtures, full `innerText` adds one
  presentation LF per empty block and one at the end. The tests retain
  `innerHTML` and `textContent` as well, rather than treating visible text as an
  editor model. In the seeded/select-all/CRLF sequence, subsequent identical
  insertions make no DOM change. This also happens with published Playwright
  without ATML, so it does not identify a browser CLI defect.

These assertions describe the pinned native browser behavior, not a promise of
exact contenteditable round trips. They do not rewrite the inserted text or
change the engine to compensate.

## Optional Monaco comparison

Provide an existing local `monaco-editor` package containing `min/vs/loader.js`:

```powershell
$env:MONACO_EDITOR_PATH = 'B:\path\to\node_modules\monaco-editor'
node node_modules/@playwright/test/cli.js test tests/multiline-insertion.browser.spec.ts --grep monaco --output=.logs/multiline-results
```

The suite also detects Monaco installed in this repository or its pinned
Playwright checkout. An explicit invalid path fails rather than silently
skipping. Assets are served from loopback; no CDN is used. The fixture disables
formatting/automatic indentation and requests Monaco's textarea input path.
It reads `editor.getModel().getValue()` and `getEOL()`, including offscreen
content, rather than virtualized visible lines. This controlled configuration
does not reproduce every CodinGame editor option, plugin or Monaco version.

## Conclusion and verification scope

The available comparisons provide no evidence of duplicate CLI execution,
transport corruption, or extra text caused by ATML tracking/capture in these
native fixtures. They do not rule those causes out in the original editor.
The Firefox/Monaco cause remains uncertain until the editor case is reproduced
with its version and settings. No engine code was changed, and no clipboard or
insert-then-delete workaround was added.

The native matrix comprises 16 cases (80 scenario executions across five paths);
8 Monaco cases are explicitly skipped when dependencies are absent. The
standalone runner and full JSON test attachments preserve a local repro for
further investigation. This is diagnostic coverage, not a regression test for
a demonstrated fix to the original incident.

Validation completed on the environment above:

```powershell
node node_modules/@playwright/test/cli.js test tests/multiline-insertion.browser.spec.ts tests/run-code.browser.spec.ts --workers=2 --output=.logs/multiline-results
```

Result: **30 passed, 8 skipped** (all skips are optional Monaco cases). This
includes 16 native comparison cases and 14 existing run-code cases across both
browsers. The isolated output directory avoids interference from other test
runs sharing the checkout. The standalone Firefox textarea/CRLF command also
passed: source length 1001, values 962 / 1924 / 962 across the three phases,
execution counter 1 and recorder installation count 1. JavaScript syntax checks
passed for the runner and shared scenario.
