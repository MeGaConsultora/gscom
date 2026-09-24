import { store, ESTADOS, estadoInfo, FORMAS_PAGO, TIPOS_EQUIPO, resetDemo } from './store.js';

// =====================================================================
// Utilidades
// =====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = n => fmtMoney.format(+n || 0);
const toDate = iso => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00' : iso); // fechas sin hora = día local
const fdate = iso => iso ? toDate(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fdatetime = iso => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const isToday = iso => sameDay(iso, new Date());
const daysSince = iso => Math.floor((Date.now() - new Date(iso)) / 86400000);
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const matches = (q, ...fields) => { const t = norm(q).trim(); return !t || t.split(/\s+/).every(w => fields.some(f => norm(f).includes(w))); };
const pill = estado => { const e = estadoInfo(estado); return `<span class="pill ${e.color}">${esc(e.label)}</span>`; };
const ACTIVAS = o => !['entregado'].includes(o.estado);

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4500 : 2500);
}
async function run(fn) { try { return await fn(); } catch (e) { console.error(e); toast(e.message || 'Error', true); } }

function modal(title, body, foot = '', { wide = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  setTimeout(() => $('input:not([type=hidden]),select,textarea', bg)?.focus(), 30);
  return { el: bg, close };
}
const formData = el => Object.fromEntries($$('[name]', el).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value.trim()]));

function printHTML(html) {
  const area = $('#print-area');
  area.innerHTML = html;
  setTimeout(() => window.print(), 150);
}

function barcodeSVG(code, opts = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const base = { width: 1.6, height: 45, fontSize: 13, margin: 0, background: 'transparent', ...opts };
  try {
    if (/^\d{13}$/.test(code)) JsBarcode(svg, code, { ...base, format: 'EAN13', flat: true });
    else if (/^\d{12}$/.test(code)) JsBarcode(svg, code, { ...base, format: 'UPC', flat: true });
    else throw 0;
  } catch { try { JsBarcode(svg, code, { ...base, format: 'CODE128' }); } catch { return ''; } }
  return svg.outerHTML;
}
function qrSVG(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
const trackingURL = token => new URL(`seguimiento.html?t=${token}`, location.href).href;
function waLink(telefono, texto) {
  let d = String(telefono || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d && !d.startsWith('54')) d = '549' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

// =====================================================================
// Router
// =====================================================================
const NAV = [
  ['inicio', 'Inicio'], ['vender', 'Vender'], ['service', 'Service'], ['productos', 'Productos'],
  ['clientes', 'Clientes'], ['caja', 'Caja'], ['compras', 'Compras'], ['reportes', 'Reportes'], ['ajustes', 'Ajustes'],
];
const ROUTES = {};
const view = () => $('#view');

function parseHash() {
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'inicio').split('?');
  const [name, id] = path.split('/');
  return { name, id, q: new URLSearchParams(qs || '') };
}
async function render() {
  $$('.modal-bg').forEach(m => m.remove()); // cerrar modales al cambiar de pantalla
  const r = parseHash();
  $$('nav.tabs a').forEach(a => a.classList.toggle('active', a.dataset.r === r.name));
  const fn = ROUTES[r.name] || ROUTES.inicio;
  view().innerHTML = '<div class="empty">Cargando…</div>';
  await run(() => fn(r));
  window.scrollTo(0, 0);
}
const go = h => { if (location.hash === h) render(); else location.hash = h; };

// =====================================================================
// INICIO
// =====================================================================
ROUTES.inicio = async () => {
  const [ventas, ordenes, productos, caja, clientes] = await Promise.all([store.ventas(), store.ordenes(), store.productos(), store.cajaMovimientos(), store.clientes()]);
  const cliNombre = id => clientes.find(c => c.id === id)?.nombre;
  const hoy = ventas.filter(v => !v.anulada && isToday(v.fecha));
  const totalHoy = hoy.reduce((s, v) => s + v.total, 0);
  const efectivo = caja.filter(m => isToday(m.fecha) && m.forma_pago === 'Efectivo').reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0);
  const activas = ordenes.filter(ACTIVAS);
  const listas = ordenes.filter(o => o.estado === 'listo' || o.estado === 'sin_reparacion');
  const bajos = productos.filter(p => !p.es_servicio && p.stock <= p.stock_minimo);

  view().innerHTML = `
  <div class="page-head"><h1>Resumen de hoy</h1>
    <div class="actions"><a class="btn primary" href="#/vender">Nueva venta</a><button class="btn" id="nueva-orden">Nueva orden de service</button></div></div>
  <div class="grid grid-4" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Ventas de hoy</div><div class="value">${money(totalHoy)}</div><div class="sub">${hoy.length} venta${hoy.length === 1 ? '' : 's'}</div></div>
    <div class="card kpi"><div class="label">Efectivo en caja (hoy)</div><div class="value">${money(efectivo)}</div><div class="sub">ingresos − egresos en efectivo</div></div>
    <div class="card kpi"><div class="label">Equipos en el taller</div><div class="value">${activas.length}</div><div class="sub">órdenes sin entregar</div></div>
    <div class="card kpi"><div class="label">Para retirar</div><div class="value">${listas.length}</div><div class="sub">listos o sin reparación</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card card-pad"><h2>Service por estado <a class="small" href="#/service">Ver todo →</a></h2>
      <table class="tbl"><tbody>${ESTADOS.filter(e => e.id !== 'entregado').map(e => {
        const n = ordenes.filter(o => o.estado === e.id).length;
        return `<tr class="click" data-href="#/service?estado=${e.id}"><td>${pill(e.id)}</td><td class="num"><b>${n}</b></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="card card-pad"><h2>Stock bajo <a class="small" href="#/productos?bajo=1">Ver productos →</a></h2>
      ${bajos.length ? `<table class="tbl"><thead><tr><th>Producto</th><th class="num">Stock</th><th class="num">Mínimo</th></tr></thead><tbody>
        ${bajos.map(p => `<tr class="click" data-prod="${p.id}"><td>${esc(p.nombre)}</td><td class="num"><span class="pill ${p.stock <= 0 ? 'red' : 'amber'}">${p.stock}</span></td><td class="num muted">${p.stock_minimo}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Todo en orden ✔</div>'}</div>
    <div class="card card-pad" style="grid-column:1/-1"><h2>Últimas ventas <a class="small" href="#/caja">Ir a caja →</a></h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th class="num">Total</th></tr></thead><tbody>
      ${ventas.slice(0, 6).map(v => `<tr class="click" data-venta="${v.id}"><td class="mono">#${v.numero}</td><td>${fdatetime(v.fecha)}</td><td>${v.cliente_id ? esc(cliNombre(v.cliente_id)) : '<span class="muted">Consumidor final</span>'}</td><td>${esc(v.forma_pago)}</td><td class="num">${v.anulada ? '<span class="pill red">Anulada</span> ' : ''}${money(v.total)}</td></tr>`).join('')}
      </tbody></table></div></div>
  </div>`;
  $('#nueva-orden').onclick = () => nuevaOrdenModal();
  bindRowLinks();
};

function bindRowLinks() {
  $$('tr[data-href]').forEach(tr => tr.onclick = () => go(tr.dataset.href));
  $$('tr[data-prod]').forEach(tr => tr.onclick = () => productoModal(+tr.dataset.prod));
  $$('tr[data-venta]').forEach(tr => tr.onclick = () => ventaModal(+tr.dataset.venta));
}

// =====================================================================
// VENDER (punto de venta)
// =====================================================================
let cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo' };

ROUTES.vender = async ({ q }) => {
  const [productos, clientes] = await Promise.all([store.productos(), store.clientes()]);
  if (q.get('cliente')) cart.cliente_id = q.get('cliente');

  view().innerHTML = `
  <div class="page-head"><h1>Nueva venta</h1><div class="actions"><button class="btn" id="manual">+ Ítem manual</button><button class="btn danger" id="vaciar">Vaciar</button></div></div>
  <div class="split">
    <div class="card card-pad">
      <div class="search" style="position:relative">
        <input class="input scan-input" id="scan" placeholder="Escaneá el código de barras o buscá por nombre…" autocomplete="off">
        <div class="suggest" id="sug" hidden></div>
      </div>
      <p class="small muted" style="margin:.5rem 0 .3rem">Con lector USB: apuntá al código y se agrega solo. Enter agrega el primer resultado.</p>
      <div id="cart"></div>
    </div>
    <div class="card card-pad">
      <div class="field"><label>Cliente</label>
        <div class="row" style="gap:.4rem"><select class="input" id="cliente"><option value="">Consumidor final</option>
          ${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.dni_cuit ? ' — ' + esc(c.dni_cuit) : ''}</option>`).join('')}</select>
          <button class="btn" id="nuevo-cli" style="flex:0" title="Nuevo cliente">+</button></div></div>
      <div class="field"><label>Forma de pago</label><div class="pay-opts" id="pagos">
        ${FORMAS_PAGO.map(f => `<button class="chip" data-f="${f}">${f}</button>`).join('')}</div></div>
      <div class="field"><label>Descuento ($)</label><input class="input" id="desc" type="number" min="0" step="any" value="${cart.descuento || ''}" placeholder="0"></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:.6rem 0 1rem">
      <div class="row small muted"><span>Subtotal</span><span class="right" id="subt"></span></div>
      <div class="row" style="align-items:baseline;margin:.3rem 0 1rem"><span>Total</span><span class="right total-box" id="tot"></span></div>
      <button class="btn ok lg block" id="cobrar">Cobrar</button>
    </div>
  </div>`;

  const scan = $('#scan'), sug = $('#sug');
  $('#cliente').value = cart.cliente_id;
  $('#cliente').onchange = e => cart.cliente_id = e.target.value;
  const paintPago = () => $$('#pagos .chip').forEach(b => b.classList.toggle('active', b.dataset.f === cart.forma_pago));
  $$('#pagos .chip').forEach(b => b.onclick = () => { cart.forma_pago = b.dataset.f; paintPago(); });
  paintPago();
  $('#desc').oninput = e => { cart.descuento = +e.target.value || 0; paintCart(); };

  function add(p) {
    const line = cart.items.find(i => i.producto_id === p.id);
    if (line) line.cantidad++;
    else cart.items.push({ producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: p.precio_venta, stock: p.stock, es_servicio: p.es_servicio });
    scan.value = ''; sug.hidden = true; paintCart(); scan.focus();
  }
  let results = [], sel = 0;
  const paintSug = () => {
    sug.innerHTML = results.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}"><span>${esc(p.nombre)} <span class="small muted mono">${esc(p.codigo_barras)}</span></span><span class="nowrap">${money(p.precio_venta)}</span></div>`).join('')
      || '<div class="muted">Sin resultados</div>';
    $$('[data-i]', sug).forEach(d => d.onmousedown = e => { e.preventDefault(); add(results[+d.dataset.i]); });
  };
  scan.oninput = () => {
    const t = scan.value.trim();
    if (!t) { sug.hidden = true; return; }
    results = productos.filter(p => p.codigo_barras === t || matches(t, p.nombre, p.marca, p.codigo_barras)).slice(0, 8);
    sel = 0; sug.hidden = false; paintSug();
  };
  scan.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); paintSug(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paintSug(); e.preventDefault(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = scan.value.trim(); if (!t) return;
      const exact = productos.find(p => p.codigo_barras === t);
      if (exact) return add(exact);
      if (results[sel]) return add(results[sel]);
      toast('No se encontró un producto con ese código', true);
    }
    if (e.key === 'Escape') sug.hidden = true;
  };
  scan.onblur = () => setTimeout(() => sug.hidden = true, 150);

  function paintCart() {
    const box = $('#cart');
    if (!cart.items.length) box.innerHTML = '<div class="empty">Todavía no agregaste productos.</div>';
    else box.innerHTML = cart.items.map((i, n) => `
      <div class="cart-line"><div><div class="name">${esc(i.descripcion)}</div>
        <div class="small muted">${money(i.precio_unitario)} c/u${!i.es_servicio && i.producto_id && i.cantidad > i.stock ? ` · <span style="color:var(--bad)">stock disponible: ${i.stock}</span>` : ''}</div></div>
        <div class="qty"><button data-m="${n}">−</button><input value="${i.cantidad}" data-q="${n}" inputmode="decimal"><button data-p="${n}">+</button></div>
        <div class="right"><b>${money(i.cantidad * i.precio_unitario)}</b></div>
        <button class="x" data-del="${n}" title="Quitar">×</button></div>`).join('');
    $$('[data-m]', box).forEach(b => b.onclick = () => { const i = cart.items[+b.dataset.m]; i.cantidad = Math.max(1, i.cantidad - 1); paintCart(); });
    $$('[data-p]', box).forEach(b => b.onclick = () => { cart.items[+b.dataset.p].cantidad++; paintCart(); });
    $$('[data-q]', box).forEach(inp => inp.onchange = () => { cart.items[+inp.dataset.q].cantidad = Math.max(0.01, +inp.value.replace(',', '.') || 1); paintCart(); });
    $$('[data-del]', box).forEach(b => b.onclick = () => { cart.items.splice(+b.dataset.del, 1); paintCart(); });
    const subtotal = cart.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    $('#subt').textContent = money(subtotal);
    $('#tot').textContent = money(subtotal - cart.descuento);
    $('#cobrar').disabled = !cart.items.length;
  }
  paintCart();
  scan.focus();

  $('#vaciar').onclick = () => { cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo' }; render(); };
  $('#manual').onclick = () => {
    const m = modal('Ítem manual', `<p class="small muted" style="margin-bottom:.8rem">Para algo que no está cargado como producto (no descuenta stock).</p>
      <div class="field"><label>Descripción</label><input class="input" name="descripcion" required></div>
      <div class="row"><div class="field"><label>Precio</label><input class="input" name="precio" type="number" step="any" min="0"></div>
      <div class="field"><label>Cantidad</label><input class="input" name="cantidad" type="number" step="any" min="1" value="1"></div></div>`,
      `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Agregar</button>`);
    $('#ok', m.el).onclick = () => {
      const f = formData(m.el);
      if (!f.descripcion || !(+f.precio > 0)) return toast('Completá descripción y precio', true);
      cart.items.push({ producto_id: null, descripcion: f.descripcion, cantidad: +f.cantidad || 1, precio_unitario: +f.precio, es_servicio: true });
      m.close(); paintCart();
    };
  };
  $('#nuevo-cli').onclick = () => clienteModal(null, c => { cart.cliente_id = String(c.id); render(); });
  $('#cobrar').onclick = () => run(async () => {
    const sinStock = cart.items.filter(i => i.producto_id && !i.es_servicio && i.cantidad > i.stock);
    if (sinStock.length && !confirm(`Hay ${sinStock.length} producto(s) sin stock suficiente según el sistema. ¿Registrar la venta igual?`)) return;
    const v = await store.registrarVenta({ cliente_id: cart.cliente_id ? +cart.cliente_id : null, items: cart.items, descuento: cart.descuento, forma_pago: cart.forma_pago });
    cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo' };
    const m = modal(`Venta #${v.numero} registrada`, `<div class="empty" style="padding:1rem"><div class="total-box">${money(v.total)}</div><div class="muted">${esc(v.forma_pago)}</div></div>`,
      `<button class="btn" id="imp">Imprimir comprobante</button><button class="btn primary" data-close>Nueva venta</button>`);
    $('#imp', m.el).onclick = () => imprimirVenta(v.id);
    m.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) render(); });
  });
};

