import FakeTimers, { type InstalledClock } from '@sinonjs/fake-timers';

/**
 * Configuration for time control behavior.
 */
export interface TimeControlConfig {
  /**
   * APIs to mock. When timeControl is enabled, all default to true.
   */
  toFake?: (
    | 'Date'
    | 'setTimeout'
    | 'setInterval'
    | 'setImmediate'
    | 'clearTimeout'
    | 'clearInterval'
    | 'clearImmediate'
    | 'requestAnimationFrame'
    | 'cancelAnimationFrame'
    | 'performance'
    | 'hrtime'
    | 'nextTick'
  )[];

  /**
   * Response timestamp transformation options.
   */
  transformResponses?: {
    /**
     * Whether to transform timestamps in responses. Default: true
     */
    enabled?: boolean;
    /**
     * Keys to exclude from transformation (e.g., 'birthDate', 'historicalDate')
     */
    excludeKeys?: string[];
  };
}

/**
 * Context object for controlling time within tests.
 */
export interface TimeContext {
  /**
   * Get the current controlled time as a Date object.
   */
  now(): Date;

  /**
   * Get the current controlled time as milliseconds since epoch.
   */
  nowMs(): number;

  /**
   * Advance time by a duration, executing any timers along the way.
   * @param duration - milliseconds or a human-readable string like '1 hour', '5 minutes'
   */
  advance(duration: number | string): Promise<void>;

  /**
   * Tick forward, executing timers along the way (alias for advance).
   * @param duration - milliseconds or a human-readable string
   */
  tick(duration: number | string): Promise<void>;

  /**
   * Process all pending timers and microtasks.
   */
  flush(): Promise<void>;

  /**
   * Get elapsed milliseconds since the test started.
   */
  elapsed(): number;
}

const DEFAULT_TO_FAKE: TimeControlConfig['toFake'] = [
  'Date',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'performance',
];

/**
 * Parse a duration string or number into milliseconds.
 * Supports formats like '1 hour', '5 minutes', '30 seconds', '500 ms'
 */
export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration;

  const units: Record<string, number> = {
    ms: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1000,
    sec: 1000,
    second: 1000,
    seconds: 1000,
    m: 60000,
    min: 60000,
    minute: 60000,
    minutes: 60000,
    h: 3600000,
    hr: 3600000,
    hour: 3600000,
    hours: 3600000,
    d: 86400000,
    day: 86400000,
    days: 86400000,
  };

  const match = duration.match(/^(\d+)\s*(\w+)$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". ` +
        'Use formats like "1 hour", "5 minutes", "30 seconds", or milliseconds.'
    );
  }

  const [, value, unit] = match;
  const multiplier = units[unit.toLowerCase()];
  if (!multiplier) {
    throw new Error(`Unknown duration unit: "${unit}". Supported: ms, s, m, h, d and variations.`);
  }

  return parseInt(value, 10) * multiplier;
}

/**
 * TimeController wraps @sinonjs/fake-timers to provide deterministic time control
 * for tests. In replay mode, time is frozen to the recording time.
 */
export class TimeController {
  private clock: InstalledClock | null = null;
  private baseTime: number = 0;
  private config: TimeControlConfig;

  constructor(config: TimeControlConfig = {}) {
    this.config = config;
  }

  /**
   * Install fake timers, frozen at the given recording time.
   * Only call this in replay mode.
   */
  install(recordingTime: Date | string | number): void {
    if (this.clock) {
      throw new Error('TimeController already installed. Call uninstall() first.');
    }

    this.baseTime = new Date(recordingTime).getTime();

    this.clock = FakeTimers.install({
      now: this.baseTime,
      toFake: this.config.toFake ?? DEFAULT_TO_FAKE,
      shouldAdvanceTime: false,
      shouldClearNativeTimers: true,
    });
  }

  /**
   * Restore real timers.
   */
  uninstall(): void {
    if (this.clock) {
      this.clock.uninstall();
      this.clock = null;
    }
  }

  /**
   * Check if the TimeController is installed.
   */
  isInstalled(): boolean {
    return this.clock !== null;
  }

  /**
   * Get the base time (recording time) as milliseconds.
   */
  getBaseTime(): number {
    return this.baseTime;
  }

  /**
   * Get context object for test, providing time control methods.
   * @throws Error if TimeController is not installed
   */
  getContext(): TimeContext {
    if (!this.clock) {
      throw new Error('TimeController not installed. Call install() first.');
    }

    const clock = this.clock;
    const baseTime = this.baseTime;

    return {
      now: () => new Date(clock.now),

      nowMs: () => clock.now,

      advance: async (duration) => {
        const ms = parseDuration(duration);
        await clock.tickAsync(ms);
      },

      tick: async (duration) => {
        const ms = parseDuration(duration);
        await clock.tickAsync(ms);
      },

      flush: async () => {
        await clock.runAllAsync();
      },

      elapsed: () => clock.now - baseTime,
    };
  }

  /**
   * Transform timestamps in a response body string.
   * Adjusts recorded timestamps to be relative to current controlled time.
   *
   * @param body - The response body string
   * @param entryRecordedTime - The time when this HAR entry was recorded
   * @returns The transformed body string
   */
  transformResponseTimestamps(body: string, entryRecordedTime: Date): string {
    if (!this.clock || this.config.transformResponses?.enabled === false) {
      return body;
    }

    const delta = this.clock.now - entryRecordedTime.getTime();
    const excludeKeys = this.config.transformResponses?.excludeKeys ?? [];

    // If no time has passed, no transformation needed
    if (delta === 0) {
      return body;
    }

    // Transform ISO 8601 timestamps in the body
    // This regex matches ISO timestamps with optional milliseconds and timezone
    const isoTimestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

    // If excludeKeys is specified, we need to be smarter about transformation
    if (excludeKeys.length > 0) {
      try {
        const parsed = JSON.parse(body);
        const transformed = transformObjectTimestamps(parsed, delta, excludeKeys);
        return JSON.stringify(transformed);
      } catch {
        // If not valid JSON, fall back to regex replacement
      }
    }

    // Simple regex replacement for all timestamps
    return body.replace(isoTimestampRegex, (match) => {
      const original = new Date(match);
      const adjusted = new Date(original.getTime() + delta);
      return adjusted.toISOString();
    });
  }
}

/**
 * Recursively transform timestamps in an object, respecting excludeKeys.
 */
function transformObjectTimestamps(
  obj: unknown,
  delta: number,
  excludeKeys: string[],
  currentKey?: string
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if this key should be excluded
    if (currentKey && excludeKeys.includes(currentKey)) {
      return obj;
    }

    // Check if it's an ISO timestamp
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(obj)) {
      const original = new Date(obj);
      const adjusted = new Date(original.getTime() + delta);
      return adjusted.toISOString();
    }

    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => transformObjectTimestamps(item, delta, excludeKeys));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = transformObjectTimestamps(value, delta, excludeKeys, key);
    }
    return result;
  }

  return obj;
}
