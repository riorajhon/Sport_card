/** In-memory SSE clients for card add/update notifications */
const clients = new Set();
const KEEPALIVE_MS = 25_000;

export function subscribe(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {}
  }
}

/** Send SSE comment periodically so proxies don't close idle connections */
export function startKeepalive() {
  setInterval(() => {
    const comment = ': keepalive\n\n';
    for (const res of clients) {
      try {
        res.write(comment);
        if (typeof res.flush === 'function') res.flush();
      } catch (_) {}
    }
  }, KEEPALIVE_MS);
}