async function imprimirVenta(id) {
  const [v, n] = await Promise.all([store.venta(id), store.negocio()]);
  printHTML(`<div class="ticket">
    <div class="c big">${esc(n.nombre)}</div><div class="c">${esc(n.direccion)}<br>${esc(n.telefono)}</div><hr>
    <div>Comprobante interno N° ${v.numero}<br>${fdatetime(v.fecha)}<br>Cliente: ${esc(v.cliente?.nombre || 'Consumidor final')}</div><hr>
    <table>${v.items.map(i => `<tr><td colspan="2">${esc(i.descripcion)}</td></tr><tr><td>${i.cantidad} x ${money(i.precio_unitario)}</td><td style="text-align:right">${money(i.subtotal)}</td></tr>`).join('')}</table><hr>
    ${v.descuento ? `<table><tr><td>Subtotal</td><td style="text-align:right">${money(v.subtotal)}</td></tr><tr><td>Descuento</td><td style="text-align:right">-${money(v.descuento)}</td></tr></table>` : ''}
    <table><tr><td class="big">TOTAL</td><td class="big" style="text-align:right">${money(v.total)}</td></tr></table>
    <div>Pago: ${esc(v.forma_pago)}</div>${v.anulada ? '<div class="c big">*** ANULADA ***</div>' : ''}<hr>
    <div class="c">Documento no válido como factura.<br>¡Gracias por su compra!</div></div>`);
}

async function ventaModal(id) {
  const v = await store.venta(id);
  const m = modal(`Venta #${v.numero}`, `
    <dl class="kv" style="margin-bottom:1rem"><dt>Fecha</dt><dd>${fdatetime(v.fecha)}</dd><dt>Cliente</dt><dd>${v.cliente ? `<a href="#/clientes/${v.cliente.id}" data-close>${esc(v.cliente.nombre)}</a>` : 'Consumidor final'}</dd>
    <dt>Forma de pago</dt><dd>${esc(v.forma_pago)}</dd>${v.anulada ? '<dt>Estado</dt><dd><span class="pill red">Anulada</span></dd>' : ''}</dl>
    <table class="tbl"><thead><tr><th>Ítem</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead><tbody>
    ${v.items.map(i => `<tr><td>${esc(i.descripcion)}</td><td class="num">${i.cantidad}</td><td class="num">${money(i.precio_unitario)}</td><td class="num">${money(i.subtotal)}</td></tr>`).join('')}
    ${v.descuento ? `<tr><td colspan="3">Descuento</td><td class="num">−${money(v.descuento)}</td></tr>` : ''}
    <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(v.total)}</b></td></tr></tbody></table>`,
    `${v.anulada ? '' : '<button class="btn danger" id="anular">Anular venta</button>'}<button class="btn" id="imp">Imprimir</button><button class="btn primary" data-close>Cerrar</button>`, { wide: true });
  $('#imp', m.el).onclick = () => imprimirVenta(id);
  const an = $('#anular', m.el);
  if (an) an.onclick = () => run(async () => {
    if (!confirm('¿Anular esta venta? Se devuelve el stock y se registra un egreso en caja.')) return;
    await store.anularVenta(id); m.close(); toast('Venta anulada'); render();
  });
}

// =====================================================================
// PRODUCTOS
// =====================================================================
let prodSel = new Set();

