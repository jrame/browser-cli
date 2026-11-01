# Browser Session Management

Run multiple isolated browser sessions concurrently with state persistence.

## Named Browser Sessions

Put the session name immediately after the command to isolate browser contexts:

```bash
# Browser 1: Authentication flow
browser open auth https://app.example.com/login

# Browser 2: Public browsing (separate cookies, storage)
browser open public https://example.com

# Commands are isolated by browser session
browser fill auth :1 "user@example.com"
browser snapshot public
```

## Browser Session Isolation Properties

Each browser session has independent:
- Cookies
- LocalStorage / SessionStorage
- IndexedDB
- Cache
- Browsing history
- Open tabs

## Browser Session Commands

```bash
# List all browser sessions
browser list

# Stop a browser session (close the browser)
browser close default                # stop the default browser
browser close mysession   # stop a named browser

# Stop all browser sessions
browser close-all

# Forcefully kill all daemon processes (for stale/zombie processes)
browser kill-all

# Delete browser session user data (profile directory)
browser delete-data default                # delete default browser data
browser delete-data mysession   # delete named browser data
```

A headless session shuts down on its own after an hour without commands; the next command then reports that the browser is not open, so run `open <session>` again. Headed browsers stay open. Use `open <session> --idle-timeout=<ms>` to change the timeout, or `0` to disable it.

Session names are required. `-s` and `--session` are rejected, and
`PLAYWRIGHT_CLI_SESSION` does not supply a default. In a `--then` chain, specify
the session on the first browser command; subsequent steps inherit it. Start a
separate invocation to change sessions.

## Common Patterns

### Concurrent Scraping

```bash
#!/bin/bash
# Scrape multiple sites concurrently

# Start all browsers
browser open site1 https://site1.com &
browser open site2 https://site2.com &
browser open site3 https://site3.com &
wait

# Take snapshots from each
browser snapshot site1
browser snapshot site2
browser snapshot site3

# Cleanup
browser close-all
```

### A/B Testing Sessions

```bash
# Test different user experiences
browser open variant-a "https://app.com?variant=a"
browser open variant-b "https://app.com?variant=b"

# Compare
browser screenshot variant-a
browser screenshot variant-b
```

### Persistent Profile

By default, browser profile is kept in memory only. Use `--persistent` flag on `open` to persist the browser profile to disk:

```bash
# Use persistent profile (auto-generated location)
browser open default https://example.com --persistent

# Use persistent profile with custom directory
browser open default https://example.com --profile=/path/to/profile
```

## Attaching to a Running Browser

Use `attach` to connect to a browser that is already running, instead of launching a new one.

### Attach by channel name

Connect to a running Chrome or Edge instance by its channel name. The browser must have remote debugging enabled — navigate to `chrome://inspect/#remote-debugging` in the target browser and check "Allow remote debugging for this browser instance".

```bash
# Attach to Chrome
browser attach chrome --cdp=chrome

# Attach to Chrome Canary
browser attach chrome-canary --cdp=chrome-canary

# Attach to Microsoft Edge
browser attach msedge --cdp=msedge

# Attach to Edge Dev
browser attach msedge-dev --cdp=msedge-dev
```

Supported channels: `chrome`, `chrome-beta`, `chrome-dev`, `chrome-canary`, `msedge`, `msedge-beta`, `msedge-dev`, `msedge-canary`.

The first argument is the local session name, independent of the target.
For example, `browser attach work --cdp=msedge` creates a session named `work`.
For a bound Playwright browser, use `browser attach work <bound-browser-name>`.

### Attach via CDP endpoint

Connect to a browser that exposes a Chrome DevTools Protocol endpoint:

```bash
browser attach default --cdp=http://localhost:9222
```

### Attach via browser extension

Connect to a browser with the Playwright extension installed:

```bash
browser attach default --extension
```

### Detach

Tear down an attached session without affecting the external browser:

```bash
# Detach the default attached session
browser detach default

# Detach a specific attached session
browser detach msedge
```

`detach` only works on sessions created via `attach`. For sessions created via `open`, use `close`.

## Default Browser Session

`default` is an ordinary session name that must be passed explicitly:

```bash
# These use the same default browser session
browser open default https://example.com
browser snapshot default
browser close default  # Stops default browser
```

## Browser Session Configuration

Configure a browser session with specific settings when opening:

```bash
# Open with config file
browser open default https://example.com --config=.config/browser-cli/my-cli.json

# Open with specific browser
browser open default https://example.com --browser=firefox

# Open in headed mode
browser open default https://example.com --headed

# Open with persistent profile
browser open default https://example.com --persistent
```

## Best Practices

### 1. Name Browser Sessions Semantically

```bash
# GOOD: Clear purpose
browser open github-auth https://github.com
browser open docs-scrape https://docs.example.com

# AVOID: Generic names
browser open s1 https://github.com
```

### 2. Always Clean Up

```bash
# Stop browsers when done
browser close auth
browser close scrape

# Or stop all at once
browser close-all

# If browsers become unresponsive or zombie processes remain
browser kill-all
```

### 3. Delete Stale Browser Data

```bash
# Remove old browser data to free disk space
browser delete-data oldsession
```
