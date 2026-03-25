/**
 * Shared mock utilities for external dependencies
 */

import { vi } from 'vitest';
import type { AxiosError } from 'axios';

/**
 * Mock axios.get to return a successful response
 */
export function mockAxiosGet(
  responseData: unknown,
  statusCode = 200,
  headers: Record<string, string> = {}
): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    data: responseData,
    status: statusCode,
    statusText: 'OK',
    headers,
    config: {},
  });
  return mock;
}

/**
 * Mock axios.get to throw an AxiosError
 */
export function createAxiosError(
  statusCode: number,
  message: string,
  code?: string
): AxiosError {
  const error = new Error(message) as AxiosError;
  error.isAxiosError = true;
  error.name = 'AxiosError';
  error.code = code;
  error.response = {
    data: {},
    status: statusCode,
    statusText: message,
    headers: {},
    config: {} as never,
  };
  error.config = {} as never;
  error.toJSON = () => ({});
  return error;
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
