/**
 * Pluggable logging system for the stellar_card SDK (#709).
 *
 * Supports custom loggers (Pino, Winston, Console) and log-level filtering.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

export class ConsoleLogger implements Logger {
  private levelWeight: number;

  constructor(public readonly level: LogLevel = 'info') {
    this.levelWeight = LOG_LEVEL_WEIGHT[level] ?? LOG_LEVEL_WEIGHT.info;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.levelWeight <= LOG_LEVEL_WEIGHT.debug) {
      console.debug(`\x1b[34m[DEBUG]\x1b[0m ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.levelWeight <= LOG_LEVEL_WEIGHT.info) {
      console.info(`\x1b[32m[INFO]\x1b[0m ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.levelWeight <= LOG_LEVEL_WEIGHT.warn) {
      console.warn(`\x1b[33m[WARN]\x1b[0m ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.levelWeight <= LOG_LEVEL_WEIGHT.error) {
      console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`, ...args);
    }
  }
}

export interface LoggerOptions {
  logger?: Logger;
  logLevel?: LogLevel;
}

/**
 * Create a logger instance configured with level filtering.
 * Defaults to silent in production and console logger in debug mode.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  if (opts.logger) {
    if (!opts.logLevel) {
      return opts.logger;
    }
    const custom = opts.logger;
    const minWeight = LOG_LEVEL_WEIGHT[opts.logLevel] ?? LOG_LEVEL_WEIGHT.silent;
    return {
      debug: (msg, ...args) => {
        if (minWeight <= LOG_LEVEL_WEIGHT.debug) custom.debug(msg, ...args);
      },
      info: (msg, ...args) => {
        if (minWeight <= LOG_LEVEL_WEIGHT.info) custom.info(msg, ...args);
      },
      warn: (msg, ...args) => {
        if (minWeight <= LOG_LEVEL_WEIGHT.warn) custom.warn(msg, ...args);
      },
      error: (msg, ...args) => {
        if (minWeight <= LOG_LEVEL_WEIGHT.error) custom.error(msg, ...args);
      },
    };
  }

  const level = opts.logLevel ?? (process.env.DEBUG ? 'debug' : 'silent');
  if (level === 'silent') {
    return new SilentLogger();
  }

  return new ConsoleLogger(level);
}
