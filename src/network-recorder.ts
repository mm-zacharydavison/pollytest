import { Polly, type PollyConfig } from '@pollyjs/core';
import FetchAdapter from '@pollyjs/adapter-fetch';
import FSPersister from '@pollyjs/persister-fs';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { TimeController, type TimeControlConfig, type TimeContext } from './time-controller';

// Extend PollyConfig to include properties missing from types
interface ExtendedPollyConfig extends PollyConfig {
  recordingId?: string;
}

// HAR types for loading recordings
interface HarEntry {
  startedDateTime: string;
  request: {
    method: string;
    url: string;
  };
  response: {
    content: {
      text?: string;
    };
  };
}

interface HarLog {
  log: {
    entries: HarEntry[];
  };
}

// Register adapters once on module load
Polly.register(FetchAdapter);
Polly.register(FSPersister);

/**
 * Body normalizer function type.
 * Transform request bodies before matching to handle dynamic content.
 */
export type BodyNormalizer = (body: string) => string;

/**
 * Default body normalizer that handles common timestamp patterns.
 */
export function defaultBodyNormalizer(body: string): string {
  try {
    const parsed = JSON.parse(body);

    // Normalize ISO timestamps in system messages (common in AI prompts)
    if (parsed.system && Array.isArray(parsed.system)) {
      for (const item of parsed.system) {
        if (item.type === 'text' && typeof item.text === 'string') {
          item.text = item.text.replace(
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,
            '[NORMALIZED_TIMESTAMP]'
          );
        }
      }
    }

    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export interface NetworkRecorderOptions {
  /**
   * Name for this recording, used as the directory name.
   * Can include slashes for nested directories (e.g., "suite/test-name").
   */
  recordingName: string;

  /**
   * Base directory for recordings (absolute path).
   */
  recordingsDir: string;

  /**
   * Force a specific mode. If not provided, uses REAL_APIS env var.
   * - 'replay': Use saved recordings (default)
   * - 'record': Hit real APIs and save recordings
   * - 'passthrough': Pass through without recording
   */
  mode?: 'replay' | 'record' | 'passthrough';

  /**
   * Headers to redact from recordings.
   * Defaults to common auth headers.
   */
  headersToRedact?: string[];

  /**
   * Custom body normalizer for request matching.
   * Useful for removing timestamps or dynamic IDs.
   */
  bodyNormalizer?: BodyNormalizer;

  /**
   * Whether to record failed requests.
   * @default true
   */
  recordFailedRequests?: boolean;

  /**
   * Enable time control. When enabled in replay mode, time is frozen
   * to the recording time (startedDateTime from HAR).
   * @default false
   */
  timeControl?: boolean;

  /**
   * Options for time control behavior.
   */
  timeControlOptions?: TimeControlConfig;
}

const DEFAULT_HEADERS_TO_REDACT = [
  'x-api-key',
  'authorization',
  'api-key',
  'anthropic-api-key',
  'openai-api-key',
  'bearer',
];

/**
 * Sets up Polly.js network recording/replay for a test.
 *
 * In replay mode (default): Uses existing recordings from fixtures
 * In record mode (REAL_APIS=true): Hits real APIs and updates recordings
 *
 * Security: API keys and auth tokens are automatically redacted from recordings.
 *
 * @example
 * ```typescript
 * const recorder = setupNetworkRecorder({ recordingName: 'my-test' });
 * await recorder.start();
 *
 * // Your test code that makes HTTP requests
 * const response = await fetch('https://api.example.com/data');
 *
 * await recorder.stop();
 * ```
 */
export function setupNetworkRecorder(options: NetworkRecorderOptions) {
  let polly: Polly | null = null;
  let timeController: TimeController | null = null;
  let harEntries: HarEntry[] = [];

  const isRealMode = options.mode === 'record' || process.env.REAL_APIS === 'true';
  const mode: PollyConfig['mode'] = options.mode ?? (isRealMode ? 'record' : 'replay');

  const recordingsDir = options.recordingsDir;
  const headersToRedact = options.headersToRedact ?? DEFAULT_HEADERS_TO_REDACT;
  const bodyNormalizer = options.bodyNormalizer ?? defaultBodyNormalizer;

  /**
   * Load HAR file and return parsed content.
   */
  async function loadHar(recordingName: string): Promise<HarLog | null> {
    const harPath = join(recordingsDir, recordingName, 'recording.har');

    if (!existsSync(harPath)) {
      return null;
    }

    try {
      const content = await readFile(harPath, 'utf-8');
      return JSON.parse(content) as HarLog;
    } catch {
      return null;
    }
  }

  /**
   * Find the HAR entry that matches a given request.
   */
  function findEntryForRequest(method: string, url: string): HarEntry | undefined {
    return harEntries.find(
      (entry) => entry.request.method === method && entry.request.url === url
    );
  }

  return {
    /**
     * Start recording/replaying HTTP requests.
     */
    async start() {
      const config: ExtendedPollyConfig = {
        mode,
        logLevel: process.env.AGENT === '1' || process.env.QUIET === '1' ? 'silent' : 'warn',
        adapters: ['fetch'],
        persister: 'fs',
        persisterOptions: {
          fs: {
            recordingsDir,
          },
        },
        recordingId: options.recordingName,
        recordIfMissing: false,
        matchRequestsBy: {
          headers: false,
          order: false,
          body(body: string) {
            return bodyNormalizer(body);
          },
        },
        recordFailedRequests: options.recordFailedRequests ?? true,
      };

      polly = new Polly(options.recordingName, config as PollyConfig);

      // Redact sensitive headers from recordings
      const { server } = polly;

      server.any().on('beforePersist', (_req, recording) => {
        // Redact from request headers
        if (recording.request.headers && Array.isArray(recording.request.headers)) {
          for (const headerObj of recording.request.headers) {
            if (headersToRedact.some(h => headerObj.name.toLowerCase().includes(h.toLowerCase()))) {
              headerObj.value = '[REDACTED]';
            }
          }
        }

        // Redact from response headers
        if (recording.response.headers && Array.isArray(recording.response.headers)) {
          for (const headerObj of recording.response.headers) {
            if (headersToRedact.some(h => headerObj.name.toLowerCase().includes(h.toLowerCase()))) {
              headerObj.value = '[REDACTED]';
            }
          }
        }
      });

      // Set up time control in replay mode if enabled
      if (options.timeControl && !isRealMode) {
        // Use polly.recordingId which includes the hash suffix matching the actual directory
        const har = await loadHar(polly.recordingId);

        if (har?.log.entries.length) {
          harEntries = har.log.entries;
          const firstEntry = har.log.entries[0];

          if (firstEntry?.startedDateTime) {
            timeController = new TimeController(options.timeControlOptions);
            timeController.install(firstEntry.startedDateTime);

            // Hook into Polly to transform response timestamps
            server.any().on('beforeResponse', (req, res) => {
              if (timeController && res.body && typeof res.body === 'string') {
                const entry = findEntryForRequest(req.method, req.url);
                if (entry) {
                  res.body = timeController.transformResponseTimestamps(
                    res.body,
                    new Date(entry.startedDateTime)
                  );
                }
              }
            });
          }
        }
      }

      return polly;
    },

    /**
     * Stop recording and flush to disk.
     */
    async stop() {
      // Uninstall time controller first
      if (timeController) {
        timeController.uninstall();
        timeController = null;
      }
      harEntries = [];

      if (polly) {
        await polly.flush();
        await polly.stop();
        await polly.disconnect();
        polly = null;
      }
    },

    /**
     * Get the underlying Polly instance.
     */
    getPolly() {
      return polly;
    },

    /**
     * Check if running in real API mode.
     */
    isRealMode() {
      return isRealMode;
    },

    /**
     * Get the recording ID (includes hash suffix).
     * Only available after start() is called.
     */
    getRecordingId() {
      return polly?.recordingId ?? null;
    },

    /**
     * Get time context for controlling time in tests.
     * Returns null in real mode or if time control is disabled.
     */
    getTimeContext(): TimeContext | null {
      return timeController?.getContext() ?? null;
    },
  };
}

export type NetworkRecorder = ReturnType<typeof setupNetworkRecorder>;
