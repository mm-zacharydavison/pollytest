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

// use `pollyTest` instead of your usual `test` function.
pollyTest('fetches user', async ({ snapshot }) => {
  const response = await fetch('https://api.example.com/users/1');
  const user = await response.json();

  expect(user.name).toBeDefined();
  // saves in record mode, compares against recording in recorded mode
  await snapshot({ user });
});
```

## Time Control

Time control freezes `Date.now()` and related APIs to the recording time during replay, enabling deterministic testing of time-dependent features.

```typescript
const pollyTest = createPollyTest({
  recordingsDir: 'tests/fixtures/recordings',
  timeControl: true,
});

pollyTest('token expiration', async ({ time, isRealMode }) => {
  const { token, expiresAt } = await fetchToken();

  // In replay mode, time is frozen to recording time
  // In real mode, time is null (real Date.now() is used)
  if (time) {
    console.log('Current time:', time.now().toISOString());

    // Token should be valid initially
    expect(isExpired(token, expiresAt)).toBe(false);

    // Advance time by 2 hours
    await time.advance('2 hours');

    // Token should now be expired
    expect(isExpired(token, expiresAt)).toBe(true);
  }
});
```

### Time Context API

| Method              | Description                                             |
|---------------------|---------------------------------------------------------|
| `time.now()`        | Current controlled time as a `Date` object              |
| `time.nowMs()`      | Current controlled time as milliseconds since epoch     |
| `time.advance(dur)` | Advance time, executing scheduled timers along the way  |
| `time.tick(dur)`    | Alias for `advance()`                                   |
| `time.flush()`      | Process all pending timers and microtasks               |
| `time.elapsed()`    | Milliseconds elapsed since test started                 |

Durations can be milliseconds or human-readable strings: `'1 hour'`, `'30 minutes'`, `'5 seconds'`, `'500 ms'`.

### How It Works

| Mode          | Behavior                                                    |
|---------------|-------------------------------------------------------------|
| Real APIs     | `time` is `null`, real `Date.now()` is used                 |
| Replay        | `time` is available, frozen to HAR entry's `startedDateTime`|

Time control uses [@sinonjs/fake-timers](https://github.com/sinonjs/fake-timers) under the hood, the same library that powers Jest and Vitest fake timers.

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

# `AGENT=1` & `QUIET=1`

By default, `polly` log level is quite noisy, which can be unfriendly to AI agents.

`AGENT=1` will produce quieter output.

To be more explicit, `QUIET=1` will produce the same quiet output.

## License

MIT
