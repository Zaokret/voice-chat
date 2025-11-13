import EventEmitter from "events";
import { createServer } from "http";

export const dashboardEmitter = new EventEmitter()

export const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // or specific origin
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // --- Handle preflight requests ---
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    const onData = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    dashboardEmitter.on('data', onData);
    req.on('close', () => dashboardEmitter.off('data', onData));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(require('fs').readFileSync('./visual/dashboard.html'));
  }
})