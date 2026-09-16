// 临时 :8899 日志收集器 —— 接收 Mira app 的 postLog，落盘到 logcollector.out
const http = require('http');
const fs = require('fs');
const OUT = __dirname + '/logcollector.out';
fs.writeFileSync(OUT, ''); // 清空
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);
        const line = `[${new Date().toISOString()}] ${obj.tag} | ${obj.msg}\n`;
        fs.appendFileSync(OUT, line);
        process.stdout.write(line);
      } catch (e) { /* ignore */ }
      res.writeHead(200); res.end('ok');
    });
  } else {
    res.writeHead(404); res.end('nope');
  }
});
server.listen(8899, '0.0.0.0', () => {
  console.log('[logcollector] listening on :8899 -> ' + OUT);
});
