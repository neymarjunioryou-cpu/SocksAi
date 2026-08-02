// SocksRoute — shared HTTP helpers.
export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

export function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`request body exceeds ${Math.round(limit / 1024 / 1024)}MB limit`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Drain a ReadableStream into an HTTP response. */
export async function pump(res, stream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    // client likely disconnected — nothing to do
  } finally {
    reader.releaseLock();
  }
}

/**
 * Abort signal that fires when the *response* stream dies before it was
 * finished (i.e. the client disconnected mid-stream).
 */
export function requestSignal(req, res) {
  const ac = new AbortController();
  res.once('close', () => {
    if (!res.writableEnded) ac.abort(new Error('Client disconnected'));
  });
  return ac.signal;
}
