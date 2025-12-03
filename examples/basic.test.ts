/**
 * Example test using @zdavison/pollytest.
 *
 * Run in recorded mode (uses saved recordings):
 *   bun test examples/basic.test.ts
 *
 * Run in real mode (hits real APIs):
 *   REAL_APIS=true bun test examples/basic.test.ts
 */
import { describe, expect } from 'bun:test';
import { createPollyTest } from '../src';

const pollyTest = createPollyTest({
  recordingsDir: 'examples/fixtures/recordings',

  // Redact sensitive headers from recordings
  // These are common auth headers - customize for your API
  headersToRedact: ['authorization', 'x-api-key', 'cookie'],

  // Normalize request bodies before matching
  // Useful when requests contain timestamps or generated IDs
  bodyNormalizer: (body) => {
    return body
      // ISO timestamps: 2024-01-15T10:30:00.000Z
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z/g, '[TIMESTAMP]')
      // Unix timestamps: 1704067200000
      .replace(/"(timestamp|created_at|updated_at)":\s*\d{10,13}/g, '"$1":[TIMESTAMP]')
      // UUIDs: 550e8400-e29b-41d4-a716-446655440000
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');
  },
});

describe('HTTP API tests', () => {
  pollyTest('fetches a todo', async ({ snapshot, isRealMode }) => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    const data = await response.json();

    expect(response.ok).toBe(true);
    expect(data.id).toBe(1);
    expect(data.title).toBeDefined();

    await snapshot({ data });

    console.log(isRealMode ? 'Real API' : 'Recorded');
  });

  pollyTest('fetches multiple todos', async ({ snapshot }) => {
    const [todo1, todo2] = await Promise.all([
      fetch('https://jsonplaceholder.typicode.com/todos/1').then(r => r.json()),
      fetch('https://jsonplaceholder.typicode.com/todos/2').then(r => r.json()),
    ]);

    expect(todo1.id).toBe(1);
    expect(todo2.id).toBe(2);

    await snapshot({ todo1, todo2 });
  });

  pollyTest('creates a todo (POST)', async ({ snapshot }) => {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test todo',
        completed: false,
        userId: 1,
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.title).toBe('Test todo');

    await snapshot({ data });
  });
});
