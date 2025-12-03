import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

export interface SnapshotManagerOptions {
  /**
   * Base directory for snapshots (absolute path).
   */
  baseDir: string;
}

/**
 * Manages test snapshots for expected outputs.
 *
 * Snapshots are JSON files containing expected test outputs.
 * They're useful for snapshot-style testing where you want to
 * capture and compare complex outputs.
 *
 * @example
 * ```typescript
 * const manager = new SnapshotManager();
 *
 * // Save snapshot in real mode
 * await manager.save('my-test/case-1', {
 *   input: 'hello',
 *   output: 'Hello, world!'
 * });
 *
 * // Load snapshot in replay mode
 * const snapshot = await manager.load('my-test/case-1');
 * ```
 */
export class SnapshotManager {
  private baseDir: string;

  constructor(options: SnapshotManagerOptions) {
    this.baseDir = options.baseDir;
  }

  /**
   * Load a snapshot file.
   * Returns null if the snapshot doesn't exist.
   */
  async load<T = unknown>(name: string): Promise<T | null> {
    const path = join(this.baseDir, name, 'snapshot.json');

    if (!existsSync(path)) {
      return null;
    }

    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  }

  /**
   * Save a snapshot file.
   * Creates parent directories if needed.
   */
  async save(name: string, data: unknown): Promise<void> {
    const path = join(this.baseDir, name, 'snapshot.json');
    await mkdir(dirname(path), { recursive: true });

    const content = JSON.stringify(data, null, 2);
    await writeFile(path, content, 'utf-8');
  }

  /**
   * Check if a snapshot exists.
   */
  has(name: string): boolean {
    const path = join(this.baseDir, name, 'snapshot.json');
    return existsSync(path);
  }

  /**
   * Delete a snapshot file.
   */
  async delete(name: string): Promise<void> {
    const path = join(this.baseDir, name, 'snapshot.json');
    if (existsSync(path)) {
      const { unlink } = await import('node:fs/promises');
      await unlink(path);
    }
  }

  /**
   * Compare actual results with a snapshot.
   * Returns a diff result indicating whether they match.
   */
  compare<T>(actual: T, snapshot: T | null): CompareResult {
    if (snapshot === null) {
      return {
        match: false,
        reason: 'No snapshot exists. Run in real mode to create one.',
      };
    }

    const actualStr = JSON.stringify(actual, null, 2);
    const snapshotStr = JSON.stringify(snapshot, null, 2);

    if (actualStr === snapshotStr) {
      return { match: true };
    }

    return {
      match: false,
      reason: 'Snapshot mismatch',
      expected: snapshotStr,
      actual: actualStr,
    };
  }
}

export interface CompareResult {
  match: boolean;
  reason?: string;
  expected?: string;
  actual?: string;
}
