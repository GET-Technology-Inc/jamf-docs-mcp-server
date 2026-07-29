/**
 * Reads a Streamable HTTP response the way a real MCP client does.
 *
 * The transport is free to answer either with a single JSON body or with an
 * SSE stream — the 2025 binding requires clients to accept both, and which one
 * arrives depends on the protocol era and on whether the handler emitted
 * anything before its result. Tests that hard-code `res.json()` are really
 * asserting a framing choice they do not care about, so they use this instead.
 */

/** Extract the JSON-RPC messages carried by an `text/event-stream` body. */
export function parseSseMessages(body: string): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const frame of body.split('\n\n')) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('');
    if (data.length > 0) {
      messages.push(JSON.parse(data) as Record<string, unknown>);
    }
  }
  return messages;
}

/**
 * All JSON-RPC messages in a response, in order. A JSON body yields one; an
 * SSE stream yields its frames, so any notifications the handler emitted
 * before the result are visible too.
 */
export async function readJsonRpcMessages(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  if (text.trim().length === 0) {return [];}
  return res.headers.get('content-type')?.includes('text/event-stream') === true
    ? parseSseMessages(text)
    : [JSON.parse(text) as Record<string, unknown>];
}

/**
 * The response to a request: the last message carrying `result` or `error`.
 * Notifications emitted alongside it are skipped.
 */
export async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const messages = await readJsonRpcMessages(res);
  const response = messages.filter((m) => 'result' in m || 'error' in m).pop();
  if (response === undefined) {
    throw new Error(`No JSON-RPC response in body (${messages.length} message(s))`);
  }
  return response;
}
