const { getRouter } = require('stremio-addon-sdk');
const { getAddonInterface } = require('./fs15-runtime');
const http = require('http');

const PORT = Number(process.env.PORT || 7000);
const addon = getAddonInterface();
const router = getRouter(addon);

const server = http.createServer((req, res) => {
  if (req.url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(addon.manifest));
  }
  router(req, res, () => { res.writeHead(404); res.end(); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`FS15 Catalog listening on ${PORT}`));
