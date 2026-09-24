import { store, ESTADOS, estadoInfo, FORMAS_PAGO, FORMAS_COBRO, CUENTA_CORRIENTE, TIPOS_EQUIPO, CONDICIONES_IVA, resetDemo } from './store.js';

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
const daysSince = iso => Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const matches = (q, ...fields) => { const t = norm(q).trim(); return !t || t.split(/\s+/).every(w => fields.some(f => norm(f).includes(w))); };
const pill = estado => { const e = estadoInfo(estado); return `<span class="pill ${e.color}">${esc(e.label)}</span>`; };
const ACTIVAS = o => !['entregado'].includes(o.estado);
// Para saludar: "Juan" (o la razón social si no tiene nombres cargados)
const primerNombre = c => (c?.nombres || '').split(' ')[0] || c?.apellido || (c?.nombre || '').split(' ')[0];
// Respuesta del cliente al presupuesto, para mostrar junto al estado
const respuestaPresu = o => o.estado !== 'presupuesto' || o.presupuesto_aprobado == null ? ''
  : o.presupuesto_aprobado ? ' <span class="pill green">✓ Aceptado</span>' : ' <span class="pill red">✗ Rechazado</span>';

// Búsqueda de productos: por nombre, marca, categoría, descripción o código
const buscarProductos = (productos, cats, t, filtro = () => true) => productos.filter(p => filtro(p) && (p.codigo_barras === t
  || matches(t, p.nombre, p.marca, p.descripcion, p.codigo_barras, cats.find(c => c.id === p.categoria_id)?.nombre))).slice(0, 8);

// Contenido de un resultado de búsqueda con todos los datos, para no confundir productos parecidos
function prodSugHTML(p, cats, { costo = false } = {}) {
  const extra = [p.marca, cats.find(c => c.id === p.categoria_id)?.nombre].filter(Boolean).map(esc).join(' · ');
  const stockCls = p.stock <= 0 ? 'color:var(--bad)' : p.stock <= p.stock_minimo ? 'color:var(--warn)' : '';
  return `<span style="min-width:0"><b>${esc(p.nombre)}</b>${extra ? ` <span class="muted">· ${extra}</span>` : ''}
      ${p.descripcion ? `<span class="small muted" style="display:block">${esc(p.descripcion)}</span>` : ''}
      <span class="small muted mono" style="display:block">${esc(p.codigo_barras)}${costo ? ` · costo ${money(p.precio_costo)}` : ''} · venta ${money(p.precio_venta)}</span></span>
    <span class="nowrap small" style="${stockCls}">${p.es_servicio ? 'servicio' : `stock ${p.stock}`}</span>`;
}

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

// pagina: regla @page para este tipo de impresión (ticketera, A4, etiquetas)
function printHTML(html, pagina = 'margin: 8mm') {
  const area = $('#print-area');
  area.innerHTML = html;
  let st = $('#print-page');
  if (!st) { st = document.createElement('style'); st.id = 'print-page'; document.head.appendChild(st); }
  st.textContent = `@media print { @page { ${pagina} } }`;
  setTimeout(() => window.print(), 150);
}
const PAGINA_TICKET = 'margin: 0';                 // ticketera 57/58 mm: el tamaño lo da la impresora
const PAGINA_A4 = 'size: A4 portrait; margin: 0';

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
  ['clientes', 'Clientes'], ['fichero', 'Fichero'], ['caja', 'Caja'], ['compras', 'Compras'], ['proveedores', 'Proveedores'],
  ['reportes', 'Reportes'], ['ajustes', 'Ajustes'],
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
  actualizarContador();
}

// =====================================================================
// Avisos: el cliente respondió un presupuesto desde su link
// =====================================================================
let respondidos = 0;
async function actualizarContador() {
  try { respondidos = await store.presupuestosRespondidos(); } catch { return; }
  const a = $('nav.tabs a[data-r=service]');
  if (a) a.innerHTML = `Service${respondidos ? ` <span class="badge" title="Presupuestos respondidos por clientes">${respondidos}</span>` : ''}`;
  document.title = (respondidos && document.hidden ? `(${respondidos}) ` : '') + 'GScom — Gestión';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'GScom — Gestión'; });

function sonido() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch { /* sin audio */ }
}

