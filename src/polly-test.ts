import { test, type TestOptions } from 'bun:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { setupNetworkRecorder, type NetworkRecorderOptions } from './network-recorder';
import { SnapshotManager } from './snapshot-manager';

/**
 * Get the git root directory.
 */
function getGitRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Could not find git root. Make sure you are in a git repository.');
  }
}

/**
 * Context passed to pollyTest test functions.
 */
export interface PollyTestContext {
  /**
   * Save snapshot data (only executes in real API mode).
   * Use this to capture expected outputs that can be compared later.
   */
  snapshot: (data: unknown) => Promise<void>;

  /**
   * Load previously saved snapshot data.
   */
  loadSnapshot: <T = unknown>() => Promise<T | null>;

  /**
   * Check if running in real API mode.
   */
  isRealMode: boolean;

  /**
   * The recording name for this test.
   */
  recordingName: string;
}

export interface PollyTestOptions {
  /**
   * Directory for recordings and snapshots.
   * Relative to git root.
   */
  recordingsDir: string;

  /**
   * Headers to redact from recordings.
   */
  headersToRedact?: string[];

  /**
   * Custom body normalizer for request matching.
   */
  bodyNormalizer?: NetworkRecorderOptions['bodyNormalizer'];

  /**
   * Bun test options (timeout, skip, etc).
   */
  testOptions?: TestOptions;
}

// Snapshot manager instance (configured by createPollyTest)
let snapshotManager: SnapshotManager;

/**
 * Converts a test name to a URL-friendly slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts the test suite name from the calling test file.
 * Keeps the full filename minus the final extension (ts/tsx/js/jsx).
 * Example: "simple-chat.integration.test.ts" -> "simple-chat.integration.test"
 */
function getTestSuiteName(): string {
  const error = new Error();
  const stack = error.stack || '';

  const lines = stack.split('\n');
  for (const line of lines) {
    // Match test files (*.test.ts, *.spec.ts, etc.) and capture the full name without extension
    const match = line.match(/([^/\\]+\.(?:test|spec))\.(ts|tsx|js|jsx)(?::|$|\))/);
    if (match) {
      return match[1];
    }
  }

  return 'default';
}

/**
 * Creates a pollyTest function with custom configuration.
 *
 * @example
 * ```typescript
 * const pollyTest = createPollyTest({
 *   recordingsDir: 'tests/fixtures/recordings',
 * });
 *
 * pollyTest('my test', async ({ snapshot }) => {
 *   // test code
 * });
 * ```
 */
