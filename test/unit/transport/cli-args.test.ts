/**
 * Unit tests for CLI argument parsing (src/transport/index.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCliArgs } from '../../../src/transport/index.js';

describe('parseCliArgs', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  /** What parseCliArgs wrote to stderr in the case. */
  let printed: string[];

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error(`process.exit(${String(_code)})`);
    });
    printed = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => { printed.push(String(line)); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default arguments', () => {
    it('should return defaults when passed an empty array', () => {
      const result = parseCliArgs([]);
      expect(result).toEqual({ transport: 'stdio', port: 3000, host: '127.0.0.1' });
    });

    it('should default transport to stdio', () => {
      const result = parseCliArgs([]);
      expect(result.transport).toBe('stdio');
    });

    it('should default port to 3000', () => {
      const result = parseCliArgs([]);
      expect(result.port).toBe(3000);
    });

    it('should default host to 127.0.0.1', () => {
      const result = parseCliArgs([]);
      expect(result.host).toBe('127.0.0.1');
    });
  });

  describe('--transport flag', () => {
    it('should set transport to "http" when --transport http is given', () => {
      const result = parseCliArgs(['--transport', 'http']);
      expect(result.transport).toBe('http');
    });

    it('should accept "stdio" explicitly', () => {
      const result = parseCliArgs(['--transport', 'stdio']);
      expect(result.transport).toBe('stdio');
    });

    it('should call process.exit(1) for an invalid transport value', () => {
      expect(() => parseCliArgs(['--transport', 'grpc'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('ignores --transport with no following value, and says so', () => {
      // Until 2026-09-28 without a word.
      const result = parseCliArgs(['--transport']);
      expect(result.transport).toBe('stdio');
      expect(printed).toEqual(['[WARNING] [transport] Ignoring --transport, which was given no value.']);
    });
  });

  describe('--port flag', () => {
    it('should parse --port 8080 as numeric 8080', () => {
      const result = parseCliArgs(['--port', '8080']);
      expect(result.port).toBe(8080);
    });

    it('should accept port 1 (minimum valid)', () => {
      const result = parseCliArgs(['--port', '1']);
      expect(result.port).toBe(1);
    });

    it('should accept port 65535 (maximum valid)', () => {
      const result = parseCliArgs(['--port', '65535']);
      expect(result.port).toBe(65535);
    });

    it('should call process.exit(1) for port 0 (below minimum)', () => {
      expect(() => parseCliArgs(['--port', '0'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit(1) for port 65536 (above maximum)', () => {
      expect(() => parseCliArgs(['--port', '65536'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit(1) for non-numeric port "abc"', () => {
      expect(() => parseCliArgs(['--port', 'abc'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit(1) for port 99999 (well above maximum)', () => {
      expect(() => parseCliArgs(['--port', '99999'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit(1) for negative port --port -1', () => {
      expect(() => parseCliArgs(['--port', '-1'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call process.exit(1) for NaN port --port NaN', () => {
      expect(() => parseCliArgs(['--port', 'NaN'])).toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('--host flag', () => {
    it('should set host to "0.0.0.0" when --host 0.0.0.0 is given', () => {
      const result = parseCliArgs(['--host', '0.0.0.0']);
      expect(result.host).toBe('0.0.0.0');
    });

    it('should accept a custom hostname', () => {
      const result = parseCliArgs(['--host', 'my.server.local']);
      expect(result.host).toBe('my.server.local');
    });

    // Node listens on every interface for an empty host: until 2026-09-28,
    // `--host ''` listened on `::`.
    it.each([[['--host', '']], [['--host', '  ']], [['--host=']]])('refuses a blank host, %j', (argv) => {
      expect(() => parseCliArgs(argv)).toThrow('process.exit(1)');
      expect(printed.join('\n')).toContain('Must not be blank, which would listen on every interface.');
    });
  });

  describe('--name=value', () => {
    // Until 2026-09-28 this form was ignored without a word, and the server
    // started on stdio.
    it('reads each option written with =', () => {
      const result = parseCliArgs(['--transport=http', '--port=8080', '--host=0.0.0.0']);
      expect(result).toEqual({ transport: 'http', port: 8080, host: '0.0.0.0' });
      expect(printed).toEqual([]);
    });

    it('checks the value as it does the one after a space', () => {
      expect(() => parseCliArgs(['--port=8080x'])).toThrow('process.exit(1)');
      expect(() => parseCliArgs(['--transport=grpc'])).toThrow('process.exit(1)');
      expect(printed).toEqual([
        '[ERROR] [transport] Invalid port: "8080x". Must be a whole number from 1 to 65535.',
        '[ERROR] [transport] Invalid transport: "grpc". Must be "stdio" or "http".',
      ]);
    });

    it.each(['--port=', '--transport='])('refuses %j, which is given an empty value', (arg) => {
      expect(() => parseCliArgs([arg])).toThrow('process.exit(1)');
    });

    it('reads the value up to the end, = included', () => {
      expect(() => parseCliArgs(['--port=80=80'])).toThrow('process.exit(1)');
      expect(printed).toEqual(['[ERROR] [transport] Invalid port: "80=80". Must be a whole number from 1 to 65535.']);
    });

    it('does not take the next argument as the value', () => {
      const result = parseCliArgs(['--host=127.0.0.1', '--port', '9000']);
      expect(result).toEqual({ transport: 'stdio', port: 9000, host: '127.0.0.1' });
    });
  });

  describe('an argument it does not know', () => {
    // Until 2026-09-28 each was ignored without a word, so a misspelt option
    // left the default in place.
    it('is ignored, and each one said so', () => {
      const result = parseCliArgs(['--prot', '8080']);
      expect(result.port).toBe(3000);
      expect(printed).toEqual([
        '[WARNING] [transport] Ignoring unknown argument "--prot". The options are --transport, --port, --host.',
        '[WARNING] [transport] Ignoring unknown argument "8080". The options are --transport, --port, --host.',
      ]);
    });

    it.each(['--Port=8080', '-p', '--', 'http'])('such as %j, is ignored and said so', (arg) => {
      expect(parseCliArgs([arg])).toEqual({ transport: 'stdio', port: 3000, host: '127.0.0.1' });
      expect(printed).toEqual([
        `[WARNING] [transport] Ignoring unknown argument "${arg}". The options are --transport, --port, --host.`,
      ]);
    });

    it('does not stop the options after it from being read', () => {
      expect(parseCliArgs(['--verbose', '--port', '9000']).port).toBe(9000);
      expect(printed).toHaveLength(1);
    });

    it('is not an option\'s value, even one that begins with dashes', () => {
      expect(parseCliArgs(['--host', '--weird']).host).toBe('--weird');
      expect(printed).toEqual([]);
    });

    it.each(['--port', '--host'])('is not %j given no value, which is ignored and said so too', (arg) => {
      expect(parseCliArgs([arg])).toEqual({ transport: 'stdio', port: 3000, host: '127.0.0.1' });
      expect(printed).toEqual([`[WARNING] [transport] Ignoring ${arg}, which was given no value.`]);
    });
  });

  describe('combined flags', () => {
    it('should parse all flags together correctly', () => {
      const result = parseCliArgs([
        '--transport', 'http',
        '--port', '8080',
        '--host', '0.0.0.0',
      ]);
      expect(result).toEqual({ transport: 'http', port: 8080, host: '0.0.0.0' });
      expect(printed).toEqual([]);
    });

    it('should use defaults for flags that are absent when others are provided', () => {
      const result = parseCliArgs(['--port', '9000']);
      expect(result.transport).toBe('stdio');
      expect(result.host).toBe('127.0.0.1');
      expect(result.port).toBe(9000);
    });
  });
});