ROUTES.productos = async ({ q }) => {
  const [productos, categorias] = await Promise.all([store.productos(), store.categorias()]);
  let filtro = q.get('bajo') ? 'bajo' : 'todos', texto = '';
  view().innerHTML = `
  <div class="page-head"><h1>Productos y stock</h1><div class="actions">
    <button class="btn" id="etiquetas">Imprimir etiquetas <span id="nsel"></span></button><button class="btn primary" id="nuevo">+ Nuevo producto</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por nombre, marca o código (también podés escanear)"></div></div>
  <div class="chips" id="cats"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th style="width:32px"><input type="checkbox" id="all"></th><th>Código</th><th>Producto</th><th>Categoría</th><th class="num">Stock</th><th class="num">Costo</th><th class="num">Precio</th></tr></thead><tbody id="rows"></tbody></table></div>`;

  const catName = id => categorias.find(c => c.id === id)?.nombre || '';
  const chips = [['todos', 'Todos'], ['bajo', 'Stock bajo'], ...categorias.map(c => [String(c.id), c.nombre])];
  const lista = () => productos.filter(p => (filtro === 'todos' || (filtro === 'bajo' ? (!p.es_servicio && p.stock <= p.stock_minimo) : p.categoria_id === +filtro))
    && (texto === p.codigo_barras || matches(texto, p.nombre, p.marca, p.codigo_barras)));
  function paint() {
    $('#cats').innerHTML = chips.map(([k, l]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-k="${k}">${esc(l)}</button>`).join('');
    $$('#cats .chip').forEach(c => c.onclick = () => { filtro = c.dataset.k; paint(); });
    const l = lista();
    $('#rows').innerHTML = l.map(p => `<tr class="click" data-id="${p.id}">
      <td><input type="checkbox" data-sel="${p.id}" ${prodSel.has(p.id) ? 'checked' : ''}></td>
      <td class="mono small">${esc(p.codigo_barras)}${p.codigo_interno ? ' <span class="pill blue" title="Código generado por GScom">int</span>' : ''}</td>
      <td>${esc(p.nombre)}${p.marca ? `<div class="small muted">${esc(p.marca)}</div>` : ''}</td><td class="muted">${esc(catName(p.categoria_id))}</td>
      <td class="num">${p.es_servicio ? '<span class="muted">—</span>' : `<span class="pill ${p.stock <= 0 ? 'red' : p.stock <= p.stock_minimo ? 'amber' : 'green'}">${p.stock}</span>`}</td>
      <td class="num muted">${money(p.precio_costo)}</td><td class="num"><b>${money(p.precio_venta)}</b></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No hay productos que coincidan.</td></tr>';
    $$('#rows tr[data-id]').forEach(tr => tr.onclick = e => { if (e.target.matches('input')) return; productoModal(+tr.dataset.id); });
    $$('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? prodSel.add(+cb.dataset.sel) : prodSel.delete(+cb.dataset.sel); paintSel(); });
    paintSel();
  }
  const paintSel = () => $('#nsel').textContent = prodSel.size ? `(${prodSel.size})` : '';
  $('#buscar').oninput = e => { texto = e.target.value.trim(); paint(); };
  $('#all').onchange = e => { lista().forEach(p => e.target.checked ? prodSel.add(p.id) : prodSel.delete(p.id)); paint(); };
  $('#nuevo').onclick = () => productoModal(null);
  $('#etiquetas').onclick = () => etiquetasModal([...prodSel]);
  paint();
  $('#buscar').focus();
};

async function productoModal(id) {
  const [p, categorias] = await Promise.all([id ? store.producto(id) : null, store.categorias()]);
  const movs = id ? await store.movimientosStock(id) : [];
  const v = p || { nombre: '', codigo_barras: '', marca: '', descripcion: '', categoria_id: '', precio_costo: '', precio_venta: '', stock: '', stock_minimo: 1, es_servicio: false };
  const m = modal(id ? 'Editar producto' : 'Nuevo producto', `
    <div class="field"><label>Nombre *</label><input class="input" name="nombre" value="${esc(v.nombre)}"></div>
    <div class="row"><div class="field"><label>Marca</label><input class="input" name="marca" value="${esc(v.marca)}"></div>
      <div class="field"><label>Categoría</label><select class="input" name="categoria_id"><option value="">—</option>${categorias.map(c => `<option value="${c.id}" ${c.id === v.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}<option value="__nueva">+ Nueva categoría…</option></select></div></div>
    <div class="field"><label>Código de barras</label><input class="input mono" name="codigo_barras" value="${esc(v.codigo_barras)}" ${id ? 'readonly' : ''} placeholder="Escaneá el código de fábrica, o dejalo vacío para generar uno interno">
      ${id ? `<div style="margin-top:.5rem">${barcodeSVG(v.codigo_barras, { height: 40 })}</div>` : ''}</div>
    <div class="row"><div class="field"><label>Precio de costo</label><input class="input" name="precio_costo" type="number" step="any" min="0" value="${v.precio_costo}"></div>
      <div class="field"><label>Precio de venta *</label><input class="input" name="precio_venta" type="number" step="any" min="0" value="${v.precio_venta}"></div>
      <div class="field"><label>Margen</label><input class="input" id="margen" readonly tabindex="-1"></div></div>
    <div class="row">${id ? '' : `<div class="field"><label>Stock inicial</label><input class="input" name="stock" type="number" step="any" value="${v.stock}"></div>`}
      <div class="field"><label>Stock mínimo (alerta)</label><input class="input" name="stock_minimo" type="number" step="any" min="0" value="${v.stock_minimo}"></div></div>
    <label class="small" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.8rem"><input type="checkbox" name="es_servicio" ${v.es_servicio ? 'checked' : ''}> Es un servicio / mano de obra (no maneja stock)</label>
    ${id && !v.es_servicio ? `<div class="card card-pad" style="background:#fafbfc"><h2 style="margin-bottom:.5rem">Stock actual: ${v.stock}</h2>
      <div class="row" style="align-items:flex-end"><div class="field"><label>Ajuste (+ entra / − sale)</label><input class="input" id="aj-cant" type="number" step="any" placeholder="ej: -1"></div>
      <div class="field"><label>Motivo</label><input class="input" id="aj-nota" placeholder="ej: rotura, conteo, devolución"></div>
      <div class="field" style="flex:0"><button class="btn" id="aj-ok">Ajustar</button></div></div>
      <details><summary class="small muted" style="cursor:pointer">Ver movimientos (${movs.length})</summary>
      <table class="tbl small" style="margin-top:.5rem"><tbody>${movs.slice(0, 30).map(mv => `<tr><td>${fdatetime(mv.created_at)}</td><td>${esc(mv.tipo)}</td><td class="muted">${esc(mv.nota || '')}</td><td class="num"><b style="color:${mv.cantidad < 0 ? 'var(--bad)' : 'var(--ok)'}">${mv.cantidad > 0 ? '+' : ''}${mv.cantidad}</b></td></tr>`).join('')}</tbody></table></details></div>` : ''}`,
    `${id ? '<button class="btn" id="etq">Imprimir etiqueta</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);

  const margen = () => { const c = +$('[name=precio_costo]', m.el).value, pv = +$('[name=precio_venta]', m.el).value; $('#margen', m.el).value = c > 0 && pv > 0 ? Math.round((pv / c - 1) * 100) + '%' : '—'; };
  $$('[name=precio_costo],[name=precio_venta]', m.el).forEach(i => i.oninput = margen); margen();
  $('[name=categoria_id]', m.el).onchange = async e => {
    if (e.target.value !== '__nueva') return;
    const nombre = prompt('Nombre de la nueva categoría'); if (!nombre) { e.target.value = ''; return; }
    const c = await store.crearCategoria(nombre.trim());
    const o = new Option(c.nombre, c.id, true, true); e.target.add(o, e.target.options.length - 1);
  };
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (!f.nombre || f.precio_venta === '') return toast('Completá nombre y precio de venta', true);
    const data = { ...(id ? { id } : {}), nombre: f.nombre, marca: f.marca, categoria_id: f.categoria_id && f.categoria_id !== '__nueva' ? +f.categoria_id : null,
      precio_costo: +f.precio_costo || 0, precio_venta: +f.precio_venta || 0, stock_minimo: +f.stock_minimo || 0, es_servicio: f.es_servicio };
    if (!id) { data.codigo_barras = f.codigo_barras; data.stock = +f.stock || 0; }
    const r = await store.guardarProducto(data);
    m.close(); toast(id ? 'Producto actualizado' : `Producto creado · código ${r.codigo_barras}`); render();
  });
  const aj = $('#aj-ok', m.el);
  if (aj) aj.onclick = () => run(async () => {
    const c = +$('#aj-cant', m.el).value; if (!c) return toast('Indicá la cantidad', true);
    await store.ajustarStock(id, c, $('#aj-nota', m.el).value.trim()); m.close(); toast('Stock ajustado'); render();
  });
  const etq = $('#etq', m.el);
  if (etq) etq.onclick = () => { m.close(); etiquetasModal([id]); };
}

async function etiquetasModal(ids) {
  const productos = (await store.productos()).filter(p => ids.includes(p.id));
  if (!productos.length) return toast('Marcá primero los productos (casillas de la izquierda)', true);
  const m = modal('Imprimir etiquetas', `
    <p class="small muted" style="margin-bottom:.8rem">Indicá cuántas etiquetas de cada producto. Tamaño 62 × 30 mm (sirve para rollo de impresora térmica o para hoja A4 autoadhesiva).</p>
    <table class="tbl" style="margin-bottom:1rem"><tbody>${productos.map(p => `<tr><td>${esc(p.nombre)}<div class="small muted mono">${esc(p.codigo_barras)}</div></td>
      <td style="width:90px"><input class="input" type="number" min="0" value="${Math.max(1, p.es_servicio ? 1 : p.stock)}" data-n="${p.id}"></td></tr>`).join('')}</tbody></table>
    <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="conprecio" checked> Incluir precio</label>
    <h2 style="font-size:.9rem;margin:1rem 0 .5rem">Vista previa</h2><div class="label-grid" id="prev"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="print">Imprimir</button>`, { wide: true });
  const html = (prevOnly) => {
    const conPrecio = $('#conprecio', m.el).checked;
    let out = '';
    productos.forEach(p => {
      const n = prevOnly ? 1 : Math.max(0, +$(`[data-n="${p.id}"]`, m.el).value || 0);
      const bc = barcodeSVG(p.codigo_barras, { height: 38, width: 1.5, fontSize: 12 });
      for (let i = 0; i < n; i++) out += `<div class="etq"><div class="l-name">${esc(p.nombre)}</div>${bc}${conPrecio ? `<div class="l-price">${money(p.precio_venta)}</div>` : ''}</div>`;
    });
    return out;
  };
  const prev = () => $('#prev', m.el).innerHTML = html(true);
  $('#conprecio', m.el).onchange = prev; prev();
  $('#print', m.el).onclick = () => { printHTML(`<div class="label-grid">${html(false)}</div>`); };
}

// =====================================================================
// CLIENTES
// =====================================================================
ROUTES.clientes = async ({ id }) => {
  if (id) return fichaCliente(+id);
  const [clientes, ordenes, ventas] = await Promise.all([store.clientes(), store.ordenes(), store.ventas()]);
  view().innerHTML = `
  <div class="page-head"><h1>Clientes</h1><div class="actions"><button class="btn primary" id="nuevo">+ Nuevo cliente</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por nombre, teléfono, DNI/CUIT o email"></div></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>Teléfono</th><th>DNI / CUIT</th><th class="num">En taller</th><th>Última visita</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const ultima = c => {
    const f = [...ventas.filter(v => v.cliente_id === c.id).map(v => v.fecha), ...ordenes.filter(o => o.cliente_id === c.id).map(o => o.fecha_ingreso)].sort().pop();
    return f ? fdate(f) : '—';
  };
  const paint = t => {
    $('#rows').innerHTML = clientes.filter(c => matches(t, c.nombre, c.telefono, c.dni_cuit, c.email)).map(c => {
      const act = ordenes.filter(o => o.cliente_id === c.id && ACTIVAS(o)).length;
      return `<tr class="click" data-href="#/clientes/${c.id}"><td><b>${esc(c.nombre)}</b>${c.email ? `<div class="small muted">${esc(c.email)}</div>` : ''}</td><td>${esc(c.telefono)}</td><td>${esc(c.dni_cuit)}</td>
        <td class="num">${act ? `<span class="pill violet">${act}</span>` : '<span class="muted">—</span>'}</td><td>${ultima(c)}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Sin resultados</td></tr>';
    bindRowLinks();
  };
  $('#buscar').oninput = e => paint(e.target.value);
  $('#nuevo').onclick = () => clienteModal(null, c => go(`#/clientes/${c.id}`));
  paint('');
};

function clienteModal(c, onSaved) {
  const v = c || { nombre: '', telefono: '', dni_cuit: '', email: '', direccion: '', notas: '' };
  const m = modal(c ? 'Editar cliente' : 'Nuevo cliente', `
    <div class="field"><label>Nombre y apellido / Razón social *</label><input class="input" name="nombre" value="${esc(v.nombre)}"></div>
    <div class="row"><div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="telefono" value="${esc(v.telefono)}" placeholder="ej: 342 555-1234"></div>
      <div class="field"><label>DNI / CUIT</label><input class="input" name="dni_cuit" value="${esc(v.dni_cuit)}"></div></div>
    <div class="row"><div class="field"><label>Email</label><input class="input" name="email" type="email" value="${esc(v.email)}"></div>
      <div class="field"><label>Dirección</label><input class="input" name="direccion" value="${esc(v.direccion)}"></div></div>
    <div class="field"><label>Notas internas</label><textarea class="input" name="notas">${esc(v.notas)}</textarea></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (!f.nombre) return toast('El nombre es obligatorio', true);
    const r = await store.guardarCliente({ ...(c ? { id: c.id } : {}), ...f });
    m.close(); toast('Cliente guardado'); onSaved ? onSaved(r) : render();
  });
}

function equipoModal(clienteId, e, onSaved) {
  const v = e || { tipo: 'Notebook', marca: '', modelo: '', nro_serie: '', notas: '' };
  const m = modal(e ? 'Editar equipo' : 'Agregar equipo', equipoFields(v),
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    const r = await store.guardarEquipo({ ...(e ? { id: e.id } : {}), cliente_id: clienteId, ...f });
    m.close(); onSaved ? onSaved(r) : render();
  });
}
const equipoFields = (v, p = '') => `
  <div class="row"><div class="field"><label>Tipo</label><select class="input" name="${p}tipo">${TIPOS_EQUIPO.map(t => `<option ${t === v.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Marca</label><input class="input" name="${p}marca" value="${esc(v.marca)}"></div></div>
  <div class="row"><div class="field"><label>Modelo</label><input class="input" name="${p}modelo" value="${esc(v.modelo)}"></div>
    <div class="field"><label>N° de serie</label><input class="input" name="${p}nro_serie" value="${esc(v.nro_serie)}"></div></div>
  <div class="field"><label>Notas del equipo</label><input class="input" name="${p}notas" value="${esc(v.notas)}" placeholder="ej: color, stickers, golpes visibles"></div>`;

async function fichaCliente(id) {
  const [c, equipos, h] = await Promise.all([store.cliente(id), store.equipos(id), store.historialCliente(id)]);
  if (!c) { view().innerHTML = '<div class="empty">Cliente no encontrado</div>'; return; }
  const ventasOk = h.ventas.filter(v => !v.anulada);
  const totalCompras = ventasOk.reduce((s, v) => s + v.total, 0);
  const totalService = h.ordenes.reduce((s, o) => s + (o.total_cobrado || 0), 0);
  const eventos = [
    ...h.ventas.map(v => ({ fecha: v.fecha, tipo: 'venta', html: `<div class="what"><a href="#" data-venta="${v.id}">Compra #${v.numero}</a> · ${money(v.total)} ${v.anulada ? '<span class="pill red">Anulada</span>' : ''}</div>
      <div class="detail">${v.items.map(i => `${i.cantidad > 1 ? i.cantidad + '× ' : ''}${esc(i.descripcion)}`).join(' · ')}</div>` })),
    ...h.ordenes.map(o => ({ fecha: o.fecha_ingreso, tipo: 'service', html: `<div class="what"><a href="#/service/${o.id}">Service #${o.numero}</a> · ${esc([o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' '))} ${pill(o.estado)}</div>
      <div class="detail">Falla: ${esc(o.falla_reportada)}${o.trabajo_realizado ? `<br>Trabajo: ${esc(o.trabajo_realizado)}` : o.diagnostico ? `<br>Diagnóstico: ${esc(o.diagnostico)}` : ''}${o.total_cobrado ? `<br>Cobrado: ${money(o.total_cobrado)}` : ''}</div>` })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  view().innerHTML = `
  <div class="page-head"><div><a href="#/clientes" class="small muted">← Clientes</a><h1>${esc(c.nombre)}</h1></div>
    <div class="actions"><a class="btn" href="#/vender?cliente=${c.id}">Nueva venta</a><button class="btn primary" id="orden">Nueva orden de service</button></div></div>
  <div class="grid grid-4" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Cliente desde</div><div class="value" style="font-size:1.2rem">${fdate(c.created_at)}</div></div>
    <div class="card kpi"><div class="label">Compras</div><div class="value">${money(totalCompras)}</div><div class="sub">${ventasOk.length} compra(s)</div></div>
    <div class="card kpi"><div class="label">Services</div><div class="value">${h.ordenes.length}</div><div class="sub">${money(totalService)} cobrado</div></div>
    <div class="card kpi"><div class="label">En el taller ahora</div><div class="value">${h.ordenes.filter(ACTIVAS).length}</div></div>
  </div>
  <div class="split">
    <div class="card card-pad"><h2>Historial</h2>
      ${eventos.length ? `<div class="timeline">${eventos.map(e => `<div class="tl-item ${e.tipo}"><div class="when">${fdatetime(e.fecha)}</div>${e.html}</div>`).join('')}</div>` : '<div class="empty">Sin movimientos todavía.</div>'}
    </div>
    <div class="grid">
      <div class="card card-pad"><h2>Datos <button class="btn sm" id="editar">Editar</button></h2>
        <dl class="kv"><dt>Teléfono</dt><dd>${esc(c.telefono) || '—'} ${c.telefono ? `<a class="small" target="_blank" rel="noopener" href="${waLink(c.telefono, `Hola ${c.nombre.split(' ')[0]}, te escribimos de GScom.`)}">WhatsApp</a>` : ''}</dd>
        <dt>DNI / CUIT</dt><dd>${esc(c.dni_cuit) || '—'}</dd><dt>Email</dt><dd>${esc(c.email) || '—'}</dd><dt>Dirección</dt><dd>${esc(c.direccion) || '—'}</dd></dl>
        ${c.notas ? `<div class="small" style="margin-top:.8rem;background:var(--warn-soft);padding:.6rem .8rem;border-radius:8px">📝 ${esc(c.notas)}</div>` : ''}</div>
      <div class="card card-pad"><h2>Equipos <button class="btn sm" id="add-eq">+ Agregar</button></h2>
        ${equipos.map(e => `<div class="equipo"><b>${esc(e.tipo)}</b> ${esc(e.marca)} ${esc(e.modelo)}
          ${e.nro_serie ? `<div class="small muted mono">S/N ${esc(e.nro_serie)}</div>` : ''}${e.notas ? `<div class="small muted">${esc(e.notas)}</div>` : ''}
          <div class="small muted">${h.ordenes.filter(o => o.equipo_id === e.id).length} service(s)</div></div>`).join('') || '<div class="muted small">Sin equipos registrados.</div>'}</div>
    </div>
  </div>`;
  $('#editar').onclick = () => clienteModal(c);
  $('#add-eq').onclick = () => equipoModal(c.id);
  $('#orden').onclick = () => nuevaOrdenModal(c.id);
  $$('[data-venta]').forEach(a => a.onclick = e => { e.preventDefault(); ventaModal(+a.dataset.venta); });
}

// =====================================================================
// SERVICE TÉCNICO
// =====================================================================
ROUTES.service = async ({ id, q }) => {
  if (id) return detalleOrden(+id);
  const ordenes = await store.ordenes();
  let filtro = q.get('estado') || 'activas', texto = '';
  view().innerHTML = `
  <div class="page-head"><h1>Service técnico</h1><div class="actions"><button class="btn primary" id="nueva">+ Nueva orden</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por N° de orden, cliente, equipo o falla"></div></div>
  <div class="chips" id="chips"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Ingreso</th><th>Cliente</th><th>Equipo</th><th>Falla</th><th>Estado</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const opts = [['activas', 'En taller', ordenes.filter(ACTIVAS).length], ...ESTADOS.map(e => [e.id, e.label, ordenes.filter(o => o.estado === e.id).length]), ['todas', 'Todas', ordenes.length]];
  const paint = () => {
    $('#chips').innerHTML = opts.map(([k, l, n]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-k="${k}">${esc(l)}<span class="count">${n}</span></button>`).join('');
    $$('#chips .chip').forEach(c => c.onclick = () => { filtro = c.dataset.k; paint(); });
    const l = ordenes.filter(o => (filtro === 'todas' || (filtro === 'activas' ? ACTIVAS(o) : o.estado === filtro))
      && (String(o.numero) === texto.replace('#', '') || matches(texto, o.cliente?.nombre, o.equipo?.marca, o.equipo?.modelo, o.equipo?.tipo, o.falla_reportada)));
    $('#rows').innerHTML = l.map(o => `<tr class="click" data-href="#/service/${o.id}"><td class="mono"><b>#${o.numero}</b></td>
      <td class="nowrap">${fdate(o.fecha_ingreso)}<div class="small muted">${daysSince(o.fecha_ingreso) === 0 ? 'hoy' : `hace ${daysSince(o.fecha_ingreso)} d`}</div></td>
      <td>${esc(o.cliente?.nombre)}</td><td>${esc([o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' '))}</td>
      <td class="small" style="max-width:280px">${esc(o.falla_reportada)}</td><td>${pill(o.estado)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">No hay órdenes en este estado.</td></tr>';
    bindRowLinks();
  };
  $('#buscar').oninput = e => { texto = e.target.value.trim(); paint(); };
  $('#nueva').onclick = () => nuevaOrdenModal();
  paint();
};

async function nuevaOrdenModal(clienteId = null) {
  const clientes = await store.clientes();
  const m = modal('Nueva orden de service', `
    <div class="field"><label>Cliente *</label><select class="input" name="cliente_id"><option value="">Elegí un cliente…</option><option value="__nuevo">+ Cliente nuevo</option>
      ${clientes.map(c => `<option value="${c.id}" ${c.id === clienteId ? 'selected' : ''}>${esc(c.nombre)}${c.telefono ? ' — ' + esc(c.telefono) : ''}</option>`).join('')}</select></div>
    <div id="cli-nuevo" hidden class="card card-pad" style="background:#fafbfc;margin-bottom:.8rem">
      <div class="row"><div class="field"><label>Nombre y apellido *</label><input class="input" name="c_nombre"></div>
      <div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="c_telefono"></div></div>
      <div class="field"><label>DNI / CUIT</label><input class="input" name="c_dni_cuit"></div></div>
    <div class="field"><label>Equipo *</label><select class="input" name="equipo_id"></select></div>
    <div id="eq-nuevo" hidden class="card card-pad" style="background:#fafbfc;margin-bottom:.8rem">${equipoFields({ tipo: 'Notebook', marca: '', modelo: '', nro_serie: '', notas: '' }, 'e_')}</div>
    <div class="field"><label>Falla reportada por el cliente *</label><textarea class="input" name="falla_reportada" placeholder="Lo que cuenta el cliente, con sus palabras"></textarea></div>
    <div class="row"><div class="field"><label>Accesorios que deja</label><input class="input" name="accesorios" placeholder="ej: cargador, funda"></div>
      <div class="field"><label>Contraseña / patrón del equipo</label><input class="input" name="contrasena_equipo" placeholder="(opcional, uso interno)"></div></div>
    <div class="row"><div class="field"><label>Fecha estimada</label><input class="input" type="date" name="fecha_estimada"></div>
      <div class="field"><label>Técnico</label><input class="input" name="tecnico"></div></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Crear orden</button>`);
  const selC = $('[name=cliente_id]', m.el), selE = $('[name=equipo_id]', m.el);
  const onCliente = async () => {
    $('#cli-nuevo', m.el).hidden = selC.value !== '__nuevo';
    const eqs = selC.value && selC.value !== '__nuevo' ? await store.equipos(+selC.value) : [];
    selE.innerHTML = eqs.map(e => `<option value="${e.id}">${esc([e.tipo, e.marca, e.modelo].filter(Boolean).join(' '))}${e.nro_serie ? ' · S/N ' + esc(e.nro_serie) : ''}</option>`).join('') + '<option value="__nuevo">+ Equipo nuevo</option>';
    if (!eqs.length) selE.value = '__nuevo';
    $('#eq-nuevo', m.el).hidden = selE.value !== '__nuevo';
  };
  selC.onchange = onCliente; selE.onchange = () => $('#eq-nuevo', m.el).hidden = selE.value !== '__nuevo';
  onCliente();
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (!f.cliente_id) return toast('Elegí el cliente', true);
    if (f.cliente_id === '__nuevo' && !f.c_nombre) return toast('Completá el nombre del cliente nuevo', true);
    if (!f.falla_reportada) return toast('Describí la falla reportada', true);
    let cid = +f.cliente_id;
    if (f.cliente_id === '__nuevo') cid = (await store.guardarCliente({ nombre: f.c_nombre, telefono: f.c_telefono, dni_cuit: f.c_dni_cuit })).id;
    let eid = +f.equipo_id;
    if (f.equipo_id === '__nuevo') eid = (await store.guardarEquipo({ cliente_id: cid, tipo: f.e_tipo, marca: f.e_marca, modelo: f.e_modelo, nro_serie: f.e_nro_serie, notas: f.e_notas })).id;
    const o = await store.crearOrden({ cliente_id: cid, equipo_id: eid, falla_reportada: f.falla_reportada, accesorios: f.accesorios,
      contrasena_equipo: f.contrasena_equipo, fecha_estimada: f.fecha_estimada || null, tecnico: f.tecnico });
    m.close(); toast(`Orden #${o.numero} creada`);
    go(`#/service/${o.id}?nueva=1`);
  });
}

const FLUJO = ['recibido', 'diagnostico', 'presupuesto', 'reparacion', 'listo', 'entregado'];
function stepper(estado) {
  const pos = estado === 'repuesto' ? FLUJO.indexOf('reparacion') : estado === 'sin_reparacion' ? FLUJO.indexOf('listo') : FLUJO.indexOf(estado);
  return `<div class="stepper">${FLUJO.map((s, i) => {
    let label = estadoInfo(s).label;
    if (i === pos && estado === 'repuesto') label = 'Esperando repuesto';
    if (i === pos && estado === 'sin_reparacion') label = 'Sin reparación';
    return `<div class="step ${i < pos ? 'done' : ''} ${i === pos ? 'current' : ''}">${esc(label)}</div>`;
  }).join('')}</div>`;
}

async function detalleOrden(id) {
  const [o, productos, n] = await Promise.all([store.orden(id), store.productos(), store.negocio()]);
  if (!o) { view().innerHTML = '<div class="empty">Orden no encontrada</div>'; return; }
  const url = trackingURL(o.token);
  const items = o.items.slice();
  const eq = [o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' ');
  const cerrada = o.estado === 'entregado';

  view().innerHTML = `
  <div class="page-head"><div><a href="#/service" class="small muted">← Service</a><h1>Orden #${o.numero} ${pill(o.estado)}</h1></div>
    <div class="actions"><button class="btn" id="imp">Imprimir comprobante</button>${cerrada ? '' : '<button class="btn ok" id="entregar">Entregar y cobrar</button>'}</div></div>
  <div class="card card-pad" style="margin-bottom:1rem">${stepper(o.estado)}</div>
  <div class="split">
    <div class="grid">
      <div class="card card-pad"><h2>Equipo y cliente</h2>
        <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${o.cliente.id}">${esc(o.cliente.nombre)}</a> · ${esc(o.cliente.telefono)}</dd>
        <dt>Equipo</dt><dd>${esc(eq)}${o.equipo?.nro_serie ? ` <span class="small muted mono">S/N ${esc(o.equipo.nro_serie)}</span>` : ''}</dd>
        <dt>Ingreso</dt><dd>${fdatetime(o.fecha_ingreso)}</dd><dt>Fecha estimada</dt><dd>${fdate(o.fecha_estimada)}</dd>
        <dt>Falla reportada</dt><dd>${esc(o.falla_reportada)}</dd><dt>Accesorios</dt><dd>${esc(o.accesorios) || '—'}</dd>
        <dt>Contraseña</dt><dd class="mono">${esc(o.contrasena_equipo) || '—'}</dd><dt>Técnico</dt><dd>${esc(o.tecnico) || '—'}</dd>
        ${o.fecha_entrega ? `<dt>Entregado</dt><dd>${fdatetime(o.fecha_entrega)} · ${money(o.total_cobrado)}</dd>` : ''}</dl></div>
      <div class="card card-pad"><h2>Diagnóstico y presupuesto</h2>
        <div class="field"><label>Diagnóstico técnico</label><textarea class="input" id="diag">${esc(o.diagnostico)}</textarea></div>
        <div class="field"><label>Trabajo realizado</label><textarea class="input" id="trab">${esc(o.trabajo_realizado)}</textarea></div>
        <div class="row"><div class="field"><label>Presupuesto ($)</label><input class="input" type="number" step="any" min="0" id="pres" value="${o.presupuesto ?? ''}"></div>
          <div class="field"><label>¿Aprobado por el cliente?</label><select class="input" id="aprob"><option value="">Pendiente</option><option value="si" ${o.presupuesto_aprobado === true ? 'selected' : ''}>Sí</option><option value="no" ${o.presupuesto_aprobado === false ? 'selected' : ''}>No</option></select></div></div>
        <div class="field"><label>Notas internas (el cliente no las ve)</label><textarea class="input" id="notas">${esc(o.notas_internas)}</textarea></div>
        <button class="btn" id="guardar-diag">Guardar</button></div>
      <div class="card card-pad"><h2>Repuestos y mano de obra</h2>
        <div class="search" style="position:relative;margin-bottom:.6rem"><input class="input" id="buscar-rep" placeholder="Agregar producto o mano de obra (buscar o escanear)" ${cerrada ? 'disabled' : ''}><div class="suggest" id="sug" hidden></div></div>
        <div id="items"></div>
        <p class="small muted" style="margin-top:.5rem">Los repuestos se descuentan del stock al entregar el equipo.</p></div>
    </div>
    <div class="grid">
      ${cerrada ? '' : `<div class="card card-pad"><h2>Cambiar estado</h2>
        <div class="field"><select class="input" id="nuevo-estado">${ESTADOS.filter(e => e.id !== 'entregado').map(e => `<option value="${e.id}" ${e.id === o.estado ? 'selected' : ''}>${e.label}</option>`).join('')}</select></div>
        <div class="field"><label>Mensaje para el cliente (lo ve en el seguimiento)</label><textarea class="input" id="coment" placeholder="ej: Presupuesto: cambio de pantalla $85.000. Demora 3 días."></textarea></div>
        <label class="small" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.8rem"><input type="checkbox" id="avisar" checked> Avisar por WhatsApp al guardar</label>
        <button class="btn primary block" id="cambiar">Actualizar estado</button></div>`}
      <div class="card card-pad"><h2>Seguimiento del cliente</h2>
        <div style="display:flex;gap:1rem;align-items:center"><div style="width:110px;flex-shrink:0">${qrSVG(url)}</div>
        <div class="small"><p style="margin-bottom:.5rem">El cliente escanea este QR (va impreso en el comprobante) o abre el link para ver el estado de su equipo, sin usuario ni contraseña.</p>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap"><button class="btn sm" id="copiar">Copiar link</button><a class="btn sm" href="${url}" target="_blank" rel="noopener">Ver como cliente</a>
        ${o.cliente.telefono ? `<a class="btn sm wa" id="wa" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}</div></div></div></div>
      <div class="card card-pad"><h2>Historial de estados</h2><div class="timeline">
        ${o.historial.slice().reverse().map(h => `<div class="tl-item"><div class="when">${fdatetime(h.created_at)}</div><div class="what">${pill(h.estado)}</div>${h.comentario ? `<div class="detail">${esc(h.comentario)}</div>` : ''}</div>`).join('')}</div></div>
    </div>
  </div>`;

  const msgWA = (estado, coment) => {
    const e = estadoInfo(estado);
    return `Hola ${o.cliente.nombre.split(' ')[0]}! Te escribimos de ${n.nombre} por tu ${eq} (orden #${o.numero}).\n\nEstado: *${e.label}*\n${coment || e.cliente}\n\nPodés seguirlo acá: ${url}`;
  };
  const wa = $('#wa'); if (wa) wa.href = waLink(o.cliente.telefono, msgWA(o.estado, ''));
  $('#copiar').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { prompt('Copiá el link:', url); } };
  $('#imp').onclick = () => imprimirOrden(o, n, url);

  $('#guardar-diag').onclick = () => run(async () => {
    const ap = $('#aprob').value;
    await store.actualizarOrden(id, { diagnostico: $('#diag').value.trim(), trabajo_realizado: $('#trab').value.trim(),
      presupuesto: $('#pres').value === '' ? null : +$('#pres').value, presupuesto_aprobado: ap === '' ? null : ap === 'si', notas_internas: $('#notas').value.trim() });
    toast('Guardado');
  });

  const cambiar = $('#cambiar');
  if (cambiar) cambiar.onclick = () => run(async () => {
    const estado = $('#nuevo-estado').value, coment = $('#coment').value.trim();
    if (estado === o.estado && !coment) return toast('Elegí un estado distinto o escribí un mensaje', true);
    await store.cambiarEstadoOrden(id, estado, coment); // mismo estado + mensaje = novedad para el cliente
    if ($('#avisar').checked && o.cliente.telefono) window.open(waLink(o.cliente.telefono, msgWA(estado, coment)), '_blank', 'noopener');
    toast('Estado actualizado'); render();
  });

  // Ítems (repuestos / mano de obra)
  const paintItems = () => {
    const total = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    $('#items').innerHTML = items.length ? `<table class="tbl"><tbody>${items.map((i, k) => `<tr><td>${esc(i.descripcion)}</td>
      <td style="width:70px"><input class="input" data-c="${k}" value="${i.cantidad}" ${cerrada ? 'disabled' : ''}></td>
      <td style="width:120px"><input class="input" data-p="${k}" value="${i.precio_unitario}" ${cerrada ? 'disabled' : ''}></td>
      <td class="num">${money(i.cantidad * i.precio_unitario)}</td><td style="width:28px">${cerrada ? '' : `<button class="x" data-d="${k}">×</button>`}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(total)}</b></td><td></td></tr></tbody></table>` : '<div class="muted small">Sin ítems cargados.</div>';
    $$('[data-c]').forEach(inp => inp.onchange = () => { items[+inp.dataset.c].cantidad = +inp.value || 1; saveItems(); });
    $$('[data-p]').forEach(inp => inp.onchange = () => { items[+inp.dataset.p].precio_unitario = +inp.value || 0; saveItems(); });
    $$('[data-d]').forEach(b => b.onclick = () => { items.splice(+b.dataset.d, 1); saveItems(); });
  };
  const saveItems = () => run(async () => { await store.guardarItemsOrden(id, items); paintItems(); });
  paintItems();
  const br = $('#buscar-rep'), sug = $('#sug');
  br.oninput = () => {
    const t = br.value.trim(); if (!t) { sug.hidden = true; return; }
    const r = productos.filter(p => p.codigo_barras === t || matches(t, p.nombre, p.codigo_barras)).slice(0, 8);
    sug.hidden = false;
    sug.innerHTML = r.map(p => `<div data-id="${p.id}"><span>${esc(p.nombre)}</span><span>${money(p.precio_venta)}</span></div>`).join('') || '<div class="muted">Sin resultados</div>';
    $$('[data-id]', sug).forEach(d => d.onmousedown = e => {
      e.preventDefault(); const p = productos.find(x => x.id === +d.dataset.id);
      items.push({ producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: p.precio_venta });
      br.value = ''; sug.hidden = true; saveItems();
    });
  };
  br.onblur = () => setTimeout(() => sug.hidden = true, 150);

  const ent = $('#entregar');
  if (ent) ent.onclick = () => {
    const totalItems = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const sugerido = totalItems || o.presupuesto || 0;
    let forma = 'Efectivo';
    const m = modal(`Entregar orden #${o.numero}`, `
      <div class="field"><label>Total a cobrar</label><input class="input" type="number" step="any" min="0" id="tot" value="${sugerido}"></div>
      <p class="small muted" style="margin:-.4rem 0 .8rem">${totalItems ? 'Sugerido: suma de repuestos y mano de obra.' : o.presupuesto ? 'Sugerido: presupuesto.' : 'Poné 0 si no se cobra (garantía, sin reparación).'}</p>
      <div class="field"><label>Forma de pago</label><div class="pay-opts">${FORMAS_PAGO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div></div>
      <div class="field"><label>Mensaje final para el cliente (opcional)</label><input class="input" id="msg" placeholder="ej: Garantía de ${n.garantia_dias} días sobre el trabajo realizado."></div>`,
      `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="ok">Confirmar entrega</button>`);
    $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); });
    $('#ok', m.el).onclick = () => run(async () => {
      await store.entregarOrden(id, { total: +$('#tot', m.el).value || 0, forma_pago: forma, comentario: $('#msg', m.el).value.trim() });
      m.close(); toast('Orden entregada'); render();
    });
  };

  if (parseHash().q.get('nueva')) {
    history.replaceState(null, '', `#/service/${id}`);
    const m = modal(`Orden #${o.numero} creada`, `<p>¿Imprimimos el comprobante de ingreso para el cliente? Incluye el código QR para seguir el estado del equipo.</p>`,
      `<button class="btn" data-close>Ahora no</button>${o.cliente.telefono ? `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(o.cliente.telefono, msgWA('recibido', ''))}">Enviar link por WhatsApp</a>` : ''}<button class="btn primary" id="p">Imprimir</button>`);
    $('#p', m.el).onclick = () => { m.close(); imprimirOrden(o, n, url); };
  }
}

function imprimirOrden(o, n, url) {
  const eq = [o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' ');
  printHTML(`<div class="ticket">
    <div class="c big">${esc(n.nombre)}</div><div class="c">Service técnico<br>${esc(n.direccion)}<br>${esc(n.telefono)}</div><hr>
    <div class="c big">ORDEN N° ${o.numero}</div><div class="c">${fdatetime(o.fecha_ingreso)}</div><hr>
    <div>Cliente: ${esc(o.cliente.nombre)}<br>Tel: ${esc(o.cliente.telefono)}</div><hr>
    <div>Equipo: ${esc(eq)}${o.equipo?.nro_serie ? `<br>S/N: ${esc(o.equipo.nro_serie)}` : ''}<br>Accesorios: ${esc(o.accesorios) || 'ninguno'}</div>
    <div style="margin-top:1mm">Falla: ${esc(o.falla_reportada)}</div>
    ${o.fecha_estimada ? `<div>Fecha estimada: ${fdate(o.fecha_estimada)}</div>` : ''}<hr>
    <div class="c">Seguí el estado de tu equipo:</div><div class="c qr" style="margin:2mm 0">${qrSVG(url)}</div>
    <div class="c" style="font-size:7pt;word-break:break-all">${esc(url)}</div><hr>
    <div style="font-size:7.5pt">${esc(n.pie_comprobante)}</div>
    <div style="margin-top:8mm">Firma cliente: ______________________</div></div>`);
}

// =====================================================================
// CAJA
// =====================================================================
ROUTES.caja = async ({ q }) => {
  const dia = q.get('dia') || new Date().toLocaleDateString('sv');
  const [movs, cierres] = await Promise.all([store.cajaMovimientos(), store.cierresCaja()]);
  const delDia = movs.filter(m => new Date(m.fecha).toLocaleDateString('sv') === dia);
  const neto = f => delDia.filter(m => !f || m.forma_pago === f).reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0);
  const ingresos = delDia.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const egresos = delDia.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);

  view().innerHTML = `
  <div class="page-head"><h1>Caja</h1><div class="actions"><input class="input" type="date" id="dia" value="${dia}" style="width:auto">
    <button class="btn" id="ing">+ Ingreso</button><button class="btn" id="egr">− Egreso</button><button class="btn primary" id="cerrar">Cerrar caja</button></div></div>
  <div class="grid grid-4" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Ingresos</div><div class="value" style="color:var(--ok)">${money(ingresos)}</div></div>
    <div class="card kpi"><div class="label">Egresos</div><div class="value" style="color:var(--bad)">${money(egresos)}</div></div>
    <div class="card kpi"><div class="label">Neto del día</div><div class="value">${money(ingresos - egresos)}</div></div>
    <div class="card kpi"><div class="label">Efectivo (neto)</div><div class="value">${money(neto('Efectivo'))}</div><div class="sub">lo que debería haber en el cajón</div></div>
  </div>
  <div class="split">
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Hora</th><th>Concepto</th><th>Forma de pago</th><th class="num">Monto</th></tr></thead><tbody>
      ${delDia.map(m => `<tr ${m.venta_id ? `class="click" data-venta="${m.venta_id}"` : m.orden_id ? `class="click" data-href="#/service/${m.orden_id}"` : ''}><td>${new Date(m.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(m.concepto)}</td><td>${esc(m.forma_pago)}</td>
        <td class="num" style="color:${m.tipo === 'ingreso' ? 'var(--ok)' : 'var(--bad)'}"><b>${m.tipo === 'ingreso' ? '+' : '−'}${money(m.monto)}</b></td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">Sin movimientos este día.</td></tr>'}</tbody></table></div>
    <div class="grid">
      <div class="card card-pad"><h2>Por forma de pago</h2><table class="tbl"><tbody>${FORMAS_PAGO.map(f => `<tr><td>${f}</td><td class="num">${money(neto(f))}</td></tr>`).join('')}</tbody></table></div>
      <div class="card card-pad"><h2>Últimos cierres</h2>${cierres.slice(0, 6).map(c => `<div class="small" style="padding:.4rem 0;border-bottom:1px solid var(--line)">${fdatetime(c.fecha)} · contado ${money(c.efectivo_contado)}
        <span class="pill ${Math.abs(c.diferencia) < 1 ? 'green' : 'red'}" style="float:right">${c.diferencia >= 0 ? '+' : ''}${money(c.diferencia)}</span></div>`).join('') || '<div class="muted small">Todavía no hay cierres.</div>'}</div>
    </div>
  </div>`;
  $('#dia').onchange = e => go(`#/caja?dia=${e.target.value}`);
  const movModal = tipo => {
    const m = modal(tipo === 'ingreso' ? 'Ingreso de caja' : 'Egreso de caja', `
      <div class="field"><label>Concepto</label><input class="input" name="concepto" placeholder="${tipo === 'ingreso' ? 'ej: Fondo inicial' : 'ej: Pago de flete, retiro'}"></div>
      <div class="row"><div class="field"><label>Monto</label><input class="input" name="monto" type="number" step="any" min="0"></div>
      <div class="field"><label>Forma de pago</label><select class="input" name="forma_pago">${FORMAS_PAGO.map(f => `<option>${f}</option>`).join('')}</select></div></div>`,
      `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Registrar</button>`);
    $('#ok', m.el).onclick = () => run(async () => {
      const f = formData(m.el); if (!f.concepto || !(+f.monto > 0)) return toast('Completá concepto y monto', true);
      await store.agregarMovimientoCaja({ tipo, concepto: f.concepto, monto: +f.monto, forma_pago: f.forma_pago }); m.close(); render();
    });
  };
  $('#ing').onclick = () => movModal('ingreso');
  $('#egr').onclick = () => movModal('egreso');
  $('#cerrar').onclick = () => {
    const esperado = neto('Efectivo');
    const m = modal('Cierre de caja', `<dl class="kv" style="margin-bottom:1rem"><dt>Efectivo esperado</dt><dd><b>${money(esperado)}</b></dd></dl>
      <div class="field"><label>Efectivo contado en el cajón</label><input class="input" id="contado" type="number" step="any" min="0"></div>
      <div class="field"><label>Diferencia</label><input class="input" id="dif" readonly></div>
      <div class="field"><label>Notas</label><input class="input" id="notas"></div>`,
      `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar cierre</button>`);
    $('#contado', m.el).oninput = e => $('#dif', m.el).value = money((+e.target.value || 0) - esperado);
    $('#ok', m.el).onclick = () => run(async () => {
      const contado = +$('#contado', m.el).value; if ($('#contado', m.el).value === '') return toast('Ingresá el efectivo contado', true);
      await store.cerrarCaja({ efectivo_esperado: esperado, efectivo_contado: contado, diferencia: contado - esperado, notas: $('#notas', m.el).value }); m.close(); toast('Cierre guardado'); render();
    });
  };
  bindRowLinks();
};

// =====================================================================
// COMPRAS (ingreso de mercadería) Y PROVEEDORES
// =====================================================================
ROUTES.compras = async () => {
  const [compras, proveedores, productos] = await Promise.all([store.compras(), store.proveedores(), store.productos()]);
  const provName = id => proveedores.find(p => p.id === id)?.nombre || '—';
  view().innerHTML = `
  <div class="page-head"><h1>Compras y proveedores</h1><div class="actions"><button class="btn" id="prov">+ Proveedor</button><button class="btn primary" id="nueva">Ingresar mercadería</button></div></div>
  <div class="split">
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Ítems</th><th class="num">Total</th></tr></thead><tbody>
      ${compras.map(c => `<tr><td>${fdate(c.fecha)}</td><td>${esc(provName(c.proveedor_id))}</td><td>${esc(c.nro_comprobante) || '—'}</td>
        <td class="small">${c.items.map(i => `${i.cantidad}× ${esc(productos.find(p => p.id === i.producto_id)?.nombre || '')}`).join(', ')}</td><td class="num">${money(c.total)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Todavía no se registraron compras. Usá "Ingresar mercadería" cuando llegue un pedido: suma el stock y actualiza el costo.</td></tr>'}</tbody></table></div>
    <div class="card card-pad"><h2>Proveedores</h2>${proveedores.map(p => `<div class="equipo"><b>${esc(p.nombre)}</b><div class="small muted">${esc(p.cuit)} ${p.telefono ? '· ' + esc(p.telefono) : ''}</div></div>`).join('') || '<div class="muted small">Sin proveedores.</div>'}</div>
  </div>`;
  $('#prov').onclick = () => {
    const m = modal('Nuevo proveedor', `<div class="field"><label>Nombre *</label><input class="input" name="nombre"></div>
      <div class="row"><div class="field"><label>CUIT</label><input class="input" name="cuit"></div><div class="field"><label>Teléfono</label><input class="input" name="telefono"></div></div>
      <div class="field"><label>Email</label><input class="input" name="email"></div>`, `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
    $('#ok', m.el).onclick = () => run(async () => { const f = formData(m.el); if (!f.nombre) return toast('Falta el nombre', true); await store.guardarProveedor(f); m.close(); render(); });
  };
  $('#nueva').onclick = () => {
    const items = [];
    const m = modal('Ingresar mercadería', `
      <div class="row"><div class="field"><label>Proveedor</label><select class="input" name="proveedor_id"><option value="">—</option>${proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="field"><label>N° de factura / remito</label><input class="input" name="nro_comprobante"></div></div>
      <div class="search" style="position:relative;margin-bottom:.6rem"><input class="input" id="b" placeholder="Escaneá o buscá el producto"><div class="suggest" id="s" hidden></div></div>
      <div id="its"></div>`, `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Registrar compra</button>`, { wide: true });
    const paint = () => {
      $('#its', m.el).innerHTML = items.length ? `<table class="tbl"><thead><tr><th>Producto</th><th>Cantidad</th><th>Costo unitario</th><th class="num">Subtotal</th><th></th></tr></thead><tbody>
        ${items.map((i, k) => `<tr><td>${esc(i.nombre)}</td><td style="width:90px"><input class="input" data-c="${k}" value="${i.cantidad}"></td><td style="width:130px"><input class="input" data-p="${k}" value="${i.costo_unitario}"></td>
        <td class="num">${money(i.cantidad * i.costo_unitario)}</td><td><button class="x" data-d="${k}">×</button></td></tr>`).join('')}
        <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0))}</b></td><td></td></tr></tbody></table>` : '<div class="muted small">Agregá los productos que llegaron.</div>';
      $$('[data-c]', m.el).forEach(i => i.onchange = () => { items[+i.dataset.c].cantidad = +i.value || 1; paint(); });
      $$('[data-p]', m.el).forEach(i => i.onchange = () => { items[+i.dataset.p].costo_unitario = +i.value || 0; paint(); });
      $$('[data-d]', m.el).forEach(b => b.onclick = () => { items.splice(+b.dataset.d, 1); paint(); });
    };
    paint();
    const b = $('#b', m.el), s = $('#s', m.el);
    const addP = p => { const ex = items.find(i => i.producto_id === p.id); ex ? ex.cantidad++ : items.push({ producto_id: p.id, nombre: p.nombre, cantidad: 1, costo_unitario: p.precio_costo }); b.value = ''; s.hidden = true; paint(); b.focus(); };
    b.oninput = () => {
      const t = b.value.trim(); if (!t) { s.hidden = true; return; }
      const r = productos.filter(p => !p.es_servicio && (p.codigo_barras === t || matches(t, p.nombre, p.codigo_barras))).slice(0, 8);
      s.hidden = false; s.innerHTML = r.map(p => `<div data-id="${p.id}"><span>${esc(p.nombre)}</span><span class="muted">stock ${p.stock}</span></div>`).join('') || '<div class="muted">Sin resultados — crealo primero en Productos</div>';
      $$('[data-id]', s).forEach(d => d.onmousedown = e => { e.preventDefault(); addP(productos.find(x => x.id === +d.dataset.id)); });
    };
    b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const p = productos.find(x => x.codigo_barras === b.value.trim()); if (p) addP(p); } };
    $('#ok', m.el).onclick = () => run(async () => {
      if (!items.length) return toast('No agregaste productos', true);
      const f = formData(m.el);
      await store.registrarCompra({ proveedor_id: f.proveedor_id ? +f.proveedor_id : null, nro_comprobante: f.nro_comprobante, items: items.map(({ producto_id, cantidad, costo_unitario }) => ({ producto_id, cantidad, costo_unitario })) });
      m.close(); toast('Compra registrada · stock actualizado'); render();
    });
  };
};

// =====================================================================
// REPORTES
// =====================================================================
ROUTES.reportes = async ({ q }) => {
  const dias = +(q.get('dias') || 30);
  const [ventas, ordenes, productos] = await Promise.all([store.ventas(), store.ordenes(), store.productos()]);
  const desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - (dias - 1));
  const vs = ventas.filter(v => !v.anulada && new Date(v.fecha) >= desde);
  const detalle = await store.itemsVendidos(desde.toISOString());
  const total = vs.reduce((s, v) => s + v.total, 0);
  const costo = detalle.reduce((s, i) => s + i.cantidad * (productos.find(p => p.id === i.producto_id)?.precio_costo || 0), 0);
  const top = Object.values(detalle.reduce((acc, i) => { const k = i.descripcion; acc[k] ??= { nombre: k, cant: 0, total: 0 }; acc[k].cant += i.cantidad; acc[k].total += i.subtotal; return acc; }, {})).sort((a, b) => b.total - a.total).slice(0, 10);
  const porPago = FORMAS_PAGO.map(f => [f, vs.filter(v => v.forma_pago === f).reduce((s, v) => s + v.total, 0)]);
  const maxPago = Math.max(1, ...porPago.map(x => x[1]));
  const ingresadas = ordenes.filter(o => new Date(o.fecha_ingreso) >= desde);
  const entregadas = ordenes.filter(o => o.fecha_entrega && new Date(o.fecha_entrega) >= desde);
  const factService = entregadas.reduce((s, o) => s + (o.total_cobrado || 0), 0);
  const demora = entregadas.length ? entregadas.reduce((s, o) => s + (new Date(o.fecha_entrega) - new Date(o.fecha_ingreso)) / 86400000, 0) / entregadas.length : 0;

  view().innerHTML = `
  <div class="page-head"><h1>Reportes</h1><div class="actions">${[7, 30, 90, 365].map(d => `<a class="chip ${d === dias ? 'active' : ''}" href="#/reportes?dias=${d}">${d === 365 ? 'Último año' : `Últimos ${d} días`}</a>`).join('')}</div></div>
  <div class="grid grid-4" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Ventas</div><div class="value">${money(total)}</div><div class="sub">${vs.length} ventas · ticket promedio ${money(vs.length ? total / vs.length : 0)}</div></div>
    <div class="card kpi"><div class="label">Ganancia bruta estimada</div><div class="value">${money(total - costo)}</div><div class="sub">venta − costo de lo vendido</div></div>
    <div class="card kpi"><div class="label">Service cobrado</div><div class="value">${money(factService)}</div><div class="sub">${entregadas.length} entregadas · ${ingresadas.length} ingresadas</div></div>
    <div class="card kpi"><div class="label">Demora promedio</div><div class="value">${demora.toFixed(1)} d</div><div class="sub">del ingreso a la entrega</div></div>
  </div>
  <div class="grid grid-2">
    <div class="card card-pad"><h2>Productos más vendidos</h2><table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Total</th></tr></thead><tbody>
      ${top.map(t => `<tr><td>${esc(t.nombre)}</td><td class="num">${t.cant}</td><td class="num">${money(t.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sin ventas en el período.</td></tr>'}</tbody></table></div>
    <div class="card card-pad"><h2>Ventas por forma de pago</h2>
      ${porPago.map(([f, v]) => `<div style="margin-bottom:.7rem"><div class="row small"><span>${f}</span><span class="right">${money(v)}</span></div>
        <div style="height:8px;background:#eef0f3;border-radius:4px;margin-top:.25rem"><div style="height:100%;width:${(v / maxPago * 100).toFixed(1)}%;background:var(--accent);border-radius:4px"></div></div></div>`).join('')}</div>
  </div>`;
};

// =====================================================================
// AJUSTES
// =====================================================================
ROUTES.ajustes = async () => {
  const n = await store.negocio();
  const angosto = store.modo !== 'demo';
  view().innerHTML = `
  <div ${angosto ? 'style="max-width:760px;margin:0 auto"' : ''}>
  <div class="page-head"><h1>Ajustes</h1></div>
  <div ${angosto ? '' : 'class="split"'}>
    <div class="card card-pad"><h2>Datos del negocio</h2><p class="small muted" style="margin-bottom:1rem">Aparecen en los comprobantes y en la página de seguimiento que ve el cliente.</p>
      <div class="field"><label>Nombre</label><input class="input" name="nombre" value="${esc(n.nombre)}"></div>
      <div class="row"><div class="field"><label>Dirección</label><input class="input" name="direccion" value="${esc(n.direccion)}"></div>
        <div class="field"><label>Teléfono</label><input class="input" name="telefono" value="${esc(n.telefono)}"></div></div>
      <div class="row"><div class="field"><label>WhatsApp (con código de país, ej: 5493425550000)</label><input class="input" name="whatsapp" value="${esc(n.whatsapp)}"></div>
        <div class="field"><label>Email</label><input class="input" name="email" value="${esc(n.email)}"></div></div>
      <div class="field"><label>Horario de atención</label><input class="input" name="horario" value="${esc(n.horario)}"></div>
      <div class="row"><div class="field"><label>Garantía de service (días)</label><input class="input" type="number" name="garantia_dias" value="${n.garantia_dias}"></div><div></div></div>
      <div class="field"><label>Texto al pie del comprobante de service</label><textarea class="input" name="pie_comprobante">${esc(n.pie_comprobante)}</textarea></div>
      <button class="btn primary" id="guardar">Guardar</button></div>
    ${store.modo === 'demo' ? `<div class="card card-pad"><h2>Modo demostración</h2>
      <p class="small" style="margin-bottom:.8rem">La app está funcionando con <b>datos de ejemplo guardados solo en este navegador</b>. Podés cargar, vender y probar todo libremente: nada se envía a ningún lado.</p>
      <p class="small muted" style="margin-bottom:1rem">Cuando conectemos Supabase, los datos pasan a guardarse en la base real y quedan disponibles desde cualquier computadora o celular.</p>
      <button class="btn danger" id="reset">Restablecer datos de ejemplo</button></div>` : ''}
  </div></div>`;
  $('#guardar').onclick = () => run(async () => { const f = formData(view()); f.garantia_dias = +f.garantia_dias || 0; await store.guardarNegocio(f); toast('Datos guardados'); });
  if ($('#reset')) $('#reset').onclick = () => { if (confirm('¿Borrar todo lo cargado y volver a los datos de ejemplo?')) { resetDemo(); cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo' }; prodSel.clear(); toast('Datos restablecidos'); go('#/inicio'); } };
};

// =====================================================================
// Login (solo con Supabase)
// =====================================================================
function pantallaLogin(mensaje = '') {
  $('nav.tabs').hidden = true;
  view().innerHTML = `
  <div class="card card-pad" style="max-width:380px;margin:8vh auto 0">
    <div style="text-align:center;margin-bottom:1.2rem"><img src="img/logo.png" alt="" style="width:72px;height:72px"><h1 style="font-size:1.2rem;margin-top:.5rem">Ingresar a GScom</h1></div>
    ${mensaje ? `<div class="small" style="background:var(--warn-soft);padding:.6rem .8rem;border-radius:8px;margin-bottom:1rem">${esc(mensaje)}</div>` : ''}
    <form id="login">
      <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label>Contraseña</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary block lg" type="submit">Ingresar</button>
    </form></div>`;
  $('#login [name=email]').focus();
  $('#login').onsubmit = async e => {
    e.preventDefault();
    const f = formData($('#login'));
    const btn = $('#login button'); btn.disabled = true; btn.textContent = 'Ingresando…';
    const ok = await run(async () => { await store.login(f.email, f.password); return true; });
    if (ok) iniciar(); else { btn.disabled = false; btn.textContent = 'Ingresar'; }
  };
}

// =====================================================================
// Arranque
// =====================================================================
$('nav.tabs').innerHTML = NAV.map(([r, l]) => `<a href="#/${r}" data-r="${r}">${l}</a>`).join('');
let iniciada = false;

async function iniciar() {
  if (store.modo === 'demo') {
    $('#demo-badge').hidden = false;
  } else {
    const perfil = await store.perfil().catch(() => null);
    if (!perfil) return pantallaLogin();
    if (!perfil.activo) {
      await store.logout();
      return pantallaLogin(`El usuario ${perfil.email} todavía no está activado. Pedile a un administrador que lo active.`);
    }
    const u = $('#usuario');
    u.hidden = false; u.textContent = `${(perfil.nombre || perfil.email).split(' ')[0]} · Salir`;
    u.onclick = async () => { if (confirm('¿Cerrar sesión?')) { await store.logout(); location.reload(); } };
  }
  $('nav.tabs').hidden = false;
  if (!iniciada) { window.addEventListener('hashchange', render); iniciada = true; }
  render();
}
iniciar();
