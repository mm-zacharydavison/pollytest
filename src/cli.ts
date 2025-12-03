#!/usr/bin/env bun
/**
 * CLI entry point for @zdavison/pollytest test runner.
 *
 * Usage:
 *   @zdavison/pollytest [options]
 *   bunx @zdavison/pollytest [options]
 */

import { runTests } from './runner';

runTests().catch((error) => {
  console.error('\nError:', error.message);
  process.exit(1);
});
