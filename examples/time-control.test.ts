/**
 * Example test demonstrating time control in pollytest.
 *
 * Time control allows you to:
 * 1. Freeze time to the recording time during replay
 * 2. Advance time programmatically to test time-based logic
 * 3. Transform timestamps in API responses to stay relative to "now"
 *
 * Run in recorded mode (uses saved recordings):
 *   bun test examples/time-control.test.ts
 *
 * Run in real mode (hits real APIs, no time control):
 *   REAL_APIS=true bun test examples/time-control.test.ts
 */
import { describe, expect } from 'bun:test';
import { createPollyTest } from '../src';

const pollyTest = createPollyTest({
  recordingsDir: 'examples/fixtures/recordings',
  timeControl: true,
});

describe('Time Control', () => {
  pollyTest('freezes time to recording time in replay mode', async ({ time, isRealMode }) => {
    // Fetch something to ensure we're using the recording
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.ok).toBe(true);

    if (isRealMode) {
      // In real mode, time is null - no mocking occurs
      expect(time).toBeNull();
      console.log('Real mode: time control disabled, using real Date.now()');
    } else {
      // In replay mode, time is frozen to recording time
      expect(time).not.toBeNull();

      const now = time!.now();
      console.log('Replay mode: time frozen to', now.toISOString());

      // The time should be the recording time (2025-01-15T10:00:00.000Z from our HAR)
      expect(now.getFullYear()).toBe(2025);
      expect(now.getMonth()).toBe(0); // January
      expect(now.getDate()).toBe(15);
      expect(now.getHours()).toBe(10);

      // Date.now() should also be frozen
      const dateNow = Date.now();
      expect(dateNow).toBe(now.getTime());

      // new Date() should also be frozen
      const newDate = new Date();
      expect(newDate.getTime()).toBe(now.getTime());
    }
  });

  pollyTest('advances time for testing time-based logic', async ({ time, isRealMode }) => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.ok).toBe(true);

    if (isRealMode) {
      console.log('Real mode: skipping time advance test');
      return;
    }

    const startTime = time!.now();
    console.log('Start time:', startTime.toISOString());

    // Advance by 1 hour
    await time!.advance('1 hour');

    const afterOneHour = time!.now();
    console.log('After 1 hour:', afterOneHour.toISOString());

    expect(afterOneHour.getTime() - startTime.getTime()).toBe(3600000); // 1 hour in ms

    // Advance by 30 minutes using alternative syntax
    await time!.advance('30 minutes');

    const afterNinetyMinutes = time!.now();
    console.log('After 90 minutes total:', afterNinetyMinutes.toISOString());

    expect(afterNinetyMinutes.getTime() - startTime.getTime()).toBe(5400000); // 90 minutes in ms

    // Can also advance by milliseconds directly
    await time!.advance(500);

    expect(time!.elapsed()).toBe(5400500); // 90 minutes + 500ms
  });

  pollyTest('works with setTimeout via time.tick', async ({ time, isRealMode }) => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.ok).toBe(true);

    if (isRealMode) {
      console.log('Real mode: skipping setTimeout test');
      return;
    }

    let callbackFired = false;

    // Schedule something for 5 seconds in the future
    setTimeout(() => {
      callbackFired = true;
    }, 5000);

    // Callback hasn't fired yet
    expect(callbackFired).toBe(false);

    // Advance time by 5 seconds, which should trigger the callback
    await time!.tick('5 seconds');

    // Now it should have fired
    expect(callbackFired).toBe(true);
    console.log('setTimeout callback fired after time.tick()');
  });

  pollyTest('simulates token expiration', async ({ time, isRealMode }) => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    expect(response.ok).toBe(true);

    if (isRealMode) {
      console.log('Real mode: skipping token expiration test');
      return;
    }

    // Simulate a token that expires in 1 hour
    const tokenIssuedAt = time!.now();
    const tokenExpiresAt = new Date(tokenIssuedAt.getTime() + 3600000); // 1 hour

    function isTokenExpired(): boolean {
      return Date.now() >= tokenExpiresAt.getTime();
    }

    // Token should not be expired initially
    expect(isTokenExpired()).toBe(false);
    console.log('Token valid at:', time!.now().toISOString());

    // Advance 30 minutes - still valid
    await time!.advance('30 minutes');
    expect(isTokenExpired()).toBe(false);
    console.log('Token still valid at:', time!.now().toISOString());

    // Advance another 30 minutes - now expired
    await time!.advance('30 minutes');
    expect(isTokenExpired()).toBe(true);
    console.log('Token expired at:', time!.now().toISOString());
  });
});
