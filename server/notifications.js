/** In-memory SSE clients for card add/update notifications */
const clients = new Set();

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
