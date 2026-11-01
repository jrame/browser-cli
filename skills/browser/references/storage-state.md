# Storage Management

Manage cookies, localStorage, sessionStorage, and browser storage state.

## Storage State

Save and restore complete browser state including cookies and storage.

### Save Storage State

```bash
# Save to auto-generated filename (storage-state-{timestamp}.json)
browser state-save default

# Save to specific filename
browser state-save default my-auth-state.json
```

### Restore Storage State

```bash
# Load storage state from file
browser state-load default my-auth-state.json

# Reload page to apply cookies
browser open default https://example.com
```

### Storage State File Format

The saved file contains:

```json
{
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123",
      "domain": "example.com",
      "path": "/",
      "expires": 1893456000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": [
    {
      "origin": "https://example.com",
      "localStorage": [
        { "name": "theme", "value": "dark" },
        { "name": "user_id", "value": "12345" }
      ]
    }
  ]
}
```

## Cookies

### List All Cookies

```bash
browser cookie-list default
```

### Filter Cookies by Domain

```bash
browser cookie-list default --domain=example.com
```

### Filter Cookies by Path

```bash
browser cookie-list default --path=/api
```

### Get Specific Cookie

```bash
browser cookie-get default session_id
```

### Set a Cookie

```bash
# Basic cookie
browser cookie-set default session abc123

# Cookie with options
browser cookie-set default session abc123 --domain=example.com --path=/ --httpOnly --secure --sameSite=Lax

# Cookie with expiration (Unix timestamp)
browser cookie-set default remember_me token123 --expires=1893456000
```

### Delete a Cookie

```bash
browser cookie-delete default session_id
```

### Clear All Cookies

```bash
browser cookie-clear default
```

### Advanced: Multiple Cookies or Custom Options

For complex scenarios like adding multiple cookies at once, use `run-code`:

```bash
browser run-code default "async page => {
  await page.context().addCookies([
    { name: 'session_id', value: 'sess_abc123', domain: 'example.com', path: '/', httpOnly: true },
    { name: 'preferences', value: JSON.stringify({ theme: 'dark' }), domain: 'example.com', path: '/' }
  ]);
}"
```

## Local Storage

### List All localStorage Items

```bash
browser localstorage-list default
```

### Get Single Value

```bash
browser localstorage-get default token
```

### Set Value

```bash
browser localstorage-set default theme dark
```

### Set JSON Value

```bash
browser localstorage-set default user_settings '{"theme":"dark","language":"en"}'
```

### Delete Single Item

```bash
browser localstorage-delete default token
```

### Clear All localStorage

```bash
browser localstorage-clear default
```

### Advanced: Multiple Operations

For complex scenarios like setting multiple values at once, use `run-code`:

```bash
browser run-code default "async page => {
  await page.evaluate(() => {
    localStorage.setItem('token', 'jwt_abc123');
    localStorage.setItem('user_id', '12345');
    localStorage.setItem('expires_at', Date.now() + 3600000);
  });
}"
```

## Session Storage

### List All sessionStorage Items

```bash
browser sessionstorage-list default
```

### Get Single Value

```bash
browser sessionstorage-get default form_data
```

### Set Value

```bash
browser sessionstorage-set default step 3
```

### Delete Single Item

```bash
browser sessionstorage-delete default step
```

### Clear sessionStorage

```bash
browser sessionstorage-clear default
```

## IndexedDB

### List Databases

```bash
browser run-code default "async page => {
  return await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases;
  });
}"
```

### Delete Database

```bash
browser run-code default "async page => {
  await page.evaluate(() => {
    indexedDB.deleteDatabase('myDatabase');
  });
}"
```

## Common Patterns

### Authentication State Reuse

```bash
# Step 1: Login and save state
browser open default https://app.example.com/login
browser snapshot default
browser fill default :1 "user@example.com"
browser fill default :2 "password123"
browser click default :3

# Save the authenticated state
browser state-save default auth.json

# Step 2: Later, restore state and skip login
browser state-load default auth.json
browser open default https://app.example.com/dashboard
# Already logged in!
```

### Save and Restore Roundtrip

```bash
# Set up authentication state
browser open default https://example.com
browser eval default "() => { document.cookie = 'session=abc123'; localStorage.setItem('user', 'john'); }"

# Save state to file
browser state-save default my-session.json

# ... later, in a new session ...

# Restore state
browser state-load default my-session.json
browser open default https://example.com
# Cookies and localStorage are restored!
```

## Security Notes

- Never commit storage state files containing auth tokens
- Add `*.auth-state.json` to `.gitignore`
- Delete state files after automation completes
- Use environment variables for sensitive data
- By default, sessions run in-memory mode which is safer for sensitive operations
