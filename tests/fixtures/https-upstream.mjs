import http from 'node:http';
import { createHash } from 'node:crypto';
const server = http.createServer(async (req, res) => {
  let bytes = 0; for await (const chunk of req) bytes += chunk.length;
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({ received: bytes, proto: req.headers['x-forwarded-proto'] }));
});
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  // An independent server frame proves the proxy forwards upgraded traffic.
  socket.write(Buffer.concat([Buffer.from([0x81, 8]), Buffer.from('MGO WSS!')]));
  socket.on('error', () => undefined);
});
server.listen(8080,'0.0.0.0');