export function createPollyTest(globalOptions: Omit<PollyTestOptions, 'testOptions'>) {
  const gitRoot = getGitRoot();
  const recordingsDir = join(gitRoot, globalOptions.recordingsDir);

  // Configure snapshot manager - uses same directory as recordings
  snapshotManager = new SnapshotManager({ baseDir: recordingsDir });

  /**
   * Test function that automatically sets up and tears down Polly.js network recording.
   *
   * The recording name is automatically derived from the test name.
   * You can optionally provide a custom recording name as the second parameter.
   *
   * @example
   * ```typescript
   * // Automatic recording name
   * pollyTest('should fetch user data', async ({ snapshot, isRealMode }) => {
   *   const response = await fetch('https://api.example.com/user');
   *   const data = await response.json();
   *
   *   expect(data.name).toBe('John');
   *
   *   await snapshot({ response: data });
   * });
   *
   * // Custom recording name
   * pollyTest('complex scenario', 'custom/recording-name', async (ctx) => {
   *   // ...
   * });
   * ```
   */
  function pollyTest(
    name: string,
    recordingNameOrFn: string | ((ctx: PollyTestContext) => Promise<void> | void),
    fnOrOptions?: ((ctx: PollyTestContext) => Promise<void> | void) | TestOptions,
    options?: TestOptions,
  ): void {
    // Parse arguments to support both forms
    let recordingName: string;
    let fn: (ctx: PollyTestContext) => Promise<void> | void;
    let testOptions: TestOptions | undefined;

    const suiteName = getTestSuiteName();

    if (typeof recordingNameOrFn === 'function') {
      // Form 1: pollyTest(name, fn, options?)
      recordingName = `${suiteName}/${slugify(name)}`;
      fn = recordingNameOrFn;
      testOptions = fnOrOptions as TestOptions | undefined;
    } else {
      // Form 2: pollyTest(name, recordingName, fn, options?)
      if (!recordingNameOrFn.includes('/')) {
        recordingName = `${suiteName}/${recordingNameOrFn}`;
      } else {
        recordingName = recordingNameOrFn;
      }
      fn = fnOrOptions as (ctx: PollyTestContext) => Promise<void> | void;
      testOptions = options;
    }

    test(
      name,
      async () => {
        const recorder = setupNetworkRecorder({
          recordingName,
          recordingsDir,
          headersToRedact: globalOptions.headersToRedact,
          bodyNormalizer: globalOptions.bodyNormalizer,
        });

        await recorder.start();

        const isRealMode = recorder.isRealMode();
        // Use the recording ID (with hash) for snapshots to match recording directory names
        const snapshotName = recorder.getRecordingId() ?? recordingName;

        const context: PollyTestContext = {
          isRealMode,
          recordingName,
          snapshot: async (data: unknown) => {
            if (isRealMode) {
              await snapshotManager.save(snapshotName, data);
            }
          },
          loadSnapshot: async <T = unknown>() => {
            return snapshotManager.load<T>(snapshotName);
          },
        };

        try {
          await fn(context);
        } finally {
          await recorder.stop();
        }
      },
      testOptions,
    );
  }

  // Add skip variant using test.skip
  pollyTest.skip = (
    name: string,
    recordingNameOrFn: string | ((ctx: PollyTestContext) => Promise<void> | void),
    fnOrOptions?: ((ctx: PollyTestContext) => Promise<void> | void) | TestOptions,
    _options?: TestOptions,
  ) => {
    // Use bun's test.skip directly
    test.skip(name, () => {
      // This won't run, but we need a function body
    });
  };

  // Add only variant using test.only
  pollyTest.only = (
    name: string,
    recordingNameOrFn: string | ((ctx: PollyTestContext) => Promise<void> | void),
    fnOrOptions?: ((ctx: PollyTestContext) => Promise<void> | void) | TestOptions,
    options?: TestOptions,
  ) => {
    // Parse arguments same as main pollyTest
    let recordingName: string;
    let fn: (ctx: PollyTestContext) => Promise<void> | void;
    let testOptions: TestOptions | undefined;

    const suiteName = getTestSuiteName();

    if (typeof recordingNameOrFn === 'function') {
      recordingName = `${suiteName}/${slugify(name)}`;
      fn = recordingNameOrFn;
      testOptions = fnOrOptions as TestOptions | undefined;
    } else {
      if (!recordingNameOrFn.includes('/')) {
        recordingName = `${suiteName}/${recordingNameOrFn}`;
      } else {
        recordingName = recordingNameOrFn;
      }
      fn = fnOrOptions as (ctx: PollyTestContext) => Promise<void> | void;
      testOptions = options;
    }

    test.only(
      name,
      async () => {
        const recorder = setupNetworkRecorder({
          recordingName,
          recordingsDir,
          headersToRedact: globalOptions.headersToRedact,
          bodyNormalizer: globalOptions.bodyNormalizer,
        });

        await recorder.start();

        const isRealMode = recorder.isRealMode();
        // Use the recording ID (with hash) for snapshots to match recording directory names
        const snapshotName = recorder.getRecordingId() ?? recordingName;

        const context: PollyTestContext = {
          isRealMode,
          recordingName,
          snapshot: async (data: unknown) => {
            if (isRealMode) {
              await snapshotManager.save(snapshotName, data);
            }
          },
          loadSnapshot: async <T = unknown>() => {
            return snapshotManager.load<T>(snapshotName);
          },
        };

        try {
          await fn(context);
        } finally {
          await recorder.stop();
        }
      },
      testOptions,
    );
  };

  return pollyTest;
}
