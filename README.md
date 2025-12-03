# pollytest

Batteries included HAR snapshot testing with [polly.js](https://netflix.github.io/pollyjs/#/).

tl;dr:
1. Run tests against real APIs.
2. Network traffic is saved.
3. Future test runs use the saved traffic.

## Install

```bash
npm install -D @zdavison/pollytest
pnpm add -D @zdavison/pollytest
bun add -d @zdavison/pollytest
```

## Usage

```typescript
import { createPollyTest } from '@zdavison/pollytest';
import { expect } from 'bun:test';

// Configure pollyTest (you can share this globally if you like)
const pollyTest = createPollyTest({
  // recordings and snapshots [relative to git root]
  recordingsDir: 'tests/fixtures/recordings',
  // [optional] redacted headers won't be stored (use for API keys)                       
  headersToRedact: ['x-custom-auth'],
  // [optional] normalize timestamps and other fields that always change
  bodyNormalizer: (body) => body.replace(/"timestamp":\d+/g, '"timestamp":0'),
});

pollyTest('fetches user', async ({ snapshot }) => {
  const response = await fetch('https://api.example.com/users/1');
  const user = await response.json();

  expect(user.name).toBeDefined();
  // saves in record mode, compares against recording in recorded mode
  await snapshot({ user });
});
```

## Running Tests

Use the CLI (auto-detects package manager from lock file):

```bash
bun pollytest                       # interactive mode
bun pollytest --real                # record mode (hits real APIs)
bun pollytest --recorded            # replay mode (uses recordings)
bun pollytest 'pnpm test' --real    # custom test command
```

Or set `REAL_APIS=true` manually:

```bash
REAL_APIS=true npm test
```

## License

MIT
