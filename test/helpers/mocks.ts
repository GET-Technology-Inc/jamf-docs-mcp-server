/**
 * Shared mock utilities for external dependencies
 */

import { vi } from 'vitest';
import { HttpError } from '../../src/core/http-client.js';

/**
 * Create an HttpError for testing
 */
export function createHttpError(
  statusCode: number,
  message: string
): HttpError {
  return new HttpError(statusCode, message, 'https://test.example.com');
}

/**
 * Mock fs.readFile to return content or throw ENOENT
 */
export function createFsReadFileMock(
  fileContents: Map<string, string>
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (filePath: string) => {
    const content = fileContents.get(filePath);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  });
}

/**
 * Mock fs.writeFile to track writes
 */
export function createFsWriteFileMock(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(undefined);
}

/**
 * Mock fs.readdir to return a list of filenames
 */
export function createFsReaddirMock(files: string[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(files);
}

/**
 * Mock fs.unlink (delete file)
 */
export function createFsUnlinkMock(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(undefined);
}

/**
 * Mock fs.mkdir
 */
export function createFsMkdirMock(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(undefined);
}
