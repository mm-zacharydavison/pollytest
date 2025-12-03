import { spawn } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import * as readline from 'node:readline/promises';

/**
 * Detect the package manager based on lock files.
 */
function detectPackageManager(): string {
  if (existsSync('bun.lockb') || existsSync('bun.lock')) {
    return 'bun';
  }
  if (existsSync('pnpm-lock.yaml')) {
    return 'pnpm';
  }
  if (existsSync('yarn.lock')) {
    return 'yarn';
  }
  return 'npm';
}

/**
 * Get the default test command based on package manager.
 */
function getDefaultTestCommand(): string {
  const pm = detectPackageManager();
  return `${pm} test`;
}

export interface RunnerOptions {
  /**
   * Test mode to run in.
   */
  mode?: 'real' | 'recorded';

  /**
   * Custom test command to run.
   * @default 'bun test'
   */
  testCommand?: string;

  /**
   * Environment variable name for real mode.
   * @default 'REAL_APIS'
   */
  realModeEnvVar?: string;
}

/**
 * Parse command line arguments for the test runner.
 */
export function parseArgs(args: string[] = process.argv.slice(2)): RunnerOptions {
  const options: RunnerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--real' || arg === '-r') {
      options.mode = 'real';
    } else if (arg === '--recorded' || arg === '--replay') {
      options.mode = 'recorded';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      // Positional argument is the test command
      options.testCommand = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
@zdavison/pollytest - HTTP Recording Test Runner

Usage:
  bunx @zdavison/pollytest [command] [options]

Arguments:
  command            Test command to run (auto-detects package manager)

Options:
  --real, -r         Run tests in real API mode (hits real APIs)
  --recorded         Run tests in recorded mode (uses saved recordings)
  --help, -h         Show this help message

Examples:
  bunx @zdavison/pollytest                      # interactive, auto-detect
  bunx @zdavison/pollytest --real               # record mode
  bunx @zdavison/pollytest 'pnpm test' --real   # custom command
`);
}

async function promptMode(rl: readline.Interface): Promise<'real' | 'recorded'> {
  console.log('\npollytest\n');
  console.log('Choose test mode:');
  console.log('  1. Recorded mode (fast, uses saved API responses)');
  console.log('  2. Real API mode (hits real APIs, updates recordings)\n');

  const answer = await rl.question('Enter 1 or 2 (default: 1): ');
  const choice = answer.trim() || '1';

  if (choice === '2') {
    return 'real';
  }

  return 'recorded';
}

function runCommand(command: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: true,
    });

    child.on('close', (code) => {
      resolve(code || 0);
    });

    child.on('error', (err) => {
      console.error(`Failed to start command: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Run the interactive test runner.
 */
export async function runTests(options: RunnerOptions = {}): Promise<void> {
  const cliOptions = parseArgs();
  const mergedOptions = { ...options, ...cliOptions };

  let mode: 'real' | 'recorded';
  let rl: readline.Interface | null = null;

  const testCommand = mergedOptions.testCommand ?? getDefaultTestCommand();
  const realModeEnvVar = mergedOptions.realModeEnvVar ?? 'REAL_APIS';

  // Determine mode
  if (mergedOptions.mode) {
    mode = mergedOptions.mode;
    console.log(`\nRunning tests in ${mode} mode\n`);
  } else {
    rl = readline.createInterface({ input, output });
    mode = await promptMode(rl);
  }

  const env = mode === 'real' ? { [realModeEnvVar]: 'true' } : {};

  // Run the test command directly via shell
  const exitCode = await runCommand(testCommand, [], env);

  if (exitCode !== 0) {
    console.error('\nTests failed');
    if (rl) rl.close();
    process.exit(exitCode);
  }

  console.log('\nAll tests passed!');

  if (mode === 'real') {
    console.log('\nRecordings and snapshots have been updated.');
    console.log('Review changes with: git diff');
  }

  if (rl) rl.close();
}
