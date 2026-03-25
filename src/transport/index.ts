/**
 * Transport configuration and CLI argument parsing
 */

export interface TransportArgs {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
}

/**
 * Parse CLI arguments for transport configuration
 */
export function parseCliArgs(argv: string[]): TransportArgs {
  const args: TransportArgs = {
    transport: 'stdio',
    port: 3000,
    host: '127.0.0.1',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--transport' && next !== undefined) {
      if (next !== 'stdio' && next !== 'http') {
        console.error(`Invalid transport: "${next}". Must be "stdio" or "http".`);
        process.exit(1);
      }
      args.transport = next;
      i++;
    } else if (arg === '--port' && next !== undefined) {
      const port = parseInt(next, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: "${next}". Must be 1-65535.`);
        process.exit(1);
      }
      args.port = port;
      i++;
    } else if (arg === '--host' && next !== undefined) {
      args.host = next;
      i++;
    }
  }

  return args;
}
