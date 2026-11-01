# Running Custom Playwright Code

Use `run-code` to execute arbitrary Playwright code for advanced scenarios not covered by CLI commands.

## Syntax

```bash
browser run-code default "async page => {
  // Your Playwright code here
  // Access page.context() for browser context operations
}"
```

You can also load the function from a file:

```bash
browser run-code default --filename=./my-script.js
browser run-code default --filename=./my-script.js --inline
browser run-code default --filename=./first.js --then run-code --filename=./second.js --inline --json
```

`--filename` is an input path for `run-code`: the file is read once and the
function executes once. If both a function argument and `--filename` are
provided, the file takes precedence. The source file is never a snapshot output.

After execution, the resulting page snapshot is saved under `.logs/browser-cli/`
by default. `--inline` prints the snapshot instead; it works with file input.
The function's return value is included when defined. `--raw` retains the raw
result/snapshot response; `--json` returns `result` and `snapshot` properties,
with a snapshot file reference by default or snapshot content with `--inline`.
In a chain, only the final command emits an automatic snapshot.

For commands where `--filename` names an output artifact (such as `snapshot`),
combining it with `--inline` remains an error.

The code must be a single function expression, it is wrapped in `(...)` and evaluated.
import/export/require syntax is not supported.

The code runs in an isolated context, not in a full Node.js environment. `require`, `process` and Node modules are not
available. Timers (`setTimeout`, `setInterval`), `fetch`, `URL`, `Buffer`, `crypto`, `AbortController`, `TextEncoder`
and `TextDecoder` are available.

## Geolocation

```bash
# Grant geolocation permission and set location
browser run-code default "async page => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 37.7749, longitude: -122.4194 });
}"

# Set location to London
browser run-code default "async page => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
}"

# Clear geolocation override
browser run-code default "async page => {
  await page.context().clearPermissions();
}"
```

## Permissions

```bash
# Grant multiple permissions
browser run-code default "async page => {
  await page.context().grantPermissions([
    'geolocation',
    'notifications',
    'camera',
    'microphone'
  ]);
}"

# Grant permissions for specific origin
browser run-code default "async page => {
  await page.context().grantPermissions(['clipboard-read'], {
    origin: 'https://example.com'
  });
}"
```

## Media Emulation

```bash
# Emulate dark color scheme
browser run-code default "async page => {
  await page.emulateMedia({ colorScheme: 'dark' });
}"

# Emulate light color scheme
browser run-code default "async page => {
  await page.emulateMedia({ colorScheme: 'light' });
}"

# Emulate reduced motion
browser run-code default "async page => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}"

# Emulate print media
browser run-code default "async page => {
  await page.emulateMedia({ media: 'print' });
}"
```

## Wait Strategies

```bash
# Wait for network idle
browser run-code default "async page => {
  await page.waitForLoadState('networkidle');
}"

# Wait for specific element
browser run-code default "async page => {
  await page.locator('.loading').waitFor({ state: 'hidden' });
}"

# Wait for function to return true
browser run-code default "async page => {
  await page.waitForFunction(() => window.appReady === true);
}"

# Wait with timeout
browser run-code default "async page => {
  await page.locator('.result').waitFor({ timeout: 10000 });
}"
```

## Frames and Iframes

```bash
# Work with iframe
browser run-code default "async page => {
  const frame = page.locator('iframe#my-iframe').contentFrame();
  await frame.locator('button').click();
}"

# Get all frames
browser run-code default "async page => {
  const frames = page.frames();
  return frames.map(f => f.url());
}"
```

## File Downloads

```bash
# Handle file download
browser run-code default "async page => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const download = await downloadPromise;
  await download.saveAs('./downloaded-file.pdf');
  return download.suggestedFilename();
}"
```

## Clipboard

```bash
# Read clipboard (requires permission)
browser run-code default "async page => {
  await page.context().grantPermissions(['clipboard-read']);
  return await page.evaluate(() => navigator.clipboard.readText());
}"

# Write to clipboard
browser run-code default "async page => {
  await page.evaluate(text => navigator.clipboard.writeText(text), 'Hello clipboard!');
}"
```

## Page Information

```bash
# Get page title
browser run-code default "async page => {
  return await page.title();
}"

# Get current URL
browser run-code default "async page => {
  return page.url();
}"

# Get page content
browser run-code default "async page => {
  return await page.content();
}"

# Get viewport size
browser run-code default "async page => {
  return page.viewportSize();
}"
```

## JavaScript Execution

```bash
# Execute JavaScript and return result
browser run-code default "async page => {
  return await page.evaluate(() => {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled
    };
  });
}"

# Pass arguments to evaluate
browser run-code default "async page => {
  const multiplier = 5;
  return await page.evaluate(m => document.querySelectorAll('li').length * m, multiplier);
}"
```

## Error Handling

```bash
# Try-catch in run-code
browser run-code default "async page => {
  try {
    await page.getByRole('button', { name: 'Submit' }).click({ timeout: 1000 });
    return 'clicked';
  } catch (e) {
    return 'element not found';
  }
}"
```

## Complex Workflows

```bash
# Login and save state
browser run-code default "async page => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await page.context().storageState({ path: 'auth.json' });
  return 'Login successful';
}"

# Scrape data from multiple pages
browser run-code default "async page => {
  const results = [];
  for (let i = 1; i <= 3; i++) {
    await page.goto(\`https://example.com/page/\${i}\`);
    const items = await page.locator('.item').allTextContents();
    results.push(...items);
  }
  return results;
}"
```
