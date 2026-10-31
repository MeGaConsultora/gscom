// GScom — service worker mínimo, solo para que la app se pueda instalar en el celular/PC.
// NO guarda copias de la app ni de los datos: todo se pide siempre a la red, así nunca
// queda una versión vieja. Lo único que agrega: si se abre sin conexión, muestra un aviso
// en vez de la página de error del navegador.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // archivos y datos: el navegador los pide normalmente
  e.respondWith(fetch(e.request).catch(() => new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GScom — sin conexión</title></head>
    <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#e8eaed;font-family:system-ui,sans-serif;text-align:center;padding:24px">
    <div><h2 style="margin:0 0 .5rem">Sin conexión</h2><p style="color:#9aa0a6;margin:0 0 1.2rem">GScom necesita internet para funcionar.<br>Revisá la conexión y volvé a intentar.</p>
    <button onclick="location.reload()" style="padding:.7rem 1.4rem;border-radius:10px;border:0;background:#1f4fa3;color:#fff;font-size:1rem">Reintentar</button></div>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
