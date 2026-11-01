# Request Mocking

Intercept, mock, modify, and block network requests.

## CLI Route Commands

```bash
# Mock with custom status
browser route default "**/*.jpg" --status=404

# Mock with JSON body
browser route default "**/api/users" --body='[{"id":1,"name":"Alice"}]' --content-type=application/json

# Mock with custom headers
browser route default "**/api/data" --body='{"ok":true}' --header="X-Custom: value"

# Remove headers from requests
browser route default "**/*" --remove-header=cookie,authorization

# List active routes
browser route-list default

# Remove a route or all routes
browser unroute default "**/*.jpg"
browser unroute default
```

## URL Patterns

```
**/api/users           - Exact path match
**/api/*/details       - Wildcard in path
**/*.{png,jpg,jpeg}    - Match file extensions
**/search?q=*          - Match query parameters
```

## Advanced Mocking with run-code

For conditional responses, request body inspection, response modification, or delays:

### Conditional Response Based on Request

```bash
browser run-code default "async page => {
  await page.route('**/api/login', route => {
    const body = route.request().postDataJSON();
    if (body.username === 'admin') {
      route.fulfill({ body: JSON.stringify({ token: 'mock-token' }) });
    } else {
      route.fulfill({ status: 401, body: JSON.stringify({ error: 'Invalid' }) });
    }
  });
}"
```

### Modify Real Response

```bash
browser run-code default "async page => {
  await page.route('**/api/user', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.isPremium = true;
    await route.fulfill({ response, json });
  });
}"
```

### Simulate Network Failures

```bash
browser run-code default "async page => {
  await page.route('**/api/offline', route => route.abort('internetdisconnected'));
}"
# Options: connectionrefused, timedout, connectionreset, internetdisconnected
```

### Delayed Response

```bash
browser run-code default "async page => {
  await page.route('**/api/slow', async route => {
    await new Promise(r => setTimeout(r, 3000));
    route.fulfill({ body: JSON.stringify({ data: 'loaded' }) });
  });
}"
```