async function avisarRespuesta(ordenId, acepta) {
  const o = await store.orden(ordenId).catch(() => null);
  if (!o) return;
  let pila = $('#avisos');
  if (!pila) { pila = document.createElement('div'); pila.id = 'avisos'; document.body.appendChild(pila); }
  const el = document.createElement('div');
  el.className = `aviso ${acepta ? 'ok' : 'no'}`;
  el.innerHTML = `<button class="x" title="Cerrar">×</button>
    <div class="small muted">Respuesta desde el link de seguimiento</div>
    <div style="margin:.2rem 0 .6rem"><b>${acepta ? '✓' : '✗'} ${esc(o.cliente?.nombre)}</b> ${acepta ? 'ACEPTÓ' : 'RECHAZÓ'} el presupuesto
      de la orden <b>#${o.numero}</b>${o.presupuesto != null ? ` (${money(o.presupuesto)})` : ''}.</div>
    <a class="btn sm ${acepta ? 'ok' : ''}" href="#/service/${o.id}">Ver orden</a>`;
  $('.x', el).onclick = () => el.remove();
  $('a', el).onclick = () => el.remove();
  pila.prepend(el);
  sonido();
  await actualizarContador();
  if (document.hidden) document.title = `(${respondidos}) GScom — Gestión`;
  // si justo está mirando la lista de service o el inicio, refrescar
  const r = parseHash();
  if (r.name === 'service' || r.name === 'inicio') render();
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
  ${(() => {
    const resp = ordenes.filter(o => o.estado === 'presupuesto' && o.presupuesto_aprobado != null);
    return resp.length ? `<div class="card card-pad" style="margin-bottom:1rem;border-left:4px solid var(--ok)">
      <h2>Presupuestos respondidos por clientes <span class="badge">${resp.length}</span></h2>
      ${resp.map(o => `<div class="row small" style="align-items:center;padding:.35rem 0;border-top:1px solid var(--line)">
        <span><a href="#/service/${o.id}"><b>#${o.numero}</b></a> · ${esc(o.cliente?.nombre)} · ${esc([o.equipo?.tipo, o.equipo?.marca].filter(Boolean).join(' '))}</span>
        <span class="right">${money(o.presupuesto)} ${respuestaPresu(o)}</span></div>`).join('')}
      <div class="small muted" style="margin-top:.5rem">Desaparecen de acá cuando cambiás el estado de la orden (por ejemplo, a "En reparación").</div></div>` : '';
  })()}
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
let cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', editId: null, editNumero: null };

ROUTES.vender = async ({ q }) => {
  const [productos, clientes, cats] = await Promise.all([store.productos(), store.clientes(), store.categorias()]);
  if (q.get('cliente')) cart.cliente_id = q.get('cliente');

  view().innerHTML = `
  <div class="page-head"><h1>${cart.editId ? `Editar venta #${cart.editNumero}` : 'Nueva venta'}</h1><div class="actions"><button class="btn" id="manual">+ Ítem manual</button><button class="btn danger" id="vaciar">${cart.editId ? 'Cancelar edición' : 'Vaciar'}</button></div></div>
  ${cart.editId ? '<div class="small" style="background:var(--warn-soft);padding:.6rem .8rem;border-radius:8px;margin-bottom:1rem">Al guardar, el stock y la caja/cuenta corriente se corrigen según la diferencia con la venta original.</div>' : ''}
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
        ${FORMAS_COBRO.map(f => `<button class="chip" data-f="${f}">${f}</button>`).join('')}</div></div>
      <div class="field"><label>Descuento ($)</label><input class="input" id="desc" type="number" min="0" step="any" value="${cart.descuento || ''}" placeholder="0"></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:.6rem 0 1rem">
      <div class="row small muted"><span>Subtotal</span><span class="right" id="subt"></span></div>
      <div class="row" style="align-items:baseline;margin:.3rem 0 1rem"><span>Total</span><span class="right total-box" id="tot"></span></div>
      <button class="btn ok lg block" id="cobrar">${cart.editId ? 'Guardar cambios' : 'Cobrar'}</button>
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
    sug.innerHTML = results.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}">${prodSugHTML(p, cats)}</div>`).join('')
      || '<div class="muted">Sin resultados</div>';
    $$('[data-i]', sug).forEach(d => d.onmousedown = e => { e.preventDefault(); add(results[+d.dataset.i]); });
  };
  scan.oninput = () => {
    const t = scan.value.trim();
    if (!t) { sug.hidden = true; return; }
    results = buscarProductos(productos, cats, t);
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

  $('#vaciar').onclick = () => {
    if (cart.editId) {
      if (cart.items.length && !confirm('¿Cancelar la edición? La venta queda como estaba.')) return;
      cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', editId: null, editNumero: null }; go('#/caja'); return;
    }
    cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', editId: null, editNumero: null }; render();
  };
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
    if (cart.forma_pago === CUENTA_CORRIENTE && !cart.cliente_id) return toast('Para vender a cuenta corriente elegí el cliente', true);
    const sinStock = cart.items.filter(i => i.producto_id && !i.es_servicio && i.cantidad > i.stock);
    if (sinStock.length && !confirm(`Hay ${sinStock.length} producto(s) sin stock suficiente según el sistema. ¿Registrar la venta igual?`)) return;
    if (cart.editId) {
      await store.editarVenta(cart.editId, { cliente_id: cart.cliente_id ? +cart.cliente_id : null, items: cart.items, descuento: cart.descuento, forma_pago: cart.forma_pago });
      cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', editId: null, editNumero: null };
      toast('Venta actualizada'); go('#/caja'); return;
    }
    const v = await store.registrarVenta({ cliente_id: cart.cliente_id ? +cart.cliente_id : null, items: cart.items, descuento: cart.descuento, forma_pago: cart.forma_pago });
    cart = { items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', editId: null, editNumero: null };
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
    <div class="c">Documento no válido como factura.<br>¡Gracias por su compra!</div></div>`, PAGINA_TICKET);
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
    `${v.anulada ? '' : '<button class="btn" id="editar">Editar</button><button class="btn danger" id="anular">Anular venta</button>'}<button class="btn" id="imp">Imprimir</button><button class="btn primary" data-close>Cerrar</button>`, { wide: true });
  $('#imp', m.el).onclick = () => imprimirVenta(id);
  const an = $('#anular', m.el);
  if (an) an.onclick = () => run(async () => {
    if (!confirm('¿Anular esta venta? Se devuelve el stock y se registra un egreso en caja.')) return;
    await store.anularVenta(id); m.close(); toast('Venta anulada'); render();
  });
  const ed = $('#editar', m.el);
  if (ed) ed.onclick = () => run(async () => {
    if (cart.items.length && !confirm('Tenés una venta en curso sin terminar en "Vender". ¿Descartarla para editar esta?')) return;
    const productos = await store.productos();
    cart = {
      editId: v.id, editNumero: v.numero, cliente_id: v.cliente_id ? String(v.cliente_id) : '', descuento: +v.descuento || 0, forma_pago: v.forma_pago,
      items: v.items.map(i => {
        const p = i.producto_id ? productos.find(x => x.id === i.producto_id) : null;
        return { producto_id: i.producto_id, descripcion: i.descripcion, cantidad: +i.cantidad, precio_unitario: +i.precio_unitario, stock: p?.stock ?? 0, es_servicio: p ? p.es_servicio : true };
      }),
    };
    m.close(); go('#/vender');
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
    && (texto === p.codigo_barras || matches(texto, p.nombre, p.marca, p.descripcion, p.codigo_barras, catName(p.categoria_id))));
  function paint() {
    $('#cats').innerHTML = chips.map(([k, l]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-k="${k}">${esc(l)}</button>`).join('');
    $$('#cats .chip').forEach(c => c.onclick = () => { filtro = c.dataset.k; paint(); });
    const l = lista();
    $('#rows').innerHTML = l.map(p => `<tr class="click" data-id="${p.id}">
      <td><input type="checkbox" data-sel="${p.id}" ${prodSel.has(p.id) ? 'checked' : ''}></td>
      <td class="mono small">${esc(p.codigo_barras)}${p.codigo_interno ? ' <span class="pill blue" title="Código generado por GScom">int</span>' : ''}</td>
      <td>${esc(p.nombre)}${p.marca || p.descripcion ? `<div class="small muted">${[p.marca, p.descripcion].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</td><td class="muted">${esc(catName(p.categoria_id))}</td>
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

// opts.prefill: datos iniciales · opts.onSaved(producto): en vez de refrescar la pantalla · opts.sinStock: ocultar "Stock inicial"
async function productoModal(id, opts = {}) {
  const [p, categorias] = await Promise.all([id ? store.producto(id) : null, store.categorias()]);
  const movs = id ? await store.movimientosStock(id) : [];
  const v = p || { nombre: '', codigo_barras: '', marca: '', descripcion: '', categoria_id: '', precio_costo: '', precio_venta: '', stock: '', stock_minimo: 1, es_servicio: false, ...opts.prefill };
  const m = modal(id ? 'Editar producto' : 'Nuevo producto', `
    <div class="field"><label>Nombre *</label><input class="input" name="nombre" value="${esc(v.nombre)}"></div>
    <div class="row"><div class="field"><label>Marca</label><input class="input" name="marca" value="${esc(v.marca)}"></div>
      <div class="field"><label>Categoría</label><select class="input" name="categoria_id"><option value="">—</option>${categorias.map(c => `<option value="${c.id}" ${c.id === v.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}<option value="__nueva">+ Nueva categoría…</option></select></div></div>
    <div class="field"><label>Descripción / detalle</label><input class="input" name="descripcion" value="${esc(v.descripcion)}" placeholder="ej: USB, negro, teclado en español · 1TB 7200rpm"></div>
    <div class="field"><label>Código de barras</label><input class="input mono" name="codigo_barras" value="${esc(v.codigo_barras)}" placeholder="Escaneá el código de fábrica, o dejalo vacío para generar uno interno">
      ${id ? `<div style="margin-top:.5rem">${barcodeSVG(v.codigo_barras, { height: 40 })}</div>` : ''}</div>
    <div class="row"><div class="field"><label>Precio de costo</label><input class="input" name="precio_costo" type="number" step="any" min="0" value="${v.precio_costo}"></div>
      <div class="field"><label>Precio de venta *</label><input class="input" name="precio_venta" type="number" step="any" min="0" value="${v.precio_venta}"></div>
      <div class="field"><label>Margen</label><input class="input" id="margen" readonly tabindex="-1"></div></div>
    <div class="row">${id || opts.sinStock ? '' : `<div class="field"><label>Stock inicial</label><input class="input" name="stock" type="number" step="any" value="${v.stock}"></div>`}
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
    const data = { ...(id ? { id } : {}), nombre: f.nombre, marca: f.marca, descripcion: f.descripcion, categoria_id: f.categoria_id && f.categoria_id !== '__nueva' ? +f.categoria_id : null,
      precio_costo: +f.precio_costo || 0, precio_venta: +f.precio_venta || 0, stock_minimo: +f.stock_minimo || 0, es_servicio: f.es_servicio };
    data.codigo_barras = f.codigo_barras;
    if (!id) data.stock = +f.stock || 0;
    const r = await store.guardarProducto(data);
    m.close(); toast(id ? 'Producto actualizado' : `Producto creado · código ${r.codigo_barras}`);
    opts.onSaved ? opts.onSaved(r) : render();
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
  const v = c || { apellido: '', nombres: '', telefono: '', dni_cuit: '', email: '', direccion: '', notas: '', condicion_iva: CONDICIONES_IVA[0] };
  const m = modal(c ? 'Editar cliente' : 'Nuevo cliente', `
    <div class="row"><div class="field"><label>Apellido / Razón social *</label><input class="input" name="apellido" value="${esc(v.apellido ?? v.nombre)}"></div>
      <div class="field"><label>Nombres</label><input class="input" name="nombres" value="${esc(v.nombres)}" placeholder="(vacío si es empresa)"></div></div>
    <div class="row"><div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="telefono" value="${esc(v.telefono)}" placeholder="ej: 342 555-1234"></div>
      <div class="field"><label>DNI / CUIT</label><input class="input" name="dni_cuit" value="${esc(v.dni_cuit)}"></div></div>
    <div class="row"><div class="field"><label>Email</label><input class="input" name="email" type="email" value="${esc(v.email)}"></div>
      <div class="field"><label>Dirección</label><input class="input" name="direccion" value="${esc(v.direccion)}"></div></div>
    <div class="field"><label>Condición IVA</label><select class="input" name="condicion_iva">${CONDICIONES_IVA.map(o => `<option ${o === (v.condicion_iva || CONDICIONES_IVA[0]) ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
    <div class="field"><label>Notas internas</label><textarea class="input" name="notas">${esc(v.notas)}</textarea></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (!f.apellido) return toast('El apellido (o razón social) es obligatorio', true);
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
  const [c, equipos, h, cc] = await Promise.all([store.cliente(id), store.equipos(id), store.historialCliente(id), store.ccMovimientos(id)]);
  if (!c) { view().innerHTML = '<div class="empty">Cliente no encontrado</div>'; return; }
  const saldo = cc.reduce((s, m) => s + +m.monto, 0);
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
    <a class="card kpi" href="#/fichero/${c.id}" style="text-decoration:none;color:inherit"><div class="label">Cuenta corriente</div>
      <div class="value" style="${saldo > 0 ? 'color:var(--bad)' : ''}">${money(saldo)}</div><div class="sub">${saldo > 0 ? 'adeuda · ver / cobrar →' : cc.length ? 'al día · ver movimientos →' : 'sin movimientos'}</div></a>
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
        <dl class="kv"><dt>Teléfono</dt><dd>${esc(c.telefono) || '—'} ${c.telefono ? `<a class="small" target="_blank" rel="noopener" href="${waLink(c.telefono, `Hola ${primerNombre(c)}, te escribimos de GScom.`)}">WhatsApp</a>` : ''}</dd>
        <dt>DNI / CUIT</dt><dd>${esc(c.dni_cuit) || '—'}</dd><dt>Email</dt><dd>${esc(c.email) || '—'}</dd><dt>Dirección</dt><dd>${esc(c.direccion) || '—'}</dd>
        <dt>Condición IVA</dt><dd>${esc(c.condicion_iva) || CONDICIONES_IVA[0]}</dd>
        <dt>Cliente desde</dt><dd>${fdate(c.created_at)}</dd></dl>
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
      <td class="small" style="max-width:280px">${esc(o.falla_reportada)}</td><td>${pill(o.estado)}${respuestaPresu(o)}</td></tr>`).join('')
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
      <div class="row"><div class="field"><label>Apellido / Razón social *</label><input class="input" name="c_apellido"></div>
      <div class="field"><label>Nombres</label><input class="input" name="c_nombres"></div></div>
      <div class="row"><div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="c_telefono"></div>
      <div class="field"><label>DNI / CUIT</label><input class="input" name="c_dni_cuit"></div></div></div>
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
    if (f.cliente_id === '__nuevo' && !f.c_apellido) return toast('Completá el apellido del cliente nuevo', true);
    if (!f.falla_reportada) return toast('Describí la falla reportada', true);
    let cid = +f.cliente_id;
    if (f.cliente_id === '__nuevo') cid = (await store.guardarCliente({ apellido: f.c_apellido, nombres: f.c_nombres, telefono: f.c_telefono, dni_cuit: f.c_dni_cuit })).id;
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
  const pos = ['repuesto', 'derivado'].includes(estado) ? FLUJO.indexOf('reparacion') : estado === 'sin_reparacion' ? FLUJO.indexOf('listo') : FLUJO.indexOf(estado);
  return `<div class="stepper">${FLUJO.map((s, i) => {
    let label = estadoInfo(s).label;
    if (i === pos && ['repuesto', 'derivado'].includes(estado)) label = estadoInfo(estado).label;
    if (i === pos && estado === 'sin_reparacion') label = 'Sin reparación';
    return `<div class="step ${i < pos ? 'done' : ''} ${i === pos ? 'current' : ''}">${esc(label)}</div>`;
  }).join('')}</div>`;
}

async function detalleOrden(id) {
  const [o, productos, n, cats, anticipos] = await Promise.all([store.orden(id), store.productos(), store.negocio(), store.categorias(), store.anticiposOrden(id)]);
  if (!o) { view().innerHTML = '<div class="empty">Orden no encontrada</div>'; return; }
  const url = trackingURL(o.token);
  const items = o.items.slice();
  const eq = [o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' ');
  const cerrada = o.estado === 'entregado';
  const anticipadoTotal = anticipos.filter(a => !a.anulado).reduce((s, a) => s - a.monto, 0);

  view().innerHTML = `
  <div class="page-head"><div><a href="#/service" class="small muted">← Service</a><h1>Orden #${o.numero} ${pill(o.estado)}${respuestaPresu(o)}</h1></div>
    <div class="actions"><button class="btn" id="imp">Imprimir comprobante</button>${cerrada ? '<button class="btn danger" id="anular-entrega">Anular entrega</button>' : '<button class="btn ok" id="entregar">Entregar y cobrar</button>'}</div></div>
  <div class="card card-pad" style="margin-bottom:1rem">${stepper(o.estado)}</div>
  <div class="split">
    <div class="grid">
      <div class="card card-pad"><h2>Equipo y cliente</h2>
        <dl class="kv"><dt>Cliente</dt><dd><a href="#/clientes/${o.cliente.id}">${esc(o.cliente.nombre)}</a> · ${esc(o.cliente.telefono)}</dd>
        <dt>Equipo</dt><dd>${esc(eq)}${o.equipo?.nro_serie ? ` <span class="small muted mono">S/N ${esc(o.equipo.nro_serie)}</span>` : ''}</dd>
        <dt>Ingreso</dt><dd>${fdatetime(o.fecha_ingreso)}</dd>
        ${o.fecha_entrega ? `<dt>Entregado</dt><dd>${fdatetime(o.fecha_entrega)} · ${money(o.total_cobrado)}</dd>` : ''}</dl>
        <div class="row"><div class="field"><label>Fecha estimada</label><input class="input" type="date" id="fecha-est" value="${o.fecha_estimada || ''}"></div>
          <div class="field"><label>Técnico</label><input class="input" id="tecnico" value="${esc(o.tecnico)}"></div></div>
        <div class="field"><label>Falla reportada</label><textarea class="input" id="falla">${esc(o.falla_reportada)}</textarea></div>
        <div class="row"><div class="field"><label>Accesorios</label><input class="input" id="accesorios" value="${esc(o.accesorios)}"></div>
          <div class="field"><label>Contraseña / patrón</label><input class="input mono" id="contrasena" value="${esc(o.contrasena_equipo)}"></div></div>
        <button class="btn" id="guardar-datos">Guardar</button></div>
      <div class="card card-pad"><h2>Diagnóstico y presupuesto</h2>
        <div class="field"><label>Diagnóstico técnico</label><textarea class="input" id="diag">${esc(o.diagnostico)}</textarea></div>
        <div class="field"><label>Trabajo realizado</label><textarea class="input" id="trab">${esc(o.trabajo_realizado)}</textarea></div>
        <div class="row"><div class="field"><label>Presupuesto ($)</label><input class="input" type="number" step="any" min="0" id="pres" value="${o.presupuesto ?? ''}"></div>
          <div class="field"><label>¿Aprobado por el cliente?</label><select class="input" id="aprob"><option value="">Pendiente</option><option value="si" ${o.presupuesto_aprobado === true ? 'selected' : ''}>Sí</option><option value="no" ${o.presupuesto_aprobado === false ? 'selected' : ''}>No</option></select></div></div>
        <div class="field"><label>Notas internas (el cliente no las ve)</label><textarea class="input" id="notas">${esc(o.notas_internas)}</textarea></div>
        <button class="btn" id="guardar-diag">Guardar</button></div>
      <div class="card card-pad"><h2>Anticipos (pago a cuenta) ${cerrada ? '' : '<button class="btn sm" id="add-anticipo">+ Registrar anticipo</button>'}</h2>
        ${anticipos.length ? `<table class="tbl small" style="margin-bottom:.6rem"><tbody>${anticipos.map(a => `<tr><td>${fdatetime(a.fecha)}</td><td>${esc(a.forma_pago)}</td>
          <td class="num">${money(-a.monto)}</td><td>${a.anulado ? '<span class="pill red">Anulado</span>' : cerrada ? '' : `<button class="x" data-anular-ant="${a.id}" title="Anular">×</button>`}</td></tr>`).join('')}</tbody></table>`
          : '<p class="small muted" style="margin-bottom:.6rem">Sin anticipos registrados.</p>'}
        <div class="small muted">Anticipado: <b>${money(anticipadoTotal)}</b>${o.presupuesto || items.length ? ` · Saldo pendiente estimado: <b>${money(Math.max((o.presupuesto || items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)) - anticipadoTotal, 0))}</b>` : ''}</div>
        <p class="small muted" style="margin-top:.3rem">Se descuenta solo al entregar y cobrar el equipo. Impacta caja al momento y el saldo del cliente en el Fichero.</p></div>
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
    return `Hola ${primerNombre(o.cliente)}! Te escribimos de ${n.nombre} por tu ${eq} (orden #${o.numero}).\n\nEstado: *${e.label}*\n${coment || e.cliente}\n\nPodés seguirlo acá: ${url}`;
  };
  const wa = $('#wa'); if (wa) wa.href = waLink(o.cliente.telefono, msgWA(o.estado, ''));
  $('#copiar').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { prompt('Copiá el link:', url); } };
  $('#imp').onclick = () => imprimirOrden(o, n, url);

  $('#guardar-datos').onclick = () => run(async () => {
    await store.actualizarOrden(id, { fecha_estimada: $('#fecha-est').value || null, tecnico: $('#tecnico').value.trim(),
      falla_reportada: $('#falla').value.trim(), accesorios: $('#accesorios').value.trim(), contrasena_equipo: $('#contrasena').value.trim() });
    toast('Guardado');
  });

  $('#guardar-diag').onclick = () => run(async () => {
    const ap = $('#aprob').value;
    await store.actualizarOrden(id, { diagnostico: $('#diag').value.trim(), trabajo_realizado: $('#trab').value.trim(),
      presupuesto: $('#pres').value === '' ? null : +$('#pres').value, presupuesto_aprobado: ap === '' ? null : ap === 'si', notas_internas: $('#notas').value.trim() });
    toast('Guardado');
  });

  const addAnt = $('#add-anticipo');
  if (addAnt) addAnt.onclick = () => anticipoModal(o, () => render());
  $$('[data-anular-ant]').forEach(b => b.onclick = () => run(async () => {
    if (!confirm('¿Anular este anticipo? Se descuenta de caja y del saldo del cliente.')) return;
    await store.anularCobroCuenta(+b.dataset.anularAnt); toast('Anticipo anulado'); render();
  }));

  const cambiar = $('#cambiar');
  if (cambiar) cambiar.onclick = () => run(async () => {
    const estado = $('#nuevo-estado').value, coment = $('#coment').value.trim();
    if (estado === o.estado && !coment) return toast('Elegí un estado distinto o escribí un mensaje', true);
    const pres = $('#pres').value === '' ? null : +$('#pres').value;
    if (estado === 'presupuesto' && pres == null) return toast('Cargá el monto en "Presupuesto ($)" para que el cliente pueda aceptarlo desde el link', true);
    // Presupuesto nuevo o modificado: se guarda y queda pendiente de respuesta del cliente
    if (pres !== o.presupuesto) await store.actualizarOrden(id, { presupuesto: pres, presupuesto_aprobado: null });
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
    const r = buscarProductos(productos, cats, t);
    sug.hidden = false;
    sug.innerHTML = r.map(p => `<div data-id="${p.id}">${prodSugHTML(p, cats)}</div>`).join('') || '<div class="muted">Sin resultados</div>';
    $$('[data-id]', sug).forEach(d => d.onmousedown = e => {
      e.preventDefault(); const p = productos.find(x => x.id === +d.dataset.id);
      items.push({ producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: p.precio_venta });
      br.value = ''; sug.hidden = true; saveItems();
    });
  };
  br.onblur = () => setTimeout(() => sug.hidden = true, 150);

  const anEnt = $('#anular-entrega');
  if (anEnt) anEnt.onclick = () => run(async () => {
    if (!confirm('¿Anular la entrega? La orden vuelve a "Listo para retirar", los repuestos vuelven al stock y se descuenta el cobro (de caja o de la cuenta corriente).')) return;
    await store.anularEntregaOrden(id); toast('Entrega anulada'); render();
  });
  const ent = $('#entregar');
  if (ent) ent.onclick = () => {
    const totalItems = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const sugerido = totalItems || o.presupuesto || 0;
    let forma = 'Efectivo';
    const m = modal(`Entregar orden #${o.numero}`, `
      <div class="field"><label>Total del trabajo</label><input class="input" type="number" step="any" min="0" id="tot" value="${sugerido}"></div>
      <p class="small muted" style="margin:-.4rem 0 .8rem">${totalItems ? 'Sugerido: suma de repuestos y mano de obra.' : o.presupuesto ? 'Sugerido: presupuesto.' : 'Poné 0 si no se cobra (garantía, sin reparación).'}${anticipadoTotal ? ` Ya se cobraron ${money(anticipadoTotal)} en anticipos: se descuentan solos.` : ''}</p>
      <div class="field"><label>Forma de pago del saldo restante</label><div class="pay-opts">${FORMAS_COBRO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
        <div class="small muted" style="margin-top:.3rem" id="saldo-restante"></div></div>
      <div class="field"><label>Mensaje final para el cliente (opcional)</label><input class="input" id="msg" placeholder="ej: Garantía de ${n.garantia_dias} días sobre el trabajo realizado."></div>`,
      `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="ok">Confirmar entrega</button>`);
    const pintarSaldo = () => {
      const restante = Math.max((+$('#tot', m.el).value || 0) - anticipadoTotal, 0);
      $('#saldo-restante', m.el).textContent = forma === 'Cuenta corriente'
        ? `Queda ${money(restante)} como deuda del cliente en el Fichero (no entra a caja).`
        : restante ? `Se cobra ${money(restante)} ahora por ${forma.toLowerCase()}.` : 'Nada más que cobrar: el anticipo ya cubre el total.';
    };
    $('#tot', m.el).oninput = pintarSaldo;
    $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); pintarSaldo(); });
    pintarSaldo();
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

// Comprobante de ingreso: dos A6 (105 × 148 mm) lado a lado en la mitad superior de una A4.
// Izquierda: original para el cliente (con QR). Derecha: duplicado para el local (con contraseña y firma).
async function imprimirOrden(o, n, url) {
  const anticipos = await store.anticiposOrden(o.id).catch(() => []);
  const anticipado = anticipos.filter(a => !a.anulado).reduce((s, a) => s - a.monto, 0);
  const eq = [o.equipo?.tipo, o.equipo?.marca, o.equipo?.modelo].filter(Boolean).join(' ');
  const corto = (t, max) => { t = String(t || ''); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
  const fila = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '';

  const copia = duplicado => `<div class="a6">
    <div class="a6-head">
      <img src="img/logo.png" alt="">
      <div class="a6-neg"><b>${esc(n.nombre)}</b> · Service técnico<br>${esc(n.direccion)}${n.telefono ? ` · Tel ${esc(n.telefono)}` : ''}${n.whatsapp ? `<br>WhatsApp ${esc(n.whatsapp)}` : ''}</div>
      <div class="a6-nro"><span>ORDEN N°</span><b>${o.numero}</b></div>
    </div>
    <div class="a6-copia">${duplicado ? 'DUPLICADO — LOCAL' : 'ORIGINAL — CLIENTE'} · Ingreso ${fdatetime(o.fecha_ingreso)}</div>
    <table class="a6-datos">
      ${fila('Cliente', esc(o.cliente.nombre))}
      ${fila('Teléfono', esc(o.cliente.telefono))}
      ${duplicado ? fila('DNI / CUIT', esc(o.cliente.dni_cuit)) : ''}
      ${fila('Equipo', esc(eq))}
      ${fila('N° de serie', esc(o.equipo?.nro_serie))}
      ${fila('Accesorios', esc(o.accesorios) || 'Ninguno')}
      ${fila('Falla', esc(corto(o.falla_reportada, duplicado ? 220 : 260)))}
      ${fila('Fecha estimada', o.fecha_estimada ? fdate(o.fecha_estimada) : '')}
      ${fila('Presupuesto', o.presupuesto != null ? money(o.presupuesto) : '')}
      ${fila('Anticipo', anticipado ? money(anticipado) : '')}
      ${duplicado ? fila('Contraseña', esc(o.contrasena_equipo)) + fila('Técnico', esc(o.tecnico)) : ''}
    </table>
    <div class="a6-pie">
      ${duplicado
        ? `<div class="a6-cond">${esc(n.pie_comprobante)}</div>
           <div class="a6-firma"><span>Firma del cliente</span><span>Aclaración</span></div>`
        : `<div class="a6-qr">${qrSVG(url)}<div><b>Seguí el estado de tu equipo</b> escaneando este código con la cámara del celular.
             <div class="a6-cond">${esc(n.pie_comprobante)}</div></div></div>`}
    </div>
  </div>`;

  printHTML(`<div class="hoja-a4"><div class="dos-a6">${copia(false)}${copia(true)}</div></div>`, PAGINA_A4);
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
      ${delDia.map(m => `<tr class="click" data-mov="${m.id}"><td>${new Date(m.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td><td>${esc(m.concepto)}</td><td>${esc(m.forma_pago)}</td>
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
  $$('tr[data-mov]').forEach(tr => tr.onclick = () => movimientoCajaModal(movs.find(x => x.id === +tr.dataset.mov)));
};

// Detalle de un movimiento de caja: de dónde viene y cómo anularlo
async function movimientoCajaModal(mv) {
  const hora = fdatetime(mv.fecha);
  const signo = `${mv.tipo === 'ingreso' ? '+' : '−'}${money(mv.monto)}`;
  let origen = 'Movimiento manual', accion = '', ir = '', ejecutar = null;
  const esAnulacion = /^Anulación/.test(mv.concepto);

  if (mv.venta_id) {
    const v = await store.venta(mv.venta_id);
    origen = `Venta #${v.numero}${v.cliente ? ` · ${esc(v.cliente.nombre)}` : ''}`;
    ir = `<button class="btn" id="ir">Ver venta</button>`;
    if (!v.anulada && !esAnulacion) {
      accion = 'Anular la venta (devuelve el stock y descuenta el cobro de caja)';
      ejecutar = () => store.anularVenta(v.id);
    } else if (v.anulada) origen += ' <span class="pill red">Anulada</span>';
  } else if (mv.orden_id) {
    const o = await store.orden(mv.orden_id);
    origen = `Service orden #${o.numero} · ${esc(o.cliente?.nombre)}`;
    ir = `<a class="btn" href="#/service/${o.id}" data-close>Ver orden</a>`;
    if (o.estado === 'entregado' && !esAnulacion) {
      accion = 'Anular la entrega (la orden vuelve a "Listo para retirar", los repuestos vuelven al stock y se descuenta el cobro)';
      ejecutar = () => store.anularEntregaOrden(o.id);
    }
  } else if (mv.cc_movimiento_id) {
    const cm = await store.ccMovimiento(mv.cc_movimiento_id);
    origen = `Cobro de cuenta corriente${cm?.anulado ? ' <span class="pill red">Anulado</span>' : ''}`;
    if (cm) ir = `<a class="btn" href="#/fichero/${cm.cliente_id}" data-close>Ver cuenta</a>`;
    if (cm && !cm.anulado && !esAnulacion) {
      accion = 'Anular el cobro (la deuda vuelve a la cuenta del cliente y se descuenta de caja)';
      ejecutar = () => store.anularCobroCuenta(cm.id);
    }
  } else {
    accion = 'Eliminar este movimiento';
    ejecutar = () => store.eliminarMovimientoCaja(mv.id);
  }
  const esManual = !mv.venta_id && !mv.orden_id && !mv.cc_movimiento_id;

  const m = modal('Movimiento de caja', `
    <dl class="kv"><dt>Fecha</dt><dd>${hora}</dd><dt>Concepto</dt><dd>${esc(mv.concepto)}</dd><dt>Origen</dt><dd>${origen}</dd>
      <dt>Forma de pago</dt><dd>${esc(mv.forma_pago)}</dd><dt>Monto</dt><dd><b style="color:${mv.tipo === 'ingreso' ? 'var(--ok)' : 'var(--bad)'}">${signo}</b></dd></dl>
    ${accion ? `<p class="small muted" style="margin-top:1rem">${accion}.</p>` : ''}`,
    `${ejecutar ? `<button class="btn danger" id="anular">${mv.venta_id || mv.orden_id || mv.cc_movimiento_id ? 'Anular' : 'Eliminar'}</button>` : ''}${esManual ? '<button class="btn" id="editar">Editar</button>' : ''}${ir}<button class="btn primary" data-close>Cerrar</button>`);
  const irBtn = $('#ir', m.el);
  if (irBtn) irBtn.onclick = () => { m.close(); ventaModal(mv.venta_id); };
  const an = $('#anular', m.el);
  if (an) an.onclick = () => run(async () => {
    if (!confirm(`¿Confirmás? ${accion}.`)) return;
    await ejecutar(); m.close(); toast('Listo'); render();
  });
  const ed = $('#editar', m.el);
  if (ed) ed.onclick = () => { m.close(); editarMovCajaModal(mv); };
}

function editarMovCajaModal(mv) {
  let forma = mv.forma_pago;
  const m = modal(`Editar ${mv.tipo === 'ingreso' ? 'ingreso' : 'egreso'} de caja`, `
    <div class="field"><label>Concepto</label><input class="input" id="concepto" value="${esc(mv.concepto)}"></div>
    <div class="row"><div class="field"><label>Monto</label><input class="input" id="monto" type="number" step="any" min="0" value="${mv.monto}"></div>
    <div class="field"><label>Forma de pago</label><div class="pay-opts">${FORMAS_PAGO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div></div></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); });
  $('#ok', m.el).onclick = () => run(async () => {
    const concepto = $('#concepto', m.el).value.trim(), monto = +$('#monto', m.el).value;
    if (!concepto || !(monto > 0)) return toast('Completá concepto y monto', true);
    await store.editarMovimientoCaja(mv.id, { concepto, monto, forma_pago: forma });
    m.close(); toast('Movimiento actualizado'); render();
  });
}

// =====================================================================
// FICHERO (cuentas corrientes de clientes)
// =====================================================================
ROUTES.fichero = async ({ id }) => {
  if (id) return cuentaCliente(+id);
  const saldos = await store.ccSaldos();
  const deudores = saldos.filter(s => s.saldo > 0.009);
  const total = deudores.reduce((s, d) => s + +d.saldo, 0);
  const aFavor = saldos.filter(s => s.saldo < -0.009);
  view().innerHTML = `
  <div class="page-head"><h1>Fichero</h1><div class="actions"><button class="btn primary" id="cargar">+ Cargar deuda manual</button></div></div>
  <div class="grid grid-3" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Total adeudado</div><div class="value" style="color:${total ? 'var(--bad)' : 'inherit'}">${money(total)}</div></div>
    <div class="card kpi"><div class="label">Clientes que deben</div><div class="value">${deudores.length}</div></div>
    <div class="card kpi"><div class="label">Saldos a favor del cliente</div><div class="value">${money(-aFavor.reduce((s, d) => s + +d.saldo, 0))}</div><div class="sub">${aFavor.length} cliente(s)</div></div>
  </div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar cliente"></div></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Debe desde</th><th>Último movimiento</th><th class="num">Saldo</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
  <p class="small muted" style="margin-top:.8rem">Las ventas y los services entregados con forma de pago "Cuenta corriente" se cargan acá automáticamente.</p>`;
  const paint = t => {
    const l = [...deudores, ...aFavor].filter(d => matches(t, d.nombre, d.telefono));
    $('#rows').innerHTML = l.map(d => `<tr class="click" data-href="#/fichero/${d.cliente_id}"><td><b>${esc(d.nombre)}</b></td><td>${esc(d.telefono)}</td>
      <td>${d.saldo > 0 ? `${fdate(d.deuda_desde)} <span class="small muted">(${daysSince(d.deuda_desde)} d)</span>` : '—'}</td><td>${fdate(d.ultimo_movimiento)}</td>
      <td class="num"><b style="color:${d.saldo > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(d.saldo)}</b></td>
      <td class="right">${d.saldo > 0 ? `<button class="btn sm ok" data-cobrar="${d.cliente_id}">Cobrar</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="6" class="empty">${t ? 'Sin resultados.' : 'Nadie debe nada 🎉'}</td></tr>`;
    bindRowLinks();
    $$('[data-cobrar]').forEach(b => b.onclick = e => { e.stopPropagation(); const d = deudores.find(x => x.cliente_id === +b.dataset.cobrar); cobrarModal(d.cliente_id, d.nombre, +d.saldo, render); });
  };
  $('#buscar').oninput = e => paint(e.target.value);
  $('#cargar').onclick = () => cargoManualModal();
  paint('');
};

async function cuentaCliente(clienteId) {
  const [c, movs] = await Promise.all([store.cliente(clienteId), store.ccMovimientos(clienteId)]);
  if (!c) { view().innerHTML = '<div class="empty">Cliente no encontrado</div>'; return; }
  const saldo = movs.reduce((s, m) => s + +m.monto, 0);
  // saldo acumulado línea por línea (de la más vieja a la más nueva)
  let acum = 0;
  const conSaldo = movs.slice().reverse().map(m => ({ ...m, acum: (acum += +m.monto) })).reverse();
  const TIPO = { cargo: ['Cargo', 'amber'], pago: ['Pago', 'green'], ajuste: ['Ajuste', 'gray'] };
  view().innerHTML = `
  <div class="page-head"><div><a href="#/fichero" class="small muted">← Fichero</a><h1>${esc(c.nombre)}</h1></div>
    <div class="actions"><a class="btn" href="#/clientes/${c.id}">Ficha del cliente</a><button class="btn" id="cargo">+ Cargar deuda</button>
      <button class="btn ok" id="cobrar" ${saldo > 0 ? '' : 'disabled'}>Cobrar</button></div></div>
  <div class="grid grid-3" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Saldo</div><div class="value" style="color:${saldo > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(saldo)}</div><div class="sub">${saldo > 0 ? 'adeuda' : saldo < 0 ? 'a favor del cliente' : 'al día'}</div></div>
    <div class="card kpi"><div class="label">Total cargado</div><div class="value">${money(movs.filter(m => m.tipo === 'cargo').reduce((s, m) => s + +m.monto, 0))}</div></div>
    <div class="card kpi"><div class="label">Total pagado</div><div class="value">${money(-movs.filter(m => m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + +m.monto, 0))}</div></div>
  </div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
    ${conSaldo.map(m => `<tr><td class="nowrap">${fdatetime(m.fecha)}</td><td><span class="pill ${TIPO[m.tipo][1]}">${TIPO[m.tipo][0]}</span>${m.anulado ? ' <span class="pill red">Anulado</span>' : ''}</td>
      <td>${esc(m.concepto)}${m.forma_pago ? ` <span class="small muted">· ${esc(m.forma_pago)}</span>` : ''}
        ${m.venta_id ? ` <a href="#" class="small" data-venta="${m.venta_id}">ver venta</a>` : ''}${m.orden_id ? ` <a class="small" href="#/service/${m.orden_id}">ver orden</a>` : ''}</td>
      <td class="num">${m.monto > 0 ? money(m.monto) : ''}</td><td class="num">${m.monto < 0 ? money(-m.monto) : ''}</td><td class="num"><b>${money(m.acum)}</b></td>
      <td class="right nowrap">${m.tipo === 'pago' && !m.anulado ? `<button class="btn sm" data-recibo="${m.id}">Recibo</button> <button class="btn sm danger" data-anular="${m.id}">Anular</button>`
        : m.tipo === 'cargo' && !m.venta_id && !m.orden_id ? `<button class="btn sm" data-editar-cargo="${m.id}">Editar</button> <button class="btn sm danger" data-eliminar-cargo="${m.id}">Eliminar</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Sin movimientos.</td></tr>'}</tbody></table></div>`;
  $('#cobrar').onclick = () => cobrarModal(c.id, c.nombre, saldo, render);
  $('#cargo').onclick = () => cargoManualModal(c.id);
  $$('[data-venta]').forEach(a => a.onclick = e => { e.preventDefault(); ventaModal(+a.dataset.venta); });
  $$('[data-recibo]').forEach(b => b.onclick = () => run(() => imprimirRecibo(c.id, +b.dataset.recibo)));
  $$('[data-anular]').forEach(b => b.onclick = () => run(async () => {
    if (!confirm('¿Anular este cobro? La deuda vuelve a la cuenta y se descuenta de caja.')) return;
    await store.anularCobroCuenta(+b.dataset.anular); toast('Cobro anulado'); render();
  }));
  $$('[data-editar-cargo]').forEach(b => b.onclick = () => {
    const mv = movs.find(x => x.id === +b.dataset.editarCargo);
    editarCargoModal(mv, () => render());
  });
  $$('[data-eliminar-cargo]').forEach(b => b.onclick = () => run(async () => {
    if (!confirm('¿Eliminar este cargo? Se resta del saldo del cliente.')) return;
    await store.eliminarCargoManual(+b.dataset.eliminarCargo); toast('Cargo eliminado'); render();
  }));
}

function editarCargoModal(mv, onDone) {
  const m = modal('Editar cargo', `
    <div class="field"><label>Concepto</label><input class="input" id="concepto" value="${esc(mv.concepto)}"></div>
    <div class="field"><label>Monto</label><input class="input" type="number" step="any" min="0" id="monto" value="${mv.monto}"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const concepto = $('#concepto', m.el).value.trim(), monto = +$('#monto', m.el).value;
    if (!concepto || !(monto > 0)) return toast('Completá concepto y monto', true);
    await store.editarCargoManual(mv.id, { concepto, monto });
    m.close(); toast('Cargo actualizado'); onDone();
  });
}

function cobrarModal(clienteId, nombre, saldo, onDone) {
  let forma = 'Efectivo';
  const m = modal(`Cobrar a ${nombre}`, `
    <dl class="kv" style="margin-bottom:1rem"><dt>Saldo adeudado</dt><dd><b style="color:var(--bad)">${money(saldo)}</b></dd></dl>
    <div class="field"><label>Monto a cobrar</label><input class="input" type="number" step="any" min="0" id="monto" value="${saldo > 0 ? saldo : ''}">
      <div class="small muted" style="margin-top:.3rem">Podés cobrar el total o una parte.</div></div>
    <div class="field"><label>Forma de pago</label><div class="pay-opts">${FORMAS_PAGO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div></div>
    <div class="field"><label>Nota (opcional)</label><input class="input" id="nota" placeholder="ej: entrega a cuenta"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="ok">Registrar cobro</button>`);
  $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); });
  $('#monto', m.el).select();
  $('#ok', m.el).onclick = () => run(async () => {
    const monto = +$('#monto', m.el).value;
    if (!(monto > 0)) return toast('Ingresá el monto a cobrar', true);
    if (monto > saldo + 0.009 && !confirm(`El monto supera la deuda (${money(saldo)}). La diferencia queda a favor del cliente. ¿Continuar?`)) return;
    const ccId = await store.cobrarCuenta(clienteId, { monto, forma_pago: forma, nota: $('#nota', m.el).value.trim() });
    m.close(); onDone();
    const r = modal('Cobro registrado', `<div class="empty" style="padding:1rem"><div class="total-box">${money(monto)}</div><div class="muted">${esc(forma)} · ${esc(nombre)}</div></div>`,
      `<button class="btn" data-close>Cerrar</button><button class="btn primary" id="rec">Imprimir recibo</button>`);
    $('#rec', r.el).onclick = () => run(() => imprimirRecibo(clienteId, ccId));
  });
}

// Recibo de pago de cuenta corriente (ticket), con saldo anterior y saldo actual
async function imprimirRecibo(clienteId, ccId) {
  const [c, movs, n] = await Promise.all([store.cliente(clienteId), store.ccMovimientos(clienteId), store.negocio()]);
  const cron = movs.slice().reverse();                // de la más vieja a la más nueva
  const i = cron.findIndex(m => m.id === +ccId);
  if (i < 0) throw new Error('No se encontró el pago');
  const pago = cron[i];
  const saldoActual = cron.slice(0, i + 1).reduce((s, m) => s + +m.monto, 0);
  const saldoAnterior = saldoActual - +pago.monto;    // el pago tiene monto negativo
  const esAnticipo = !!pago.orden_id;
  printHTML(`<div class="ticket">
    <div class="c big">${esc(n.nombre)}</div><div class="c">${esc(n.direccion)}<br>${esc(n.telefono)}</div><hr>
    <div class="c"><b>RECIBO DE PAGO</b><br>${esAnticipo ? 'Anticipo de service' : 'Cuenta corriente'}</div><hr>
    <div>Recibo N° ${pago.id}<br>${fdatetime(pago.fecha)}<br>Cliente: ${esc(c.nombre)}${c.dni_cuit ? `<br>DNI/CUIT: ${esc(c.dni_cuit)}` : ''}</div><hr>
    <div>Concepto: ${esc(pago.concepto)}</div>
    <table><tr><td>Forma de pago</td><td style="text-align:right">${esc(pago.forma_pago)}</td></tr></table><hr>
    <table>
      <tr><td>Saldo anterior</td><td style="text-align:right">${money(saldoAnterior)}</td></tr>
      <tr><td class="big">PAGADO</td><td class="big" style="text-align:right">${money(-pago.monto)}</td></tr>
      <tr><td><b>Saldo actual</b></td><td style="text-align:right"><b>${money(saldoActual)}</b></td></tr>
    </table>${pago.anulado ? '<div class="c big">*** ANULADO ***</div>' : ''}<hr>
    <div class="c">${saldoActual > 0.009 ? 'Queda un saldo pendiente.' : saldoActual < -0.009 ? 'Queda saldo a su favor.' : 'Cuenta al día. ¡Gracias!'}<br>Documento no válido como factura.</div></div>`, PAGINA_TICKET);
}

function anticipoModal(o, onDone) {
  let forma = 'Efectivo';
  const m = modal(`Anticipo — orden #${o.numero}`, `
    <p class="small muted" style="margin-top:-.4rem">Plata que el cliente ya pagó a cuenta de esta orden (por ejemplo, al confirmar el presupuesto). Entra a caja ahora y se descuenta del total al entregar el equipo.</p>
    <div class="field"><label>Monto</label><input class="input" type="number" step="any" min="0" id="monto"></div>
    <div class="field"><label>Forma de pago</label><div class="pay-opts">${FORMAS_PAGO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div></div>
    <div class="field"><label>Nota (opcional)</label><input class="input" id="nota" placeholder="ej: comprobante de transferencia"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="ok">Registrar anticipo</button>`);
  $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); });
  $('#monto', m.el).focus();
  $('#ok', m.el).onclick = () => run(async () => {
    const monto = +$('#monto', m.el).value;
    if (!(monto > 0)) return toast('Ingresá el monto del anticipo', true);
    await store.registrarAnticipoOrden(o.id, { monto, forma_pago: forma, nota: $('#nota', m.el).value.trim() });
    m.close(); toast(`Anticipo registrado · ${money(monto)}`); onDone();
  });
}

// Deuda cargada a mano (ej: saldo que ya traía de antes, un trabajo no registrado como venta)
async function cargoManualModal(clienteId = null) {
  const clientes = clienteId ? [] : await store.clientes();
  const m = modal('Cargar deuda manual', `
    ${clienteId ? '' : `<div class="field"><label>Cliente *</label><select class="input" id="cli"><option value="">Elegí un cliente…</option><option value="__nuevo">+ Cliente nuevo…</option>
      ${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select></div>`}
    <div class="field"><label>Monto *</label><input class="input" type="number" step="any" min="0" id="monto"></div>
    <div class="field"><label>Concepto *</label><input class="input" id="concepto" placeholder="ej: Saldo anterior, trabajo a domicilio"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Cargar</button>`);
  const cliSel = $('#cli', m.el);
  if (cliSel) cliSel.onchange = () => {
    if (cliSel.value !== '__nuevo') return;
    cliSel.value = '';
    clienteModal(null, c => { const o = new Option(c.nombre, c.id, true, true); cliSel.add(o, cliSel.options.length - 1); });
  };
  $('#ok', m.el).onclick = () => run(async () => {
    const cid = clienteId || +$('#cli', m.el).value, monto = +$('#monto', m.el).value, concepto = $('#concepto', m.el).value.trim();
    if (!cid || !(monto > 0) || !concepto) return toast('Completá cliente, monto y concepto', true);
    await store.cargarDeuda(cid, { monto, concepto });
    m.close(); toast('Deuda cargada'); cid === clienteId ? render() : go(`#/fichero/${cid}`);
  });
}

// =====================================================================
// PROVEEDORES
// =====================================================================
ROUTES.proveedores = async () => {
  const [proveedores, compras] = await Promise.all([store.proveedores(), store.compras()]);
  const stats = id => { const cs = compras.filter(c => c.proveedor_id === id); return { n: cs.length, total: cs.reduce((s, c) => s + +c.total, 0), ultima: cs[0]?.fecha }; };
  view().innerHTML = `
  <div class="page-head"><h1>Proveedores</h1><div class="actions"><button class="btn primary" id="nuevo">+ Nuevo proveedor</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por nombre, CUIT, teléfono o email"></div></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Proveedor</th><th>CUIT</th><th>Contacto</th><th class="num">Compras</th><th class="num">Total comprado</th><th>Última compra</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const paint = t => {
    $('#rows').innerHTML = proveedores.filter(p => matches(t, p.nombre, p.cuit, p.telefono, p.email)).map(p => {
      const s = stats(p.id);
      return `<tr><td><b>${esc(p.nombre)}</b>${p.notas ? `<div class="small muted">${esc(p.notas)}</div>` : ''}</td><td>${esc(p.cuit) || '—'}</td>
        <td class="small">${[p.telefono, p.email].filter(Boolean).map(esc).join('<br>') || '—'}</td>
        <td class="num">${s.n}</td><td class="num">${money(s.total)}</td><td>${s.ultima ? fdate(s.ultima) : '—'}</td>
        <td class="right nowrap"><button class="btn sm" data-edit="${p.id}">Editar</button> <button class="btn sm danger" data-del="${p.id}">Eliminar</button></td></tr>`;
    }).join('') || `<tr><td colspan="7" class="empty">${t ? 'Sin resultados.' : 'Todavía no hay proveedores.'}</td></tr>`;
    $$('[data-edit]').forEach(b => b.onclick = () => proveedorModal(() => render(), proveedores.find(p => p.id === +b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = () => run(async () => {
      const p = proveedores.find(x => x.id === +b.dataset.del), s = stats(p.id);
      if (!confirm(`¿Eliminar a ${p.nombre}?${s.n ? `\n\nTiene ${s.n} compra(s) registradas: no se borran, quedan como "sin proveedor".` : ''}`)) return;
      await store.eliminarProveedor(p.id); toast('Proveedor eliminado'); render();
    }));
  };
  $('#buscar').oninput = e => paint(e.target.value);
  $('#nuevo').onclick = () => proveedorModal(() => render());
  paint('');
};

// =====================================================================
// COMPRAS (ingreso de mercadería) Y PROVEEDORES
// =====================================================================
// Borrador de la compra en curso: sobrevive si se cambia de pestaña a mitad de la carga
let compraDraft = null;
const nuevoDraft = () => ({ proveedor_id: '', nro_comprobante: '', notas: '', items: [] });

ROUTES.compras = async ({ id }) => {
  if (id === 'nueva') return nuevaCompra();
  const [compras, proveedores, productos] = await Promise.all([store.compras(), store.proveedores(), store.productos()]);
  const provName = id => proveedores.find(p => p.id === id)?.nombre || '—';
  const enCurso = compraDraft && compraDraft.items.length;
  view().innerHTML = `
  <div class="page-head"><h1>Compras y proveedores</h1><div class="actions"><button class="btn" id="prov">+ Proveedor</button>
    <a class="btn primary" href="#/compras/nueva">${enCurso ? `${compraDraft.editId ? 'Continuar edición' : 'Continuar carga'} (${compraDraft.items.length})` : 'Ingresar mercadería'}</a></div></div>
  <div class="split">
    <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Ítems</th><th class="num">Total</th></tr></thead><tbody>
      ${compras.map(c => `<tr class="click" data-compra="${c.id}"><td>${fdate(c.fecha)}</td><td>${esc(provName(c.proveedor_id))}</td><td>${esc(c.nro_comprobante) || '—'}</td>
        <td class="small">${c.items.map(i => `${i.cantidad}× ${esc(productos.find(p => p.id === i.producto_id)?.nombre || '')}`).join(', ')}</td><td class="num">${money(c.total)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Todavía no se registraron compras. Usá "Ingresar mercadería" cuando llegue un pedido: suma el stock y actualiza costos y precios.</td></tr>'}</tbody></table></div>
    <div class="card card-pad"><h2>Proveedores</h2>${proveedores.map(p => `<div class="equipo"><b>${esc(p.nombre)}</b><div class="small muted">${esc(p.cuit)} ${p.telefono ? '· ' + esc(p.telefono) : ''}</div></div>`).join('') || '<div class="muted small">Sin proveedores.</div>'}</div>
  </div>`;
  $('#prov').onclick = () => proveedorModal(() => render());
  $$('tr[data-compra]').forEach(tr => tr.onclick = () => compraModal(compras.find(c => c.id === +tr.dataset.compra), productos, provName));
};

function compraModal(c, productos, provName) {
  const prod = id => productos.find(p => p.id === id);
  const m = modal(`Compra #${c.id}`, `
    <dl class="kv" style="margin-bottom:1rem"><dt>Fecha</dt><dd>${fdatetime(c.fecha)}</dd><dt>Proveedor</dt><dd>${esc(provName(c.proveedor_id))}</dd>
      <dt>Comprobante</dt><dd>${esc(c.nro_comprobante) || '—'}</dd>${c.notas ? `<dt>Notas</dt><dd>${esc(c.notas)}</dd>` : ''}</dl>
    <table class="tbl"><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Costo unit.</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${c.items.map(i => `<tr><td>${esc(prod(i.producto_id)?.nombre || '(producto eliminado)')}<div class="small muted mono">${esc(prod(i.producto_id)?.codigo_barras || '')}</div></td>
        <td class="num">${i.cantidad}</td><td class="num">${money(i.costo_unitario)}</td><td class="num">${money(i.cantidad * i.costo_unitario)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b></td><td class="num"><b>${money(c.total)}</b></td></tr></tbody></table>`,
    `<button class="btn danger" id="del">Eliminar</button><button class="btn" id="edit">Editar</button><button class="btn primary" data-close>Cerrar</button>`, { wide: true });

  $('#edit', m.el).onclick = () => {
    if (compraDraft?.items.length && !confirm('Tenés otra carga de compra sin terminar. ¿Descartarla para editar esta?')) return;
    compraDraft = {
      editId: c.id, proveedor_id: c.proveedor_id ? String(c.proveedor_id) : '', nro_comprobante: c.nro_comprobante || '', notas: c.notas || '',
      items: c.items.map(i => { const p = prod(i.producto_id) || {};
        return { producto_id: i.producto_id, nombre: p.nombre || '(producto eliminado)', codigo_barras: p.codigo_barras || '', stock: p.stock ?? 0,
          cantidad: +i.cantidad, costo_unitario: +i.costo_unitario, precio_venta: +p.precio_venta || 0, precio_venta_orig: +p.precio_venta || 0 }; }),
    };
    m.close(); go('#/compras/nueva');
  };
  $('#del', m.el).onclick = () => run(async () => {
    const detalle = c.items.map(i => `• ${i.cantidad} × ${prod(i.producto_id)?.nombre || ''}`).join('\n');
    if (!confirm(`¿Eliminar la compra #${c.id}?\n\nSe va a RESTAR del stock lo que había sumado:\n${detalle}`)) return;
    await store.eliminarCompra(c.id);
    m.close(); toast('Compra eliminada · stock corregido'); render();
  });
}

function proveedorModal(onSaved, p = null) {
  const v = p || { nombre: '', cuit: '', telefono: '', email: '', notas: '' };
  const m = modal(p ? 'Editar proveedor' : 'Nuevo proveedor', `<div class="field"><label>Nombre *</label><input class="input" name="nombre" value="${esc(v.nombre)}"></div>
    <div class="row"><div class="field"><label>CUIT</label><input class="input" name="cuit" value="${esc(v.cuit)}"></div><div class="field"><label>Teléfono</label><input class="input" name="telefono" value="${esc(v.telefono)}"></div></div>
    <div class="field"><label>Email</label><input class="input" name="email" value="${esc(v.email)}"></div>
    <div class="field"><label>Notas</label><input class="input" name="notas" value="${esc(v.notas)}" placeholder="ej: vendedor, días de entrega, cuenta bancaria"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el); if (!f.nombre) return toast('Falta el nombre', true);
    const r = await store.guardarProveedor({ ...(p ? { id: p.id } : {}), ...f }); m.close(); toast('Proveedor guardado'); onSaved(r);
  });
}

async function nuevaCompra() {
  const [proveedores, productos, cats] = await Promise.all([store.proveedores(), store.productos(), store.categorias()]);
  compraDraft ??= nuevoDraft();
  const d = compraDraft;

  view().innerHTML = `
  <div class="page-head"><div><a href="#/compras" class="small muted">← Compras</a><h1>${d.editId ? `Editar compra #${d.editId}` : 'Ingresar mercadería'}</h1></div>
    <div class="actions"><button class="btn danger" id="descartar">${d.editId ? 'Cancelar edición' : 'Descartar'}</button></div></div>
  ${d.editId ? '<div class="small" style="background:var(--warn-soft);padding:.6rem .8rem;border-radius:8px;margin-bottom:1rem">Al guardar, el stock se corrige según la diferencia con lo cargado originalmente.</div>' : ''}
  <div class="card card-pad" style="margin-bottom:1rem">
    <div class="row">
      <div class="field"><label>Proveedor</label><select class="input" id="prov"><option value="">— Sin especificar —</option>
        ${proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}<option value="__nuevo">+ Nuevo proveedor…</option></select></div>
      <div class="field"><label>N° de factura / remito</label><input class="input" id="nro" value="${esc(d.nro_comprobante)}"></div>
    </div>
  </div>
  <div class="card card-pad">
    <div class="search" style="position:relative;margin-bottom:.8rem">
      <input class="input scan-input" id="b" placeholder="Escaneá el código o buscá el producto por nombre…" autocomplete="off">
      <div class="suggest" id="s" hidden></div>
    </div>
    <div class="tbl-wrap" id="its"></div>
    <div class="row" style="margin-top:1rem;align-items:flex-end">
      <div class="field" style="flex:2"><label>Notas</label><input class="input" id="notas" value="${esc(d.notas)}" placeholder="(opcional)"></div>
      <div class="field right" style="flex:1"><div class="small muted">Total de la compra</div><div class="total-box" id="total"></div></div>
    </div>
    <button class="btn ok lg block" id="registrar">${d.editId ? 'Guardar cambios' : 'Registrar compra'}</button>
  </div>`;

  const prov = $('#prov');
  prov.value = d.proveedor_id;
  prov.onchange = () => {
    if (prov.value !== '__nuevo') { d.proveedor_id = prov.value; return; }
    prov.value = d.proveedor_id;
    proveedorModal(p => { d.proveedor_id = String(p.id); nuevaCompra(); });
  };
  $('#nro').oninput = e => d.nro_comprobante = e.target.value;
  $('#notas').oninput = e => d.notas = e.target.value;

  const margen = i => i.costo_unitario > 0 && i.precio_venta > 0 ? Math.round((i.precio_venta / i.costo_unitario - 1) * 100) + '%' : '—';
  function paint() {
    const total = d.items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0);
    $('#its').innerHTML = d.items.length ? `<table class="tbl"><thead><tr><th>Producto</th><th style="width:90px">Cantidad</th><th style="width:130px">Costo unit.</th>
      <th style="width:130px">Precio venta</th><th class="num">Margen</th><th class="num">Subtotal</th><th></th></tr></thead><tbody>
      ${d.items.map((i, k) => `<tr><td>${esc(i.nombre)}${i.nuevo ? ' <span class="pill blue">nuevo</span>' : ''}<div class="small muted mono">${esc(i.codigo_barras)} · stock actual ${i.stock}</div></td>
        <td><input class="input" data-k="${k}" data-f="cantidad" value="${i.cantidad}" inputmode="decimal"></td>
        <td><input class="input" data-k="${k}" data-f="costo_unitario" value="${i.costo_unitario}" inputmode="decimal"></td>
        <td><input class="input" data-k="${k}" data-f="precio_venta" value="${i.precio_venta}" inputmode="decimal"></td>
        <td class="num muted">${margen(i)}</td><td class="num">${money(i.cantidad * i.costo_unitario)}</td>
        <td><button class="x" data-d="${k}" title="Quitar">×</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Escaneá o buscá los productos que llegaron. Si alguno no existe, lo podés crear desde el buscador.</div>';
    $$('[data-f]').forEach(inp => inp.onchange = () => {
      const v = +String(inp.value).replace(',', '.');
      d.items[+inp.dataset.k][inp.dataset.f] = inp.dataset.f === 'cantidad' ? Math.max(0.01, v || 1) : Math.max(0, v || 0);
      paint();
    });
    $$('[data-d]').forEach(bt => bt.onclick = () => { d.items.splice(+bt.dataset.d, 1); paint(); });
    $('#total').textContent = money(total);
    $('#registrar').disabled = !d.items.length;
  }

  function addP(p, extra = {}) {
    const ex = d.items.find(i => i.producto_id === p.id);
    if (ex) ex.cantidad++;
    else d.items.push({ producto_id: p.id, nombre: p.nombre, codigo_barras: p.codigo_barras, stock: p.stock, cantidad: 1,
      costo_unitario: +p.precio_costo || 0, precio_venta: +p.precio_venta || 0, precio_venta_orig: +p.precio_venta || 0, ...extra });
    b.value = ''; s.hidden = true; paint(); b.focus();
  }
  function crearProducto(texto) {
    s.hidden = true;
    const esCodigo = /^\d{6,14}$/.test(texto);
    productoModal(null, {
      sinStock: true,
      prefill: esCodigo ? { codigo_barras: texto } : { nombre: texto },
      onSaved: p => { productos.push(p); addP(p, { nuevo: true }); },
    });
  }

  const b = $('#b'), s = $('#s');
  let results = [], sel = 0;
  const paintSug = () => {
    const t = b.value.trim();
    s.innerHTML = results.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}">${prodSugHTML(p, cats, { costo: true })}</div>`).join('')
      + `<div class="${sel === results.length ? 'sel' : ''}" data-nuevo><span><b>+ Crear producto nuevo</b> «${esc(t)}»</span></div>`;
    $$('[data-i]', s).forEach(x => x.onmousedown = e => { e.preventDefault(); addP(results[+x.dataset.i]); });
    $('[data-nuevo]', s).onmousedown = e => { e.preventDefault(); crearProducto(t); };
  };
  b.oninput = () => {
    const t = b.value.trim();
    if (!t) { s.hidden = true; return; }
    results = buscarProductos(productos, cats, t, p => !p.es_servicio);
    sel = 0; s.hidden = false; paintSug();
  };
  b.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length); paintSug(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paintSug(); e.preventDefault(); }
    if (e.key === 'Escape') s.hidden = true;
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = b.value.trim(); if (!t) return;
    const exact = productos.find(p => p.codigo_barras === t);
    if (exact) return addP(exact);
    if (sel < results.length) return addP(results[sel]);
    crearProducto(t);  // código escaneado que no existe → alta directa
  };
  b.onblur = () => setTimeout(() => s.hidden = true, 150);

  $('#descartar').onclick = () => {
    if (d.items.length && !confirm(d.editId ? '¿Cancelar la edición? La compra queda como estaba.' : '¿Descartar esta carga? Se pierden los productos agregados.')) return;
    compraDraft = null; go('#/compras');
  };
  $('#registrar').onclick = () => run(async () => {
    if (!d.items.length) return toast('No agregaste productos', true);
    const btn = $('#registrar'); btn.disabled = true;
    try {
      const datos = { proveedor_id: d.proveedor_id ? +d.proveedor_id : null, nro_comprobante: d.nro_comprobante.trim(), notas: d.notas.trim(),
        items: d.items.map(({ producto_id, cantidad, costo_unitario }) => ({ producto_id, cantidad, costo_unitario })) };
      if (d.editId) await store.editarCompra(d.editId, datos);
      else await store.registrarCompra(datos);
      for (const i of d.items.filter(i => i.precio_venta !== i.precio_venta_orig)) await store.guardarProducto({ id: i.producto_id, precio_venta: i.precio_venta });
    } finally { btn.disabled = false; }
    const n = d.items.length; compraDraft = null;
    toast(d.editId ? 'Compra actualizada · stock corregido' : `Compra registrada · ${n} producto(s) con stock actualizado`); go('#/compras');
  });

  paint();
  b.focus();
}

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
  if (!iniciada) { window.addEventListener('hashchange', render); store.escucharRespuestas(avisarRespuesta); iniciada = true; }
  render();
}
iniciar();
