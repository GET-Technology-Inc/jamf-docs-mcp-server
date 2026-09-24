/**
 * Prompt argument length limits, checked against the schemas the prompts
 * actually register.
 *
 * This file used to test inline copies instead of src/: it imported nothing
 * but vitest and zod. Its four blocks mirrored the CRLF strip and the
 * sensitive-directory list from src/platforms/node/config.ts, a stripHtml()
 * helper, and these two schemas. The copies could not fail when the real code
 * changed; with config.ts's CRLF strip and path-boundary check both deleted,
 * the file still passed 45/45. As of 2026-09-24:
 *  - the config.ts cases live in test/unit/platforms/node-config.test.ts,
 *    which calls createNodeConfig itself;
 *  - the stripHtml() block is gone. That function was deleted from src/ in
 *    ed63fb0 (#78, 2026-04-04); its successor, cleanSnippet() in
 *    content-parser.ts, is imported and tested directly elsewhere;
 *  - the schema cases below now read the argsSchema each prompt passes to
 *    registerPrompt, so shrinking or dropping the .max(2000) fails them.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerTroubleshootPrompt } from '../../src/core/prompts/troubleshoot.js';
import { registerSetupGuidePrompt } from '../../src/core/prompts/setup-guide.js';

/** The argsSchema a prompt registers, as the object schema the SDK validates against. */
function registeredArgsSchema(register: (server: McpServer) => void): z.ZodObject {
  let shape: z.ZodRawShape | undefined;
  const server = {
    registerPrompt: vi.fn((_name: string, config: { argsSchema?: z.ZodRawShape }) => {
      shape = config.argsSchema;
    }),
  } as unknown as McpServer;
  register(server);
  if (shape === undefined) {
    throw new Error('the prompt registered no argsSchema');
  }
  return z.object(shape);
}

describe('Prompt length limits', () => {
  describe('jamf_troubleshoot problem field', () => {
    const troubleshootSchema = registeredArgsSchema(registerTroubleshootPrompt);

    it('should accept a short problem description', () => {
      const result = troubleshootSchema.safeParse({ problem: 'MDM enrollment failing' });
      expect(result.success).toBe(true);
    });

    it('should accept a problem description exactly 2000 characters long', () => {
      const result = troubleshootSchema.safeParse({ problem: 'x'.repeat(2000) });
      expect(result.success).toBe(true);
    });

    it('should reject a problem description longer than 2000 characters', () => {
      const result = troubleshootSchema.safeParse({ problem: 'x'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept an empty problem description (no min constraint)', () => {
      const result = troubleshootSchema.safeParse({ problem: '' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is omitted', () => {
      const result = troubleshootSchema.safeParse({ problem: 'FileVault key escrow not working' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is provided', () => {
      const result = troubleshootSchema.safeParse({
        problem: 'Cannot enroll device',
        product: 'jamf-pro',
      });
      expect(result.success).toBe(true);
    });

    it('should reject when the problem field is missing', () => {
      const result = troubleshootSchema.safeParse({ product: 'jamf-pro' });
      expect(result.success).toBe(false);
    });
  });

  describe('jamf_setup_guide feature field', () => {
    const setupGuideSchema = registeredArgsSchema(registerSetupGuidePrompt);

    it('should accept a short feature description', () => {
      const result = setupGuideSchema.safeParse({ feature: 'FileVault' });
      expect(result.success).toBe(true);
    });

    it('should accept a feature description exactly 2000 characters long', () => {
      const result = setupGuideSchema.safeParse({ feature: 'y'.repeat(2000) });
      expect(result.success).toBe(true);
    });

    it('should reject a feature description longer than 2000 characters', () => {
      const result = setupGuideSchema.safeParse({ feature: 'y'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept when the optional product field is omitted', () => {
      const result = setupGuideSchema.safeParse({ feature: 'DEP enrollment' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is provided', () => {
      const result = setupGuideSchema.safeParse({
        feature: 'LDAP directory binding',
        product: 'jamf-pro',
      });
      expect(result.success).toBe(true);
    });

    it('should reject when the feature field is missing', () => {
      const result = setupGuideSchema.safeParse({ product: 'jamf-school' });
      expect(result.success).toBe(false);
    });
  });
});
