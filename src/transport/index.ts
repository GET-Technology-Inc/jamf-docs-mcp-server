/**
 * Transport configuration and CLI argument parsing
 */

import { createStderrLogger } from '../core/services/logging.js';

const log = createStderrLogger('transport');

export interface TransportArgs {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
}

const OPTIONS = ['--transport', '--port', '--host'] as const;
type Option = typeof OPTIONS[number];

function isOption(name: string): name is Option {
  return (OPTIONS as readonly string[]).includes(name);
}

/**
 * Parse CLI arguments for transport configuration.
 *
 * Each option is given as `--port 8080` or `--port=8080`. An argument it does
 * not know, or an option given no value, is ignored with a warning on stderr.
 * Until 2026-09-28 both were ignored without one, and so was the `=` form:
 * `--transport=http --port=8080` started on stdio, and a misspelt
 * `--prot 8080` listened on 3000.
 */
export function parseCliArgs(argv: string[]): TransportArgs {
  const args: TransportArgs = {
    transport: 'stdio',
    port: 3000,
    host: '127.0.0.1',
  };

  const rest = [...argv];
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!isOption(name)) {
      log.warning(`Ignoring unknown argument "${arg}". The options are ${OPTIONS.join(', ')}.`);
      continue;
    }
    // `--port=8080`, or `--port 8080`, which takes the next argument.
    const value = eq === -1 ? rest.shift() : arg.slice(eq + 1);
    if (value === undefined) {
      log.warning(`Ignoring ${name}, which was given no value.`);
      continue;
    }

    if (name === '--transport') {
      if (value !== 'stdio' && value !== 'http') {
        log.error(`Invalid transport: "${value}". Must be "stdio" or "http".`);
        process.exit(1);
      }
      args.transport = value;
    } else if (name === '--port') {
      // Read as the numeric environment settings are (getEnvNumber): with
      // `Number`, and taken only if it is a whole number. Until 2026-09-28
      // this was `parseInt`, which stops at the first character that is not a
      // digit: `--port 8080x` listened on 8080 and `3000.9` on 3000, without a
      // word, and `1e3` asked for port 1. It now reads `1e3` as 1000, and
      // takes `0x1F90`, `0o17` and `0b11`, which it refused, as 8080, 15 and 3.
      // A blank value is 0 to `Number`, and refused as out of range.
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        log.error(`Invalid port: "${value}". Must be a whole number from 1 to 65535.`);
        process.exit(1);
      }
      args.port = port;
    } else {
      // Node listens on every interface for an empty host, so `--host=` or
      // `--host ''` would expose the server to the network. Until 2026-09-28
      // `--host ''` did, measured that day: it listened on `::`.
      if (value.trim() === '') {
        log.error(`Invalid host: "${value}". Must not be blank, which would listen on every interface.`);
        process.exit(1);
      }
      args.host = value;
    }
  }

  return args;
}
