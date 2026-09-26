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
// Códigos de barras: sin distinguir mayúsculas (algunos lectores devuelven "AHRX93708" en vez de "ahrx93708")
const mismoCodigo = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Stock bajo = hay que reponer: solo productos con un mínimo definido (> 0) y stock en el mínimo o por debajo.
// Los de mínimo 0 no se reponen automáticamente (se ven con el filtro "Sin stock").
const faltaStock = p => !p.es_servicio && +p.stock_minimo > 0 && +p.stock <= +p.stock_minimo;

// Precios: redondeo hacia arriba al múltiplo elegido en Ajustes (mismo criterio que la base, 27_margen_y_precios.sql)
const redondearPrecio = (v, m) => +m > 0 ? Math.ceil(Math.round(v * 100) / 100 / m) * m : Math.round(v * 100) / 100;
const precioPorMargen = (costo, margen, redondeo = 1) => redondearPrecio(costo * (1 + margen / 100), redondeo);
const margenDe = p => +p.precio_costo > 0 && +p.precio_venta > 0 ? (p.precio_venta / p.precio_costo - 1) * 100 : null;

// Búsqueda de productos: por nombre, marca, categoría, descripción o código.
// Orden: código exacto → nombre que empieza con lo buscado → nombre que lo contiene → resto;
// con stockPrimero, dentro de cada grupo van primero los que tienen stock.
// Devuelve hasta `limite` resultados; en .total queda cuántos coincidían en total.
const MAX_SUGERENCIAS = 50;
function buscarProductos(productos, cats, t, filtro = () => true, { stockPrimero = false, limite = MAX_SUGERENCIAS } = {}) {
  const tn = norm(t).trim();
  const todos = productos.filter(p => filtro(p) && (mismoCodigo(p.codigo_barras, t)
    || matches(t, p.nombre, p.marca, p.descripcion, p.codigo_barras, cats.find(c => c.id === p.categoria_id)?.nombre)));
  const rango = p => mismoCodigo(p.codigo_barras, t) ? 0 : norm(p.nombre).startsWith(tn) ? 1 : norm(p.nombre).includes(tn) ? 2 : 3;
  const conStock = p => stockPrimero && !p.es_servicio && p.stock <= 0 ? 1 : 0;
  todos.sort((a, b) => rango(a) - rango(b) || conStock(a) - conStock(b) || a.nombre.localeCompare(b.nombre));
  const r = todos.slice(0, limite);
  r.total = todos.length;
  return r;
}
// Pie de la lista de resultados cuando hay más de los que se muestran
const masResultados = r => r.total > r.length
  ? `<div class="muted small" style="cursor:default;background:#fafbfc">y ${r.total - r.length} más: escribí algo más específico (ej: marca + modelo)</div>` : '';

// Contenido de un resultado de búsqueda con todos los datos, para no confundir productos parecidos
function prodSugHTML(p, cats, { costo = false } = {}) {
  const extra = [p.marca, cats.find(c => c.id === p.categoria_id)?.nombre].filter(Boolean).map(esc).join(' · ');
  const stockCls = p.stock <= 0 ? 'color:var(--bad)' : faltaStock(p) ? 'color:var(--warn)' : '';
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
  // Clic afuera cierra; pero no si el clic fue en la barra de desplazamiento (antes se perdía lo cargado)
  bg.addEventListener('mousedown', e => { if (e.target === bg && e.clientX < bg.clientWidth) close(); });
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  setTimeout(() => $('input:not([type=hidden]),select,textarea', bg)?.focus(), 30);
  return { el: bg, close };
}
const formData = el => Object.fromEntries($$('[name]', el).map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value.trim()]));

// Achica una foto (máx. 900 px de lado) y la pasa a JPEG, para que la tienda cargue rápido y no gaste espacio
function achicarImagen(archivo, max = 900) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(archivo);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : mal(new Error('No se pudo procesar la imagen')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('El archivo no es una imagen válida')); };
    img.src = url;
  });
}

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
  ['inicio', 'Inicio'], ['vender', 'Vender'], ['service', 'Service'], ['productos', 'Productos'], ['compras', 'Compras'], ['pedidos', 'Pedidos'],
  ['encargos', 'Encargos'], ['clientes', 'Clientes'], ['proveedores', 'Proveedores'], ['fichero', 'Fichero'], ['caja', 'Caja'],
  ['reportes', 'Reportes'], ['tienda', 'Tienda'], ['ajustes', 'Ajustes'],
];
// Rol del usuario: 'admin' (todo) o 'tienda' (solo la pestaña Tienda; la base no le deja ver nada más)
let ROL = 'admin';
const soloTienda = () => ROL === 'tienda';
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
  if (soloTienda() && r.name !== 'tienda') { history.replaceState(null, '', '#/tienda'); r.name = 'tienda'; r.id = undefined; r.q = new URLSearchParams(); }
  // Si se sale de Vender a mitad de la edición de una venta, la edición se cancela:
  // así, al volver a Vender, nunca se guarda una venta nueva encima de una vieja.
  if (r.name !== 'vender' && cart.editId) {
    toast(`Se canceló la edición de la venta #${cart.editNumero}: quedó como estaba`);
    cart = carritoVacio();
  }
  $$('nav.tabs a').forEach(a => a.classList.toggle('active', a.dataset.r === (r.name === 'inventario' ? 'productos' : r.name)));
  const fn = ROUTES[r.name] || ROUTES.inicio;
  view().innerHTML = '<div class="empty">Cargando…</div>';
  await run(() => fn(r));
  window.scrollTo(0, 0);
  if (!soloTienda()) actualizarContador();
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
  // Solicitudes de la tienda pendientes de revisar
  const n = await store.solicitudesWeb().then(l => l.length).catch(() => 0);
  const e = $('nav.tabs a[data-r=encargos]');
  if (e) e.innerHTML = `Encargos${n ? ` <span class="badge" title="Solicitudes de la tienda para revisar">${n}</span>` : ''}`;
}

// Entró una solicitud desde la tienda: aviso con sonido. Si el cliente la cancela, el aviso desaparece.
async function avisarSolicitud(id) {
  const s = (await store.solicitudesWeb().catch(() => [])).find(x => x.id === id);
  if (!s) return;
  let pila = $('#avisos');
  if (!pila) { pila = document.createElement('div'); pila.id = 'avisos'; document.body.appendChild(pila); }
  const el = document.createElement('div');
  el.className = 'aviso ok'; el.dataset.solicitud = id;
  el.innerHTML = `<button class="x" title="Cerrar">×</button>
    <div class="small muted">Nueva solicitud desde la tienda</div>
    <div style="margin:.2rem 0 .6rem"><b>🛒 ${esc(s.nombre)}</b> pidió ${s.items.length} producto(s) · ${money(s.total)}</div>
    <a class="btn sm ok" href="#/encargos">Revisar</a>`;
  $('.x', el).onclick = () => el.remove();
  $('a', el).onclick = () => el.remove();
  pila.prepend(el);
  sonido(); actualizarContador();
  if (parseHash().name === 'encargos') render();
}
function quitarAvisoSolicitud(id) {
  $(`[data-solicitud="${id}"]`)?.remove();
  actualizarContador();
  if (parseHash().name === 'encargos' && !$('.modal-bg')) render();
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
  const [ventas, ordenes, productos, caja, clientes, encargos] = await Promise.all([store.ventas(), store.ordenes(), store.productos(), store.cajaMovimientos(), store.clientes(), store.encargos().catch(() => [])]);
  const llegaron = encargos.filter(listoParaRetirar);
  const cliNombre = id => clientes.find(c => c.id === id)?.nombre;
  const hoy = ventas.filter(v => !v.anulada && isToday(v.fecha));
  const totalHoy = hoy.reduce((s, v) => s + v.total, 0);
  const efectivo = caja.filter(m => isToday(m.fecha) && m.forma_pago === 'Efectivo').reduce((s, m) => s + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0);
  const activas = ordenes.filter(ACTIVAS);
  const listas = ordenes.filter(o => o.estado === 'listo' || o.estado === 'sin_reparacion');
  const bajos = productos.filter(faltaStock);

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
  ${llegaron.length ? `<div class="card card-pad" style="margin-bottom:1rem;border-left:4px solid var(--accent)">
    <h2>Encargos y reservas para retirar <span class="badge" style="background:var(--accent)">${llegaron.length}</span> <a class="small" href="#/encargos?estado=listos">Ver →</a></h2>
    ${llegaron.map(e => `<div class="row small" style="align-items:center;padding:.35rem 0;border-top:1px solid var(--line)">
      <span><b>${e.tipo === 'reserva' ? 'Reserva' : 'Encargo'} N° ${e.numero}</b> · ${esc(quienEncarga(e))} · ${+e.cantidad !== 1 ? `${+e.cantidad} × ` : ''}${esc(e.descripcion)}</span>
      <span class="right">${reservaVencida(e) ? '<span class="pill red">reserva vencida</span> ' : ''}${e.fecha_aviso ? '<span class="pill gray">avisado</span>' : '<span class="pill amber">sin avisar</span>'}</span></div>`).join('')}</div>` : ''}
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
const carritoVacio = () => ({ items: [], cliente_id: '', descuento: 0, forma_pago: 'Efectivo', notas: '', editId: null, editNumero: null });
let cart = carritoVacio();

ROUTES.vender = async ({ q }) => {
  const [productos, clientes, cats, encargos] = await Promise.all([store.productos(), store.clientes(), store.categorias(), store.encargos().catch(() => [])]);
  // lo reservado para OTROS clientes (si esta venta es la entrega de una reserva, esa no cuenta)
  const reservadoOtros = pid => encargos.filter(e => e.estado === 'reservado' && e.producto_id === pid && e.id !== cart.encargoId).reduce((s, e) => s + +e.cantidad, 0);
  const disponibleDe = i => i.stock - reservadoOtros(i.producto_id);
  if (q.get('cliente')) cart.cliente_id = q.get('cliente');

  view().innerHTML = `
  <div class="page-head"><h1>${cart.editId ? `Editar venta #${cart.editNumero}` : 'Nueva venta'}</h1><div class="actions"><button class="btn" id="manual">+ Ítem manual</button><button class="btn danger" id="vaciar">${cart.editId ? 'Cancelar edición' : 'Vaciar'}</button></div></div>
  ${cart.editId ? `<div style="background:var(--warn-soft);border:2px solid var(--warn);padding:.8rem 1rem;border-radius:10px;margin-bottom:1rem">
    <b>✏️ Estás EDITANDO la venta #${cart.editNumero}${cart.orig?.clienteNombre ? ` de ${esc(cart.orig.clienteNombre)}` : ''}</b>, no haciendo una venta nueva.
    <div class="small" style="margin-top:.2rem">Al guardar, el stock y la caja/cuenta corriente se corrigen según la diferencia con la venta original.
    Si querías hacer una venta nueva, tocá <b>Cancelar edición</b>.</div></div>` : ''}
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
          <button class="btn" id="nuevo-cli" style="flex:0 0 auto" title="Nuevo cliente">+</button></div></div>
      <div class="field"><label>Forma de pago</label><div class="pay-opts" id="pagos">
        ${FORMAS_COBRO.map(f => `<button class="chip" data-f="${f}">${f}</button>`).join('')}</div></div>
      <div class="field"><label>Descuento ($)</label><input class="input" id="desc" type="number" min="0" step="any" value="${cart.descuento || ''}" placeholder="0"></div>
      <div class="field"><label>Observaciones <span class="muted">(interno, no sale en el comprobante)</span></label>
        <input class="input" id="obs" value="${esc(cart.notas)}" placeholder="ej: Retiró Juan Pérez · Paga el viernes"></div>
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
  $('#obs').oninput = e => cart.notas = e.target.value;

  function add(p) {
    const line = cart.items.find(i => i.producto_id === p.id);
    if (line) line.cantidad++;
    else cart.items.push({ producto_id: p.id, descripcion: p.nombre, cantidad: 1, precio_unitario: p.precio_venta, stock: p.stock, es_servicio: p.es_servicio });
    scan.value = ''; sug.hidden = true; paintCart(); scan.focus();
  }
  let results = [], sel = 0;
  const paintSug = () => {
    sug.innerHTML = (results.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}">${prodSugHTML(p, cats)}</div>`).join('')
      || '<div class="muted">Sin resultados</div>') + masResultados(results);
    $$('[data-i]', sug).forEach(d => d.onmousedown = e => { e.preventDefault(); add(results[+d.dataset.i]); });
    $('.sel', sug)?.scrollIntoView({ block: 'nearest' });
  };
  scan.oninput = () => {
    const t = scan.value.trim();
    if (!t) { sug.hidden = true; return; }
    results = buscarProductos(productos, cats, t, undefined, { stockPrimero: true });
    sel = 0; sug.hidden = false; paintSug();
  };
  scan.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, results.length - 1); paintSug(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paintSug(); e.preventDefault(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = scan.value.trim(); if (!t) return;
      const exact = productos.find(p => mismoCodigo(p.codigo_barras, t));
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
        <div class="small muted">${money(i.precio_unitario)} c/u${!i.es_servicio && i.producto_id && i.cantidad > disponibleDe(i) ? ` · <span style="color:var(--bad)">disponible: ${Math.max(disponibleDe(i), 0)}${reservadoOtros(i.producto_id) ? ` (${reservadoOtros(i.producto_id)} reservado/s para otros clientes)` : ''}</span>` : ''}</div></div>
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
      cart = carritoVacio(); go('#/caja'); return;
    }
    cart = carritoVacio(); render();
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
    const sinStock = cart.items.filter(i => i.producto_id && !i.es_servicio && i.cantidad > disponibleDe(i));
    if (sinStock.length && !confirm(`Hay ${sinStock.length} producto(s) sin stock disponible suficiente según el sistema (contando lo reservado para otros clientes). ¿Registrar la venta igual?`)) return;
    if (cart.editId) {
      // Si cambia el cliente o el total, pedir confirmación explícita con el antes y el después
      const o = cart.orig || {};
      const nuevoCli = cart.cliente_id ? clientes.find(c => c.id === +cart.cliente_id)?.nombre : 'Consumidor final';
      const nuevoTotal = cart.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0) - (+cart.descuento || 0);
      const cambios = [
        String(o.cliente_id || '') !== String(cart.cliente_id || '') ? `• Cliente: ${o.clienteNombre || 'Consumidor final'} → ${nuevoCli}` : '',
        o.total != null && Math.abs(o.total - nuevoTotal) > 0.009 ? `• Total: ${money(o.total)} → ${money(nuevoTotal)}` : '',
      ].filter(Boolean);
      if (cambios.length && !confirm(`Vas a MODIFICAR la venta #${cart.editNumero} (no es una venta nueva):\n\n${cambios.join('\n')}\n\n¿Confirmás?`)) return;
      await store.editarVenta(cart.editId, { cliente_id: cart.cliente_id ? +cart.cliente_id : null, items: cart.items, descuento: cart.descuento, forma_pago: cart.forma_pago, notas: (cart.notas || '').trim() });
      cart = carritoVacio();
      toast('Venta actualizada'); go('#/caja'); return;
    }
    const v = await store.registrarVenta({ cliente_id: cart.cliente_id ? +cart.cliente_id : null, items: cart.items, descuento: cart.descuento, forma_pago: cart.forma_pago, notas: (cart.notas || '').trim() });
    // Si la venta salió de un encargo, queda entregado
    if (cart.encargoId) await store.actualizarEncargo(cart.encargoId, { estado: 'entregado', fecha_entrega: new Date().toISOString() }).catch(() => toast('La venta se registró, pero no se pudo marcar el encargo como entregado', true));
    cart = carritoVacio();
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
    <dt>Forma de pago</dt><dd>${esc(v.forma_pago)}</dd>${v.anulada ? '<dt>Estado</dt><dd><span class="pill red">Anulada</span></dd>' : ''}
    ${v.notas ? `<dt>Observaciones</dt><dd>📝 ${esc(v.notas)}</dd>` : ''}</dl>
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
      editId: v.id, editNumero: v.numero, cliente_id: v.cliente_id ? String(v.cliente_id) : '', descuento: +v.descuento || 0, forma_pago: v.forma_pago, notas: v.notas || '',
      orig: { cliente_id: v.cliente_id, clienteNombre: v.cliente?.nombre || '', total: +v.total },
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

// Orden de la tabla de Productos (se recuerda al volver a la pantalla)
let ordenProductos = { col: 'nombre', dir: 1 };
ROUTES.productos = async ({ q }) => {
  const [productos, categorias, proveedores, encargos, ultimoAjuste, neg] = await Promise.all([store.productos(), store.categorias(), store.proveedores(),
    store.encargos().catch(() => []), store.ultimoAjustePrecios().catch(() => null), store.negocio()]);
  const puedeDeshacer = ultimoAjuste && Date.now() - new Date(ultimoAjuste.fecha) < 7 * 86400000;
  const reservados = reservasPorProducto(encargos);
  let filtro = q.get('bajo') ? 'bajo' : 'todos', texto = '', prov = q.get('prov') || '';
  const provName = id => proveedores.find(p => p.id === id)?.nombre || '';
  const aRevisar = p => (p.descripcion || '').startsWith('⚠');
  view().innerHTML = `
  <div class="page-head"><h1>Productos y stock <span class="muted small">(${productos.length})</span></h1><div class="actions">
    <a class="btn" href="#/inventario">Carga rápida de stock</a><a class="btn" href="tienda.html" target="_blank" rel="noopener">Ver tienda ↗</a>
    <button class="btn" id="pub-sel" hidden>Publicar en tienda</button><button class="btn" id="ocu-sel" hidden>Ocultar de tienda</button>
    <button class="btn danger" id="del-sel" hidden>Eliminar seleccionados</button>
    ${puedeDeshacer ? `<button class="btn" id="deshacer-precios" title="${esc(ultimoAjuste.detalle)} · ${fdatetime(ultimoAjuste.fecha)}">↶ Deshacer último aumento</button>` : ''}
    <button class="btn" id="precios">Actualizar precios <span id="nsel3"></span></button>
    <button class="btn" id="pedido">Armar pedido <span id="nsel2"></span></button>
    <button class="btn" id="etiquetas">Imprimir etiquetas <span id="nsel"></span></button><button class="btn primary" id="nuevo">+ Nuevo producto</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="row" style="align-items:center">
    <div class="search" style="flex:3"><input class="input" id="buscar" placeholder="Buscar por nombre, marca, proveedor o código (también podés escanear)"></div>
    <select class="input" id="prov" style="flex:1"><option value="">Todos los proveedores</option>${proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></div></div>
  <div class="chips" id="cats"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr id="cabecera"></tr></thead><tbody id="rows"></tbody></table></div>`;

  const catName = id => categorias.find(c => c.id === id)?.nombre || '';
  // Columnas ordenables: clic en el encabezado ordena; otro clic invierte el orden
  const COLS = [['codigo', 'Código', ''], ['nombre', 'Producto', ''], ['categoria', 'Categoría', ''], ['stock', 'Stock', 'num'], ['costo', 'Costo', 'num'], ['margen', 'Margen', 'num'], ['precio', 'Precio', 'num']];
  const VALOR = { codigo: p => p.codigo_barras || '', nombre: p => p.nombre, categoria: p => catName(p.categoria_id), stock: p => p.es_servicio ? -Infinity : +p.stock,
    costo: p => +p.precio_costo, margen: p => margenDe(p) ?? -Infinity, precio: p => +p.precio_venta };
  const ordenar = l => {
    const f = VALOR[ordenProductos.col] || VALOR.nombre, d = ordenProductos.dir;
    return l.sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'string' ? x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' }) : x - y) * d || a.nombre.localeCompare(b.nombre); });
  };
  const pintarCabecera = () => {
    $('#cabecera').innerHTML = `<th style="width:32px"><input type="checkbox" id="all"></th>` + COLS.map(([k, l, cls]) =>
      `<th class="${cls}" data-ord="${k}" style="cursor:pointer;user-select:none;white-space:nowrap" title="Ordenar por ${l.toLowerCase()}">${l}${ordenProductos.col === k ? (ordenProductos.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    $$('#cabecera [data-ord]').forEach(th => th.onclick = () => {
      ordenProductos = { col: th.dataset.ord, dir: ordenProductos.col === th.dataset.ord ? -ordenProductos.dir : 1 };
      paint();
    });
    $('#all').onchange = e => { lista().forEach(p => e.target.checked ? prodSel.add(p.id) : prodSel.delete(p.id)); paint(); };
  };
  const nRevisar = productos.filter(aRevisar).length;
  const chips = [['todos', 'Todos'], ['bajo', 'Stock bajo'], ['sinstock', 'Sin stock'], ['ocultos', 'Ocultos en tienda'], ['sinfoto', 'Sin foto'], ...(nRevisar ? [['revisar', `⚠ A revisar (${nRevisar})`]] : []), ...categorias.map(c => [String(c.id), c.nombre])];
  const lista = () => productos.filter(p => (filtro === 'todos' || (filtro === 'bajo' ? faltaStock(p) : filtro === 'sinstock' ? (!p.es_servicio && p.stock <= 0) : filtro === 'ocultos' ? p.publicado === false : filtro === 'sinfoto' ? (!p.es_servicio && !p.foto_url) : filtro === 'revisar' ? aRevisar(p) : p.categoria_id === +filtro))
    && (!prov || p.proveedor_id === +prov)
    && (mismoCodigo(p.codigo_barras, texto) || matches(texto, p.nombre, p.marca, p.descripcion, p.codigo_barras, catName(p.categoria_id), provName(p.proveedor_id))));
  function paint() {
    $('#cats').innerHTML = chips.map(([k, l]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-k="${k}">${esc(l)}</button>`).join('');
    $$('#cats .chip').forEach(c => c.onclick = () => { filtro = c.dataset.k; paint(); });
    pintarCabecera();
    const l = ordenar(lista());
    $('#rows').innerHTML = l.map(p => `<tr class="click" data-id="${p.id}">
      <td><input type="checkbox" data-sel="${p.id}" ${prodSel.has(p.id) ? 'checked' : ''}></td>
      <td class="mono small">${esc(p.codigo_barras)}${p.codigo_interno ? ' <span class="pill blue" title="Código generado por GScom">int</span>' : ''}</td>
      <td>${esc(p.nombre)}${p.foto_url ? ' <span title="Tiene foto">📷</span>' : ''}${p.publicado === false ? ' <span class="pill gray" title="No se muestra en la tienda online">oculto</span>' : ''}${p.marca || p.descripcion || p.proveedor_id ? `<div class="small muted">${[p.marca, p.descripcion, provName(p.proveedor_id) && `Prov.: ${provName(p.proveedor_id)}`].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</td><td class="muted">${esc(catName(p.categoria_id))}</td>
      <td class="num">${p.es_servicio ? '<span class="muted">—</span>' : `<span class="pill ${p.stock <= 0 ? 'red' : faltaStock(p) ? 'amber' : 'green'}">${p.stock}</span>${reservados.get(p.id) ? `<div class="small" style="color:#6b3fc4" title="Reservado para clientes">${reservados.get(p.id)} reserv.</div>` : ''}`}</td>
      <td class="num muted">${money(p.precio_costo)}</td>
      <td class="num nowrap">${margenDe(p) == null ? '<span class="muted">—</span>' : `${Math.round(margenDe(p))}%`}${p.margen != null ? ' <span class="pill blue" title="El precio de venta se calcula con el margen">auto</span>' : ''}</td>
      <td class="num"><b>${money(p.precio_venta)}</b></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">No hay productos que coincidan.</td></tr>';
    $$('#rows tr[data-id]').forEach(tr => tr.onclick = e => { if (e.target.matches('input')) return; productoModal(+tr.dataset.id); });
    $$('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? prodSel.add(+cb.dataset.sel) : prodSel.delete(+cb.dataset.sel); paintSel(); });
    paintSel();
  }
  const paintSel = () => { $('#nsel').textContent = $('#nsel2').textContent = $('#nsel3').textContent = prodSel.size ? `(${prodSel.size})` : ''; ['#del-sel', '#pub-sel', '#ocu-sel'].forEach(b => $(b).hidden = !prodSel.size); };
  const publicarSel = publicado => run(async () => {
    const ids = [...prodSel].filter(id => productos.some(p => p.id === id));
    await store.publicarProductos(ids, publicado); prodSel.clear();
    toast(`${ids.length} producto(s) ${publicado ? 'publicados en' : 'ocultos de'} la tienda`); render();
  });
  $('#pub-sel').onclick = () => publicarSel(true);
  $('#ocu-sel').onclick = () => publicarSel(false);
  $('#del-sel').onclick = () => run(async () => {
    const ids = [...prodSel].filter(id => productos.some(p => p.id === id));
    if (!ids.length || !confirm(`¿Eliminar ${ids.length} producto(s)?\n\nLos que ya tengan ventas, compras o service se dan de baja (el historial se conserva) y liberan su código de barras.`)) return;
    let eliminados = 0, bajas = 0;
    for (const id of ids) { (await store.eliminarProducto(id)) === 'baja' ? bajas++ : eliminados++; prodSel.delete(id); }
    toast(`${eliminados} eliminado(s)${bajas ? ` · ${bajas} dado(s) de baja` : ''}`); render();
  });
  $('#buscar').oninput = e => { texto = e.target.value.trim(); paint(); };
  $('#prov').value = prov;
  $('#prov').onchange = e => { prov = e.target.value; paint(); };
  $('#nuevo').onclick = () => productoModal(null);
  $('#precios').onclick = () => preciosModal(productos, categorias, proveedores, neg.redondeo_precios ?? 1);
  if ($('#deshacer-precios')) $('#deshacer-precios').onclick = () => deshacerAjuste(ultimoAjuste);
  $('#etiquetas').onclick = () => etiquetasModal([...prodSel]);
  $('#pedido').onclick = () => armarPedido(prodSel.size ? [...prodSel] : lista().filter(faltaStock).map(p => p.id), productos);
  paint();
  $('#buscar').focus();
};

// Actualizar precios en bloque: a todos, a una categoría, a un proveedor o a los seleccionados.
// "Precio de venta" cambia los de precio fijo; "Costo" cambia el costo y los que van por margen recalculan su precio solos.
const REDONDEOS = [[1, '$1 (sin centavos)'], [10, '$10'], [50, '$50'], [100, '$100'], [500, '$500'], [0, 'Sin redondeo']];
function preciosModal(productos, categorias, proveedores, redondeo) {
  const sel = [...prodSel].filter(id => productos.some(p => p.id === id));
  const catName = id => categorias.find(c => c.id === id)?.nombre || '';
  const m = modal('Actualizar precios', `
    <div class="row" style="align-items:flex-end">
      <div class="field"><label>¿A qué productos?</label><select class="input" id="ap-ambito">
        <option value="buscar">Los que coinciden con una búsqueda (ej: router)</option>
        <option value="todos">Todos los productos (${productos.length})</option>
        ${sel.length ? `<option value="sel">Los seleccionados (${sel.length})</option>` : ''}
        <optgroup label="Una categoría">${categorias.map(c => `<option value="cat:${c.id}">${esc(c.nombre)} (${productos.filter(p => p.categoria_id === c.id).length})</option>`).join('')}</optgroup>
        <optgroup label="Un proveedor">${proveedores.map(p => `<option value="prov:${p.id}">${esc(p.nombre)} (${productos.filter(x => x.proveedor_id === p.id).length})</option>`).join('')}</optgroup></select></div>
      <div class="field" id="ap-q-f"><label>Que contengan</label><input class="input" id="ap-q" placeholder="ej: router · tóner hp · cable hdmi"></div></div>
    <div class="row">
      <div class="field"><label>¿Qué se aumenta?</label><select class="input" id="ap-campo"><option value="venta">Precio de venta</option><option value="costo">Costo (lista nueva del proveedor)</option></select></div>
      <div class="field"><label>¿Cómo?</label><select class="input" id="ap-modo"><option value="pct">Porcentaje (%)</option><option value="monto">Monto fijo ($)</option></select></div>
      <div class="field"><label id="ap-val-l">Porcentaje</label><input class="input" id="ap-val" type="number" step="any"></div></div>
    <div class="row" id="ap-red-f" style="align-items:flex-end">
      <div class="field" style="flex:0 0 240px"><label>Redondear el precio nuevo</label><select class="input" id="ap-red">${REDONDEOS.map(([v, l]) => `<option value="${v}" ${+v === +redondeo ? 'selected' : ''}>${v ? `Hacia arriba a ${l}` : l}</option>`).join('')}</select></div>
      <div class="field small muted" id="ap-red-ej" style="margin-bottom:1.1rem"></div></div>
    <div id="ap-prev" class="small" style="min-height:3rem"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ap-ok" disabled>Aplicar</button>`, { wide: true });
  if (sel.length) $('#ap-ambito', m.el).value = 'sel';

  const ambito = () => {
    const v = $('#ap-ambito', m.el).value, t = $('#ap-q', m.el).value.trim();
    return v === 'buscar' ? (t ? productos.filter(p => matches(t, p.nombre, p.marca, p.descripcion, p.codigo_barras, catName(p.categoria_id))) : [])
      : v === 'sel' ? productos.filter(p => sel.includes(p.id)) : v.startsWith('cat:') ? productos.filter(p => p.categoria_id === +v.slice(4))
      : v.startsWith('prov:') ? productos.filter(p => p.proveedor_id === +v.slice(5)) : productos;
  };
  const plan = () => {
    const campo = $('#ap-campo', m.el).value, modo = $('#ap-modo', m.el).value, val = +$('#ap-val', m.el).value, red = +$('#ap-red', m.el).value;
    const cambio = x => modo === 'monto' ? x + val : x * (1 + val / 100);
    const l = ambito();
    const afectados = l.filter(p => campo === 'venta' ? p.margen == null && +p.precio_venta > 0 && cambio(+p.precio_venta) > 0 : +p.precio_costo > 0 && cambio(+p.precio_costo) > 0);
    const nuevo = p => campo === 'venta' ? { costo: +p.precio_costo, venta: redondearPrecio(cambio(+p.precio_venta), red) }
      : { costo: Math.round(cambio(+p.precio_costo) * 100) / 100, venta: p.margen != null ? precioPorMargen(cambio(+p.precio_costo), p.margen, redondeo) : +p.precio_venta };
    const valido = modo === 'monto' ? !!val : !!val && val >= -90 && val <= 500;
    const texto = modo === 'monto' ? `${val > 0 ? '+' : '−'}${money(Math.abs(val))}` : `${val > 0 ? '+' : ''}${val}%`;
    return { campo, modo, val, red, l, afectados, nuevo, valido, texto, cambio };
  };
  const pintar = () => {
    const { campo, modo, val, l, afectados, nuevo, valido, texto, cambio } = plan();
    $('#ap-q-f', m.el).style.visibility = $('#ap-ambito', m.el).value === 'buscar' ? '' : 'hidden';
    $('#ap-val-l', m.el).textContent = modo === 'monto' ? 'Monto a sumar ($)' : 'Porcentaje';
    $('#ap-val', m.el).placeholder = modo === 'monto' ? 'ej: 500  (o -200 para bajar)' : 'ej: 10  (o -5 para bajar)';
    $('#ap-red-f', m.el).style.display = campo === 'venta' ? '' : 'none';
    // ejemplo concreto de qué hace el redondeo, con un producto real
    const ej = afectados[0], crudo = ej && val ? cambio(+ej.precio_venta) : null, red = +$('#ap-red', m.el).value;
    $('#ap-red-ej', m.el).innerHTML = crudo == null ? 'Evita precios "sucios" como $13.579,50 después de un aumento.'
      : `Ej.: ${esc(ej.nombre)} quedaría en ${money(crudo)}${redondearPrecio(crudo, red) !== Math.round(crudo * 100) / 100 ? ` → <b>${money(redondearPrecio(crudo, red))}</b>` : ''}`;
    const conMargen = l.filter(p => p.margen != null).length, fijos = afectados.filter(p => p.margen == null).length;
    const nota = campo === 'venta'
      ? (conMargen ? `<p class="muted">${conMargen} producto(s) tienen precio por margen: no cambian acá (su precio sigue al costo). Si el proveedor aumentó, elegí <b>Costo</b>.</p>` : '')
      : `<p class="muted">Los que van por margen (${afectados.length - fijos}) recalculan su precio de venta. Los de precio fijo (${fijos}) mantienen su precio: solo cambia el costo, y su margen ${val > 0 ? 'baja' : 'sube'}.</p>`;
    const buscando = $('#ap-ambito', m.el).value === 'buscar';
    $('#ap-prev', m.el).innerHTML = buscando && !$('#ap-q', m.el).value.trim() ? '<p class="muted">Escribí qué productos buscar (por ejemplo: router). Vas a ver la lista antes de aplicar.</p>'
      : !l.length ? '<p class="muted">No hay productos con ese criterio.</p>'
      : !val ? `<p class="muted">${l.length} producto(s). Poné ${modo === 'monto' ? 'el monto' : 'el porcentaje'} para ver cómo quedan.</p>` : `
      <p style="margin-bottom:.4rem">Se actualizan <b>${afectados.length}</b> de ${l.length} producto(s).</p>${nota}
      ${afectados.length ? `<div style="max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:.5rem"><table class="tbl"><thead><tr><th>Producto</th>${campo === 'costo' ? '<th class="num">Costo</th>' : ''}<th class="num">Precio de venta</th></tr></thead><tbody>
      ${afectados.map(p => { const n = nuevo(p); return `<tr><td>${esc(p.nombre)}<div class="small muted">${esc(catName(p.categoria_id))}</div></td>${campo === 'costo' ? `<td class="num nowrap">${money(p.precio_costo)} → <b>${money(n.costo)}</b></td>` : ''}
        <td class="num nowrap">${n.venta !== +p.precio_venta ? `${money(p.precio_venta)} → <b>${money(n.venta)}</b>` : `<span class="muted">${money(p.precio_venta)} (igual)</span>`}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;
    const ok = $('#ap-ok', m.el);
    ok.disabled = !valido || !afectados.length;
    ok.textContent = valido && afectados.length ? `Aplicar ${texto} a ${afectados.length} producto(s)` : 'Aplicar';
  };
  ['#ap-ambito', '#ap-campo', '#ap-modo', '#ap-red'].forEach(s => $(s, m.el).onchange = pintar);
  let t; $('#ap-q', m.el).oninput = () => { clearTimeout(t); t = setTimeout(pintar, 150); };
  $('#ap-val', m.el).oninput = pintar;
  $('#ap-ambito', m.el).addEventListener('change', () => { if ($('#ap-ambito', m.el).value === 'buscar') $('#ap-q', m.el).focus(); });
  pintar(); setTimeout(() => $(sel.length ? '#ap-val' : '#ap-q', m.el).focus(), 40);

  $('#ap-ok', m.el).onclick = () => run(async () => {
    const { campo, modo, val, red, afectados, texto } = plan();
    const opc = $('#ap-ambito', m.el);
    const donde = opc.value === 'buscar' ? `"${$('#ap-q', m.el).value.trim()}"` : opc.selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, '');
    const detalle = `${texto} al ${campo === 'venta' ? 'precio de venta' : 'costo'} · ${donde}`;
    if (!confirm(`¿Aplicar ${detalle} (${afectados.length} productos)?\n\nDespués lo podés deshacer.`)) return;
    const r = await store.ajustarPrecios(afectados.map(p => p.id), campo, modo === 'pct' ? val : 0, red, detalle, modo === 'monto' ? val : null);
    prodSel.clear();
    history.replaceState(null, '', '#/productos'); await render();   // refrescar sin cerrar el cartel de abajo
    const res = modal('Precios actualizados', `<p><b>${r.cantidad}</b> producto(s) actualizados: ${esc(detalle)}.</p>
      <p class="small muted" style="margin-top:.5rem">La tienda y la pantalla de Vender ya usan los precios nuevos. Si te equivocaste, podés deshacerlo (también desde el botón "Deshacer último aumento" en Productos, durante 7 días).</p>`,
      `<button class="btn" id="undo">↶ Deshacer</button><button class="btn primary" data-close>Listo</button>`);
    $('#undo', res.el).onclick = () => { res.close(); deshacerAjuste({ lote: r.lote, detalle, cantidad: r.cantidad }, true); };
  });
}
function deshacerAjuste(aj, sinPreguntar = false) {
  run(async () => {
    if (!sinPreguntar && !confirm(`¿Deshacer el último aumento?\n\n${aj.detalle} (${aj.cantidad} productos)\n\nLos productos cuyo precio se cambió después a mano quedan como están.`)) return;
    const n = await store.deshacerAjustePrecios(aj.lote);
    toast(`${n} precio(s) restaurado(s)`); render();
  });
}

// Foto del producto para la tienda: se sube al momento (no espera a Guardar). Lo usan Productos y Tienda.
const FOTO_HTML = `<div style="display:flex;gap:1rem;align-items:center"><div id="foto-prev"></div>
  <div><input type="file" accept="image/*" id="foto-file" hidden><button class="btn sm" id="foto-subir">Subir / cambiar foto</button> <button class="btn sm danger" id="foto-quitar">Quitar foto</button>
  <div class="small muted" style="margin-top:.3rem">Desde el celular podés sacarla con la cámara. Se achica sola antes de subirse.</div></div></div>`;
function controlFoto(el, id, foto = '', alCambiar = () => {}) {
  const pintarFoto = () => {
    $('#foto-prev', el).innerHTML = foto ? `<img src="${esc(foto)}" alt="" style="width:96px;height:96px;object-fit:contain;background:#fff;border:1px solid var(--line);border-radius:8px">`
      : '<div style="width:96px;height:96px;border:1px dashed var(--line);border-radius:8px;display:grid;place-items:center" class="small muted">Sin foto</div>';
    $('#foto-quitar', el).hidden = !foto;
  };
  pintarFoto();
  $('#foto-subir', el).onclick = () => $('#foto-file', el).click();
  $('#foto-file', el).onchange = ev => run(async () => {
    const archivo = ev.target.files[0]; if (!archivo) return;
    $('#foto-prev', el).innerHTML = '<div class="small muted" style="width:96px">Subiendo…</div>';
    try { foto = await store.subirFotoProducto(id, await achicarImagen(archivo), foto); alCambiar(foto); toast('Foto cargada'); } finally { pintarFoto(); ev.target.value = ''; }
  });
  $('#foto-quitar', el).onclick = () => run(async () => { if (!confirm('¿Quitar la foto?')) return; await store.quitarFotoProducto(id, foto); foto = ''; alCambiar(''); pintarFoto(); });
}

// opts.prefill: datos iniciales · opts.onSaved(producto): en vez de refrescar la pantalla · opts.sinStock: ocultar "Stock inicial"
async function productoModal(id, opts = {}) {
  const [p, categorias, proveedores, neg] = await Promise.all([id ? store.producto(id) : null, store.categorias(), store.proveedores(), store.negocio()]);
  const movs = id ? await store.movimientosStock(id) : [];
  const redondeo = neg.redondeo_precios ?? 1;
  const v = p || { nombre: '', codigo_barras: '', marca: '', descripcion: '', categoria_id: '', precio_costo: '', precio_venta: '', stock: '', stock_minimo: 1, es_servicio: false, ...opts.prefill };
  const m = modal(id ? 'Editar producto' : 'Nuevo producto', `
    <div class="field"><label>Nombre *</label><input class="input" name="nombre" value="${esc(v.nombre)}"></div>
    <div class="row"><div class="field"><label>Marca</label><input class="input" name="marca" value="${esc(v.marca)}"></div>
      <div class="field"><label>Categoría</label><select class="input" name="categoria_id"><option value="">—</option>${categorias.map(c => `<option value="${c.id}" ${c.id === v.categoria_id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}<option value="__nueva">+ Nueva categoría…</option></select></div></div>
    <div class="row"><div class="field" style="flex:2"><label>Descripción / detalle</label><input class="input" name="descripcion" value="${esc(v.descripcion)}" placeholder="ej: USB, negro, teclado en español · 1TB 7200rpm"></div>
      <div class="field"><label>Proveedor habitual</label><select class="input" name="proveedor_id"><option value="">—</option>${proveedores.map(pr => `<option value="${pr.id}" ${pr.id === v.proveedor_id ? 'selected' : ''}>${esc(pr.nombre)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Código de barras</label><input class="input mono" name="codigo_barras" value="${esc(v.codigo_barras)}" placeholder="Escaneá el código de fábrica, o dejalo vacío para generar uno interno">
      ${id ? `<div style="margin-top:.5rem">${barcodeSVG(v.codigo_barras, { height: 40 })}</div>` : ''}</div>
    <div class="row"><div class="field"><label>Precio de costo</label><input class="input" name="precio_costo" type="number" step="any" min="0" value="${v.precio_costo}"></div>
      <div class="field"><label>Precio de venta *</label><input class="input" name="precio_venta" type="number" step="any" min="0" value="${v.precio_venta}"></div>
      <div class="field"><label>Margen %</label><input class="input" name="margen" type="number" step="any" value="${v.margen ?? ''}"></div></div>
    <label class="small" style="display:flex;gap:.4rem;align-items:flex-start;margin:-.3rem 0 .9rem"><input type="checkbox" name="por_margen" ${v.margen != null ? 'checked' : ''} style="margin-top:.15rem">
      <span>Calcular el precio de venta con el margen <span class="muted">— se actualiza solo cuando cambia el costo (por ejemplo, al ingresar una compra)${redondeo > 1 ? `; se redondea hacia arriba a múltiplos de ${money(redondeo)}` : ''}</span></span></label>
    <div class="row">${id || opts.sinStock ? '' : `<div class="field"><label>Stock inicial</label><input class="input" name="stock" type="number" step="any" value="${v.stock}"></div>`}
      <div class="field"><label>Stock mínimo (alerta)</label><input class="input" name="stock_minimo" type="number" step="any" min="0" value="${v.stock_minimo}"></div></div>
    <label class="small" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.8rem"><input type="checkbox" name="es_servicio" ${v.es_servicio ? 'checked' : ''}> Es un servicio / mano de obra (no maneja stock)</label>
    <div class="card card-pad" style="background:#fafbfc;margin-bottom:.8rem"><h2 style="margin-bottom:.4rem">Tienda online</h2>
      <div style="display:flex;gap:1.2rem;flex-wrap:wrap"><label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" name="publicado" ${v.publicado !== false ? 'checked' : ''}> Mostrar en la tienda</label>
        <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" name="destacado" ${v.destacado ? 'checked' : ''}> ★ Destacado (aparece primero)</label></div>
      <div class="field" style="margin:.7rem 0 0"><label>Descripción para la web (la ven los clientes)</label><textarea class="input" name="descripcion_web" rows="2" placeholder="Si la dejás vacía, se muestra la descripción de arriba">${esc(v.descripcion_web || '')}</textarea></div>
      ${id ? `<div style="margin-top:.7rem">${FOTO_HTML}</div>` : '<p class="small muted" style="margin-top:.4rem">Guardá el producto para poder cargarle una foto.</p>'}</div>
    ${id && !v.es_servicio ? `<div class="card card-pad" style="background:#fafbfc"><h2 style="margin-bottom:.5rem">Stock</h2>
      <div class="field" style="max-width:160px"><label>Cantidad actual</label><input class="input" id="stock-actual" type="number" step="any" value="${v.stock}"></div>
      <p class="small muted" style="margin:.2rem 0 1rem">Corregila acá directamente (ej: después de un conteo físico) — se guarda al tocar "Guardar" y queda como un ajuste en el historial.</p>
      <div class="row" style="align-items:flex-end"><div class="field"><label>Ajuste rápido (+ entra / − sale)</label><input class="input" id="aj-cant" type="number" step="any" placeholder="ej: -1"></div>
      <div class="field"><label>Motivo</label><input class="input" id="aj-nota" placeholder="ej: rotura, conteo, devolución"></div>
      <div class="field" style="flex:0 0 auto"><button class="btn" id="aj-ok">Ajustar</button></div></div>
      <details><summary class="small muted" style="cursor:pointer">Ver movimientos (${movs.length})</summary>
      <table class="tbl small" style="margin-top:.5rem"><tbody>${movs.slice(0, 30).map(mv => `<tr><td>${fdatetime(mv.created_at)}</td><td>${esc(mv.tipo)}</td><td class="muted">${esc(mv.nota || '')}</td><td class="num"><b style="color:${mv.cantidad < 0 ? 'var(--bad)' : 'var(--ok)'}">${mv.cantidad > 0 ? '+' : ''}${mv.cantidad}</b></td></tr>`).join('')}</tbody></table></details></div>` : ''}`,
    `${id ? '<button class="btn danger" id="del" style="margin-right:auto">Eliminar</button><button class="btn" id="etq">Imprimir etiqueta</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);

  if (id) controlFoto(m.el, id, v.foto_url);
  const del = $('#del', m.el);
  if (del) del.onclick = () => run(async () => {
    if (!confirm(`¿Eliminar "${v.nombre}"?\n\nSi ya se vendió, compró o usó en un service, se da de baja (deja de aparecer, pero el historial se conserva) y su código de barras queda libre.`)) return;
    const r = await store.eliminarProducto(id);
    prodSel.delete(id); m.close(); toast(r === 'baja' ? 'Producto dado de baja (tenía historial)' : 'Producto eliminado'); render();
  });
  // Precio fijo: se escribe el precio y el margen se muestra. Por margen: se escribe el margen y el precio se calcula.
  const inCosto = $('[name=precio_costo]', m.el), inVenta = $('[name=precio_venta]', m.el), inMargen = $('[name=margen]', m.el), chkMargen = $('[name=por_margen]', m.el);
  const pintarPrecio = () => {
    const auto = chkMargen.checked, c = +inCosto.value;
    inVenta.readOnly = auto; inMargen.readOnly = !auto;
    inVenta.style.background = auto ? '#f4f5f7' : ''; inMargen.style.background = auto ? '' : '#f4f5f7';
    if (auto) { if (c > 0 && inMargen.value !== '') inVenta.value = precioPorMargen(c, +inMargen.value, redondeo); }
    else inMargen.value = c > 0 && +inVenta.value > 0 ? Math.round((+inVenta.value / c - 1) * 1000) / 10 : '';
  };
  [inCosto, inVenta, inMargen].forEach(i => i.oninput = pintarPrecio);
  chkMargen.onchange = () => { pintarPrecio(); if (chkMargen.checked) inMargen.select(); };
  pintarPrecio();
  $('[name=categoria_id]', m.el).onchange = async e => {
    if (e.target.value !== '__nueva') return;
    const nombre = prompt('Nombre de la nueva categoría'); if (!nombre) { e.target.value = ''; return; }
    const c = await store.crearCategoria(nombre.trim());
    const o = new Option(c.nombre, c.id, true, true); e.target.add(o, e.target.options.length - 1);
  };
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (f.por_margen && (!(+f.precio_costo > 0) || f.margen === '')) return toast('Para calcular el precio por margen cargá el costo y el margen', true);
    if (!f.nombre || f.precio_venta === '') return toast('Completá nombre y precio de venta', true);
    const data = { ...(id ? { id } : {}), publicado: f.publicado, destacado: f.destacado, descripcion_web: f.descripcion_web, nombre: f.nombre, marca: f.marca, descripcion: f.descripcion, proveedor_id: f.proveedor_id ? +f.proveedor_id : null, categoria_id: f.categoria_id && f.categoria_id !== '__nueva' ? +f.categoria_id : null,
      precio_costo: +f.precio_costo || 0, precio_venta: +f.precio_venta || 0, margen: f.por_margen ? +f.margen : null, stock_minimo: +f.stock_minimo || 0, es_servicio: f.es_servicio };
    data.codigo_barras = f.codigo_barras;
    if (!id) data.stock = +f.stock || 0;
    const r = await store.guardarProducto(data);
    const stockInput = $('#stock-actual', m.el);
    if (stockInput) {
      const diff = +stockInput.value - +v.stock;
      if (diff) await store.ajustarStock(id, diff, 'Corrección de stock');
    }
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

// Pedido de mercadería: se arma en su propia pantalla (Pedidos → nuevo).
// Borrador en memoria: sobrevive si se cambia de pestaña a mitad del armado.
let pedidoDraft = null;
function armarPedido(ids, productos) {
  const items = productos.filter(p => ids.includes(p.id) && !p.es_servicio);
  if (!items.length) return toast('No hay productos para pedir: marcá productos con las casillas, o cargales un stock mínimo para que aparezcan en "Stock bajo"', true);
  pedidoDraft ??= { notas: '', items: [] };
  items.forEach(p => {
    if (pedidoDraft.items.some(i => i.producto_id === p.id)) return;
    pedidoDraft.items.push({ producto_id: p.id, descripcion: p.nombre, marca: p.marca || '', codigo: p.codigo_barras || '', stock: p.stock, stock_minimo: p.stock_minimo,
      proveedor_id: p.proveedor_id ? String(p.proveedor_id) : '', habitual: p.proveedor_id ? String(p.proveedor_id) : '', cantidad: Math.max(p.stock_minimo - p.stock, 1) });
  });
  prodSel.clear();
  go('#/pedidos/nuevo');
}

// Hoja(s) A4 para imprimir: una por proveedor
async function imprimirPedidos(pedidos, proveedores) {
  const n = await store.negocio();
  const provName = id => proveedores.find(x => x.id === +id)?.nombre || 'Sin proveedor asignado';
  printHTML(pedidos.map((p, i) => `
    <div class="hoja-pedido" ${i < pedidos.length - 1 ? 'style="page-break-after:always"' : ''}>
      <div class="ped-head"><b>${esc(n.nombre)}</b><br>${esc(n.direccion)}${n.telefono ? ` · ${esc(n.telefono)}` : ''}</div>
      <h1>Pedido de mercadería${p.numero ? ` N° ${p.numero}` : ''}</h1>
      <div class="ped-sub">Proveedor: <b>${esc(provName(p.proveedor_id))}</b> · ${fdate(p.fecha || new Date().toISOString())}</div>
      ${p.notas ? `<div class="ped-sub">Notas: ${esc(p.notas)}</div>` : ''}
      <table class="ped-tbl"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th></tr></thead><tbody>
      ${p.items.map(i => `<tr><td class="mono">${esc(i.codigo)}</td><td>${esc(i.descripcion)}</td><td class="num"><b>${+i.cantidad}</b></td></tr>`).join('')}
      </tbody></table>
    </div>`).join(''), PAGINA_A4);
}

// =====================================================================
// CARGA RÁPIDA DE STOCK (inventario)
// Escribís la cantidad contada y Enter: se guarda y pasa al siguiente.
// Con lector: escaneás, carga la cantidad, Enter y vuelve al escáner.
// =====================================================================
ROUTES.inventario = async () => {
  const [todos, categorias, proveedores] = await Promise.all([store.productos(), store.categorias(), store.proveedores()]);
  const productos = todos.filter(p => !p.es_servicio);
  const catName = id => categorias.find(c => c.id === id)?.nombre || '';
  let texto = '', cat = '', prov = '', estado = 'sincontar', mostrar = 150, volverAlEscaner = false;
  const contado = p => !!p.ultimo_conteo;

  view().innerHTML = `
  <div class="page-head"><div><a href="#/productos" class="small muted">← Productos</a><h1>Carga rápida de stock</h1></div></div>
  <div class="card card-pad" style="margin-bottom:1rem">
    <div class="row small" style="align-items:center;margin-bottom:.4rem"><span id="progreso-txt"></span><span class="right muted">La tienda muestra la disponibilidad según el stock cargado (sin stock = "Por encargo")</span></div>
    <div style="height:10px;background:#eef0f3;border-radius:5px;overflow:hidden"><div id="progreso" style="height:100%;background:var(--ok);width:0;transition:width .3s"></div></div>
  </div>
  <div class="card card-pad" style="margin-bottom:1rem">
    <div class="search" style="margin-bottom:.8rem"><input class="input scan-input" id="scan" placeholder="Escaneá el código (o buscá por nombre) y cargá la cantidad" autocomplete="off"></div>
    <div class="row" style="align-items:center">
      <select class="input" id="cat"><option value="">Todas las categorías</option>${categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</select>
      <select class="input" id="prov"><option value="">Todos los proveedores</option>${proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select>
      <div class="chips" id="estados" style="margin:0"></div>
    </div>
    <p class="small muted" style="margin-top:.6rem">Escribí la cantidad que hay y tocá <b>Enter</b>: se guarda y salta al siguiente. Un 0 también cuenta (queda marcado como contado).</p>
  </div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th class="num">En sistema</th><th style="width:120px">Contado</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
  <div style="text-align:center;margin:1rem 0"><button class="btn" id="mas" hidden>Mostrar más</button></div>`;

  const lista = () => productos.filter(p => (!cat || p.categoria_id === +cat) && (!prov || p.proveedor_id === +prov)
    && (estado === 'todos' || (estado === 'contados' ? contado(p) : !contado(p)))
    && (!texto || mismoCodigo(p.codigo_barras, texto) || matches(texto, p.nombre, p.marca, p.codigo_barras)));
  const pintarProgreso = () => {
    const n = productos.filter(contado).length;
    $('#progreso-txt').innerHTML = `<b>${n}</b> de ${productos.length} productos contados`;
    $('#progreso').style.width = `${productos.length ? n / productos.length * 100 : 0}%`;
    $('#estados').innerHTML = [['sincontar', 'Sin contar', productos.length - n], ['contados', 'Contados', n], ['todos', 'Todos', productos.length]]
      .map(([k, l, c]) => `<button class="chip ${estado === k ? 'active' : ''}" data-e="${k}">${l}<span class="count">${c}</span></button>`).join('');
    $$('#estados .chip').forEach(b => b.onclick = () => { estado = b.dataset.e; mostrar = 150; pintar(); });
  };
  const marca = p => contado(p) ? `<span class="pill green" title="Contado el ${fdatetime(p.ultimo_conteo)}">✓ contado</span>` : '';
  function pintar() {
    const l = lista();
    $('#rows').innerHTML = l.slice(0, mostrar).map(p => `<tr data-id="${p.id}">
      <td class="mono small">${esc(p.codigo_barras)}</td><td>${esc(p.nombre)}${p.marca ? `<div class="small muted">${esc(p.marca)}</div>` : ''}</td>
      <td class="small muted">${esc(catName(p.categoria_id))}</td><td class="num" data-stock>${p.stock}</td>
      <td><input class="input" type="number" min="0" step="any" inputmode="numeric" data-cant="${p.id}" placeholder="${contado(p) ? p.stock : ''}"></td>
      <td data-marca>${marca(p)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${estado === 'sincontar' && !texto && !cat && !prov ? '🎉 ¡Todos los productos están contados!' : 'No hay productos con ese filtro.'}</td></tr>`;
    $('#mas').hidden = l.length <= mostrar;
    pintarProgreso();
    $$('[data-cant]').forEach(inp => {
      inp.onkeydown = e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        guardar(inp).then(() => {
          if (volverAlEscaner) { volverAlEscaner = false; $('#scan').value = ''; $('#scan').focus(); return; }
          const inputs = $$('[data-cant]'), i = inputs.indexOf(inp);
          (inputs[i + 1] || inp).focus(); inputs[i + 1]?.select();
        });
      };
      inp.onchange = () => guardar(inp);
    });
  }
  // Guarda si hay un número cargado; devuelve una promesa (para encadenar el salto al siguiente)
  const guardando = new Set();
  function guardar(inp) {
    const id = +inp.dataset.cant, v = inp.value.trim();
    if (v === '' || guardando.has(id)) return Promise.resolve();
    const cant = +v.replace(',', '.');
    if (!(cant >= 0)) { toast('Cargá una cantidad válida', true); return Promise.resolve(); }
    guardando.add(id);
    return run(async () => {
      await store.contarStock(id, cant);
      const p = productos.find(x => x.id === id); p.stock = cant; p.ultimo_conteo = new Date().toISOString();
      const tr = inp.closest('tr');
      tr.querySelector('[data-stock]').textContent = cant; tr.querySelector('[data-marca]').innerHTML = marca(p);
      inp.value = ''; inp.placeholder = cant; tr.style.background = 'var(--ok-soft)';
      pintarProgreso();
    }).finally(() => guardando.delete(id));
  }

  const scan = $('#scan'); let t;
  scan.oninput = () => { clearTimeout(t); t = setTimeout(() => { texto = scan.value.trim(); mostrar = 150; pintar(); }, 200); };
  scan.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); clearTimeout(t);
    const q = scan.value.trim(); if (!q) return;
    const p = productos.find(x => mismoCodigo(x.codigo_barras, q));
    if (!p) { texto = q; pintar(); const primero = $('[data-cant]'); if (primero) { primero.focus(); } else toast('No se encontró ese código', true); return; }
    // producto escaneado: mostrarlo aunque esté fuera del filtro, e ir a su cantidad
    texto = q; if (!lista().includes(p)) { cat = ''; prov = ''; estado = 'todos'; $('#cat').value = ''; $('#prov').value = ''; }
    pintar();
    const inp = $(`[data-cant="${p.id}"]`); volverAlEscaner = true; inp.focus(); inp.select();
  };
  $('#cat').onchange = e => { cat = e.target.value; mostrar = 150; pintar(); };
  $('#prov').onchange = e => { prov = e.target.value; mostrar = 150; pintar(); };
  $('#mas').onclick = () => { mostrar += 150; pintar(); };
  pintar();
  scan.focus();
};

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
    <label class="small" style="display:flex;gap:.4rem;align-items:center;margin-bottom:.8rem"><input type="checkbox" name="cuenta_corriente" ${v.cuenta_corriente ? 'checked' : ''}> Cliente de cuenta corriente (aparece en el Fichero aunque su saldo esté en $0)</label>
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
      <div class="detail">${v.items.map(i => `${i.cantidad > 1 ? i.cantidad + '× ' : ''}${esc(i.descripcion)}`).join(' · ')}${v.notas ? `<br>📝 ${esc(v.notas)}` : ''}</div>` })),
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
        ${c.cuenta_corriente ? `<dt>Cuenta corriente</dt><dd><a class="small" href="#/fichero/${c.id}">Sí · ver cuenta</a></dd>` : ''}
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
    const r = buscarProductos(productos, cats, t, undefined, { stockPrimero: true });
    sug.hidden = false;
    sug.innerHTML = (r.map(p => `<div data-id="${p.id}">${prodSugHTML(p, cats)}</div>`).join('') || '<div class="muted">Sin resultados</div>') + masResultados(r);
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
  const alDia = saldos.filter(s => Math.abs(s.saldo) <= 0.009).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  view().innerHTML = `
  <div class="page-head"><h1>Fichero</h1><div class="actions"><button class="btn primary" id="cargar">+ Cargar deuda manual</button></div></div>
  <div class="grid grid-3" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Total adeudado</div><div class="value" style="color:${total ? 'var(--bad)' : 'inherit'}">${money(total)}</div></div>
    <div class="card kpi"><div class="label">Clientes que deben</div><div class="value">${deudores.length}</div></div>
    <div class="card kpi"><div class="label">Saldos a favor del cliente</div><div class="value">${money(-aFavor.reduce((s, d) => s + +d.saldo, 0))}</div><div class="sub">${aFavor.length} cliente(s)</div></div>
  </div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar cliente"></div></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Debe desde</th><th>Último movimiento</th><th class="num">Saldo</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
  <p class="small muted" style="margin-top:.8rem">Incluye a quienes deben, tienen saldo a favor, o están marcados como "Cliente de cuenta corriente" aunque estén al día. Las ventas y los services entregados con forma de pago "Cuenta corriente" se cargan acá automáticamente.</p>`;
  const paint = t => {
    const l = [...deudores, ...aFavor, ...alDia].filter(d => matches(t, d.nombre, d.telefono));
    $('#rows').innerHTML = l.map(d => `<tr class="click" data-href="#/fichero/${d.cliente_id}"><td><b>${esc(d.nombre)}</b></td><td>${esc(d.telefono)}</td>
      <td>${d.saldo > 0.009 ? `${fdate(d.deuda_desde)} <span class="small muted">(${daysSince(d.deuda_desde)} d)</span>` : '—'}</td><td>${fdate(d.ultimo_movimiento)}</td>
      <td class="num"><b style="color:${d.saldo > 0.009 ? 'var(--bad)' : d.saldo < -0.009 ? 'var(--ok)' : 'inherit'}">${money(d.saldo)}</b></td>
      <td class="right">${d.saldo > 0.009 ? `<button class="btn sm ok" data-cobrar="${d.cliente_id}">Cobrar</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="6" class="empty">${t ? 'Sin resultados.' : 'Sin clientes de cuenta corriente todavía.'}</td></tr>`;
    bindRowLinks();
    $$('[data-cobrar]').forEach(b => b.onclick = e => { e.stopPropagation(); const d = deudores.find(x => x.cliente_id === +b.dataset.cobrar); run(() => cobrarModal(d.cliente_id, d.nombre, +d.saldo, render)); });
  };
  $('#buscar').oninput = e => paint(e.target.value);
  $('#cargar').onclick = () => cargoManualModal();
  paint('');
};

async function cuentaCliente(clienteId) {
  const [c, movs, imps] = await Promise.all([store.cliente(clienteId), store.ccMovimientos(clienteId), store.ccImputaciones(clienteId).catch(() => [])]);
  if (!c) { view().innerHTML = '<div class="empty">Cliente no encontrado</div>'; return; }
  const saldo = movs.reduce((s, m) => s + +m.monto, 0);
  const { grupos } = deudaPorConcepto(movs, imps);
  const pendientes = grupos.filter(g => g.pendiente > 0.009);
  // Total compras: total neto por venta/orden/cargo (ya corregido si se editó), no la suma bruta de todos los "cargo" cargados alguna vez
  const totalCompras = grupos.reduce((s, g) => s + g.total, 0);
  // saldo acumulado línea por línea (de la más vieja a la más nueva)
  let acum = 0;
  const conSaldo = movs.slice().reverse().map(m => ({ ...m, acum: (acum += +m.monto) })).reverse();
  const TIPO = { cargo: ['Cargo', 'amber'], pago: ['Pago', 'green'], ajuste: ['Ajuste', 'gray'] };
  view().innerHTML = `
  <div class="page-head"><div><a href="#/fichero" class="small muted">← Fichero</a><h1>${esc(c.nombre)}</h1></div>
    <div class="actions"><a class="btn" href="#/clientes/${c.id}">Ficha del cliente</a><button class="btn" id="cargo">+ Cargar deuda</button>
      <button class="btn ok" id="cobrar" ${saldo > 0 ? '' : 'disabled'}>Cobrar</button></div></div>
  <div class="grid grid-3" style="margin-bottom:1rem">
    <div class="card kpi"><div class="label">Total compras</div><div class="value">${money(totalCompras)}</div></div>
    <div class="card kpi"><div class="label">Total pagado</div><div class="value">${money(-movs.filter(m => m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + +m.monto, 0))}</div></div>
    <div class="card kpi"><div class="label">Saldo</div><div class="value" style="color:${saldo > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(saldo)}</div><div class="sub">${saldo > 0 ? 'adeuda' : saldo < 0 ? 'a favor del cliente' : 'al día'}</div></div>
  </div>
  ${pendientes.length ? `<div class="card card-pad" style="margin-bottom:1rem"><h2>Qué debe</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Concepto</th><th>Observaciones</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Pendiente</th><th></th></tr></thead><tbody>
    ${pendientes.map(g => `<tr><td class="nowrap">${fdate(g.fecha)}</td>
      <td>${esc(g.concepto)}${g.venta_id ? ` <a href="#" class="small" data-venta="${g.venta_id}">ver venta</a>` : ''}${g.orden_id ? ` <a class="small" href="#/service/${g.orden_id}">ver orden</a>` : ''}</td>
      <td class="small">${esc(g.notas)}</td><td class="num">${money(g.total)}</td><td class="num muted">${g.pagado > 0.009 ? money(g.pagado) : '—'}</td>
      <td class="num"><b style="color:var(--bad)">${money(g.pendiente)}</b></td>
      <td class="right"><button class="btn sm ok" data-cobrar-uno="${g.clave}">Cobrar este</button></td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  <h2 style="font-size:1rem;font-weight:600;margin:0 0 .6rem">Movimientos</h2>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Observaciones</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
    ${conSaldo.map(m => `<tr><td class="nowrap">${fdatetime(m.fecha)}</td><td><span class="pill ${TIPO[m.tipo][1]}">${TIPO[m.tipo][0]}</span>${m.anulado ? ' <span class="pill red">Anulado</span>' : ''}</td>
      <td>${esc(m.concepto)}${m.forma_pago ? ` <span class="small muted">· ${esc(m.forma_pago)}</span>` : ''}
        ${m.venta_id ? ` <a href="#" class="small" data-venta="${m.venta_id}">ver venta</a>` : ''}${m.orden_id ? ` <a class="small" href="#/service/${m.orden_id}">ver orden</a>` : ''}</td>
      <td class="small">${esc(m.venta?.notas || '')}</td>
      <td class="num">${m.monto > 0 ? money(m.monto) : ''}</td><td class="num">${m.monto < 0 ? money(-m.monto) : ''}</td><td class="num"><b>${money(m.acum)}</b></td>
      <td class="right nowrap">${m.tipo === 'pago' && !m.anulado ? `<button class="btn sm" data-recibo="${m.id}">Recibo</button> <button class="btn sm danger" data-anular="${m.id}">Anular</button>`
        : m.tipo === 'cargo' && !m.venta_id && !m.orden_id ? `<button class="btn sm" data-editar-cargo="${m.id}">Editar</button> <button class="btn sm danger" data-eliminar-cargo="${m.id}">Eliminar</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Sin movimientos.</td></tr>'}</tbody></table></div>`;
  $('#cobrar').onclick = () => run(() => cobrarModal(c.id, c.nombre, saldo, render));
  $$('[data-cobrar-uno]').forEach(b => b.onclick = () => run(() => cobrarModal(c.id, c.nombre, saldo, render, b.dataset.cobrarUno)));
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

// ---------------------------------------------------------------------
// Deuda por concepto: agrupa los movimientos de la cuenta por venta, orden
// de service o cargo manual, y reparte cada cobro entre esos conceptos:
// primero lo que el cobro indicó (imputaciones), el resto a lo más viejo.
// Devuelve { grupos, aplicaciones } — aplicaciones[pagoId] = [{ grupo, monto }].
// ---------------------------------------------------------------------
function deudaPorConcepto(movs, imps = []) {
  const cron = movs.slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
  const grupos = new Map(), aplicaciones = {};
  const claveDe = m => m.venta_id ? `venta:${m.venta_id}` : m.orden_id ? `orden:${m.orden_id}` : `cargo:${m.id}`;
  const grupo = (clave, m) => {
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha: m.fecha, concepto: m.concepto, venta_id: m.venta_id || null, orden_id: m.orden_id || null,
      notas: m.venta?.notas || '', total: 0, pagado: 0, pendiente: 0 });
    return grupos.get(clave);
  };
  for (const m of cron) {
    const monto = +m.monto;
    if (m.tipo === 'pago') {
      if (m.anulado) continue;                                  // su anulación lo compensa
      let resto = -monto; const apl = aplicaciones[m.id] = [];
      const aplicar = (g, max) => { const x = Math.min(max, resto); if (x <= 0.009) return; g.pendiente -= x; g.pagado += x; resto -= x; apl.push({ grupo: g.clave, monto: x }); };
      if (m.orden_id) { const g = grupo(`orden:${m.orden_id}`, m); if (!g.total) g.desdeAnticipo = true; aplicar(g, resto); }   // anticipo: va a su orden
      imps.filter(x => x.pago_id === m.id).forEach(x => { const g = grupos.get(x.grupo); if (g) aplicar(g, Math.min(+x.monto, Math.max(g.pendiente, 0))); });
      [...grupos.values()].filter(g => g.pendiente > 0.009).forEach(g => aplicar(g, g.pendiente));   // resto: a lo más viejo
      if (resto > 0.009) apl.push({ grupo: null, monto: resto });            // a favor del cliente
      continue;
    }
    if (m.tipo === 'ajuste' && !m.venta_id && !m.orden_id && /^Anulación de cobro/.test(m.concepto)) continue;
    const g = grupo(claveDe(m), m);
    if (m.tipo === 'cargo' && g.desdeAnticipo) { g.concepto = m.concepto.replace(/ \(aplica anticipo\)$/, ''); g.fecha = m.fecha; g.desdeAnticipo = false; }
    g.total += monto; g.pendiente += monto;
  }
  return { grupos: [...grupos.values()], aplicaciones };
}

// Cobro de cuenta corriente: elegir qué conceptos se pagan (todo, uno o parte) o un monto libre
async function cobrarModal(clienteId, nombre, saldo, onDone, preseleccion = null) {
  const [movs, imps] = await Promise.all([store.ccMovimientos(clienteId), store.ccImputaciones(clienteId).catch(() => [])]);
  const pendientes = deudaPorConcepto(movs, imps).grupos.filter(g => g.pendiente > 0.009);
  const sel = new Set(preseleccion ? [preseleccion] : pendientes.map(g => g.clave));
  let forma = 'Efectivo';
  const m = modal(`Cobrar a ${nombre}`, `
    <dl class="kv" style="margin-bottom:.8rem"><dt>Saldo adeudado</dt><dd><b style="color:var(--bad)">${money(saldo)}</b></dd></dl>
    ${pendientes.length ? `<div class="field"><label>¿Qué paga? <span class="muted">(marcá lo que corresponda)</span></label>
      <div class="card" style="max-height:230px;overflow:auto"><table class="tbl small"><tbody>
      ${pendientes.map(g => `<tr><td style="width:28px"><input type="checkbox" data-g="${g.clave}" ${sel.has(g.clave) ? 'checked' : ''}></td>
        <td>${esc(g.concepto)} <span class="muted">· ${fdate(g.fecha)}</span>${g.notas ? `<div class="muted">📝 ${esc(g.notas)}</div>` : ''}
          ${g.pagado > 0.009 ? `<div class="muted">de ${money(g.total)}, ya pagó ${money(g.pagado)}</div>` : ''}</td>
        <td class="num"><b>${money(g.pendiente)}</b></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="field"><label>Monto a cobrar</label><input class="input" type="number" step="any" min="0" id="monto">
      <div class="small muted" style="margin-top:.3rem" id="ayuda"></div></div>
    <div class="field"><label>Forma de pago</label><div class="pay-opts">${FORMAS_PAGO.map(f => `<button class="chip ${f === forma ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}</div></div>
    <div class="field"><label>Nota (opcional)</label><input class="input" id="nota" placeholder="ej: entrega a cuenta"></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn ok" id="ok">Registrar cobro</button>`, { wide: true });
  const inp = $('#monto', m.el), ayuda = $('#ayuda', m.el);
  const elegidos = () => pendientes.filter(g => sel.has(g.clave));
  const sumaSel = () => elegidos().reduce((s, g) => s + g.pendiente, 0);
  const pintarAyuda = () => {
    const monto = +inp.value || 0, s = sumaSel();
    ayuda.textContent = !sel.size ? 'Sin conceptos marcados: el pago se aplica a lo más viejo primero.'
      : monto < s - 0.009 ? `Pago parcial: se aplica a lo marcado, empezando por lo más viejo (quedan ${money(s - monto)} pendientes de lo marcado).`
      : monto > s + 0.009 ? `Supera lo marcado en ${money(monto - s)}: esa diferencia se aplica al resto de la deuda.`
      : `Cancela ${sel.size === pendientes.length ? 'toda la deuda' : `${sel.size} concepto(s)`}.`;
  };
  const alMarcar = () => { inp.value = +sumaSel().toFixed(2) || ''; pintarAyuda(); };
  $$('[data-g]', m.el).forEach(cb => cb.onchange = () => { cb.checked ? sel.add(cb.dataset.g) : sel.delete(cb.dataset.g); alMarcar(); });
  inp.oninput = pintarAyuda;
  $$('.pay-opts .chip', m.el).forEach(b => b.onclick = () => { forma = b.dataset.f; $$('.pay-opts .chip', m.el).forEach(x => x.classList.toggle('active', x === b)); });
  if (pendientes.length) alMarcar(); else { inp.value = saldo > 0 ? saldo : ''; pintarAyuda(); }
  inp.select();
  $('#ok', m.el).onclick = () => run(async () => {
    const monto = +inp.value;
    if (!(monto > 0)) return toast('Ingresá el monto a cobrar', true);
    if (monto > saldo + 0.009 && !confirm(`El monto supera la deuda (${money(saldo)}). La diferencia queda a favor del cliente. ¿Continuar?`)) return;
    // Imputación: lo cobrado se reparte entre lo marcado, de lo más viejo a lo más nuevo
    let resto = monto; const imputaciones = [];
    for (const g of elegidos()) { const x = Math.min(g.pendiente, resto); if (x > 0.009) { imputaciones.push({ grupo: g.clave, monto: +x.toFixed(2) }); resto -= x; } }
    const ccId = await store.cobrarCuenta(clienteId, { monto, forma_pago: forma, nota: $('#nota', m.el).value.trim(), imputaciones });
    m.close(); onDone();
    const r = modal('Cobro registrado', `<div class="empty" style="padding:1rem"><div class="total-box">${money(monto)}</div><div class="muted">${esc(forma)} · ${esc(nombre)}</div></div>`,
      `<button class="btn" data-close>Cerrar</button><button class="btn primary" id="rec">Imprimir recibo</button>`);
    $('#rec', r.el).onclick = () => run(() => imprimirRecibo(clienteId, ccId));
  });
}

// Recibo de pago de cuenta corriente (ticket): detalle de lo que se pagó, saldo anterior y actual
async function imprimirRecibo(clienteId, ccId) {
  const [c, movs, n, imps] = await Promise.all([store.cliente(clienteId), store.ccMovimientos(clienteId), store.negocio(), store.ccImputaciones(clienteId).catch(() => [])]);
  const cron = movs.slice().reverse();                // de la más vieja a la más nueva
  const i = cron.findIndex(m => m.id === +ccId);
  if (i < 0) throw new Error('No se encontró el pago');
  const pago = cron[i];
  const saldoActual = cron.slice(0, i + 1).reduce((s, m) => s + +m.monto, 0);
  const saldoAnterior = saldoActual - +pago.monto;    // el pago tiene monto negativo
  const esAnticipo = !!pago.orden_id;
  // Qué conceptos cubrió este pago (con los productos de cada venta)
  const { grupos, aplicaciones } = deudaPorConcepto(movs, imps);
  const detalle = [];
  // Cuánto se había pagado de cada concepto hasta este recibo inclusive (para saber si lo termina de cancelar)
  const pagosHasta = new Set(cron.slice(0, i + 1).filter(m => m.tipo === 'pago').map(m => m.id));
  const pagadoHasta = clave => Object.entries(aplicaciones).filter(([id]) => pagosHasta.has(+id))
    .reduce((s, [, l]) => s + l.filter(x => x.grupo === clave).reduce((t, x) => t + x.monto, 0), 0);
  for (const a of aplicaciones[pago.id] || []) {
    if (!a.grupo) { detalle.push({ titulo: 'A cuenta (saldo a favor)', monto: a.monto, lineas: [] }); continue; }
    const g = grupos.find(x => x.clave === a.grupo);
    let lineas = [];
    if (g?.venta_id) { const v = await store.venta(g.venta_id).catch(() => null); lineas = (v?.items || []).map(it => `${+it.cantidad !== 1 ? `${it.cantidad}× ` : ''}${it.descripcion}`); }
    const etiqueta = !g || a.monto >= g.total - 0.009 ? '' : pagadoHasta(a.grupo) >= g.total - 0.009 ? 'cancela el saldo' : 'pago parcial';
    detalle.push({ titulo: `${g?.concepto || a.grupo} (${fdate(g?.fecha)})`, monto: a.monto, lineas, etiqueta });
  }
  printHTML(`<div class="ticket">
    <div class="c big">${esc(n.nombre)}</div><div class="c">${esc(n.direccion)}<br>${esc(n.telefono)}</div><hr>
    <div class="c"><b>RECIBO DE PAGO</b><br>${esAnticipo ? 'Anticipo de service' : 'Cuenta corriente'}</div><hr>
    <div>Recibo N° ${pago.id}<br>${fdatetime(pago.fecha)}<br>Cliente: ${esc(c.nombre)}${c.dni_cuit ? `<br>DNI/CUIT: ${esc(c.dni_cuit)}` : ''}</div><hr>
    ${pago.concepto && pago.concepto !== 'Cobro de cuenta corriente' ? `<div>Nota: ${esc(pago.concepto)}</div>` : ''}
    ${detalle.length ? `<div><b>Detalle de lo pagado</b></div><table>${detalle.map(d => `
      <tr><td colspan="2">${esc(d.titulo)}${d.etiqueta ? ` (${d.etiqueta})` : ''}</td></tr>
      ${d.lineas.map(l => `<tr><td colspan="2" style="padding-left:2mm">· ${esc(l)}</td></tr>`).join('')}
      <tr><td></td><td style="text-align:right">${money(d.monto)}</td></tr>`).join('')}</table>` : ''}
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
  const [proveedores, compras, productos] = await Promise.all([store.proveedores(), store.compras(), store.productos()]);
  const stats = id => { const cs = compras.filter(c => c.proveedor_id === id); return { n: cs.length, total: cs.reduce((s, c) => s + +c.total, 0), ultima: cs[0]?.fecha, prods: productos.filter(p => p.proveedor_id === id).length }; };
  view().innerHTML = `
  <div class="page-head"><h1>Proveedores</h1><div class="actions"><button class="btn primary" id="nuevo">+ Nuevo proveedor</button></div></div>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por nombre, CUIT, teléfono o email"></div></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Proveedor</th><th>CUIT</th><th>Contacto</th><th class="num">Productos</th><th class="num">Compras</th><th class="num">Total comprado</th><th>Última compra</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const paint = t => {
    $('#rows').innerHTML = proveedores.filter(p => matches(t, p.nombre, p.cuit, p.telefono, p.email)).map(p => {
      const s = stats(p.id);
      return `<tr><td><b>${esc(p.nombre)}</b>${p.notas ? `<div class="small muted">${esc(p.notas)}</div>` : ''}</td><td>${esc(p.cuit) || '—'}</td>
        <td class="small">${[p.telefono, p.email].filter(Boolean).map(esc).join('<br>') || '—'}</td>
        <td class="num">${s.prods ? `<a href="#/productos?prov=${p.id}">${s.prods}</a>` : '0'}</td><td class="num">${s.n}</td><td class="num">${money(s.total)}</td><td>${s.ultima ? fdate(s.ultima) : '—'}</td>
        <td class="right nowrap"><button class="btn sm" data-edit="${p.id}">Editar</button> <button class="btn sm danger" data-del="${p.id}">Eliminar</button></td></tr>`;
    }).join('') || `<tr><td colspan="8" class="empty">${t ? 'Sin resultados.' : 'Todavía no hay proveedores.'}</td></tr>`;
    $$('[data-edit]').forEach(b => b.onclick = () => proveedorModal(() => render(), proveedores.find(p => p.id === +b.dataset.edit)));
    $$('[data-del]').forEach(b => b.onclick = () => run(async () => {
      const p = proveedores.find(x => x.id === +b.dataset.del), s = stats(p.id);
      if (!confirm(`¿Eliminar a ${p.nombre}?${s.n || s.prods ? `\n\nSus ${s.n} compra(s) y ${s.prods} producto(s) no se borran: quedan "sin proveedor".` : ''}`)) return;
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
          cantidad: +i.cantidad, costo_unitario: +i.costo_unitario, precio_venta: +p.precio_venta || 0, precio_venta_orig: +p.precio_venta || 0, margen: p.margen ?? null }; }),
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
  const [proveedores, productos, cats, neg] = await Promise.all([store.proveedores(), store.productos(), store.categorias(), store.negocio()]);
  const redondeo = neg.redondeo_precios ?? 1;
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

  // los productos con precio por margen calculan su precio de venta solos a partir del costo nuevo
  const venta = i => i.margen != null && i.costo_unitario > 0 ? precioPorMargen(i.costo_unitario, i.margen, redondeo) : i.precio_venta;
  const margen = i => i.costo_unitario > 0 && venta(i) > 0 ? Math.round((venta(i) / i.costo_unitario - 1) * 100) + '%' : '—';
  function paint() {
    const total = d.items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0);
    $('#its').innerHTML = d.items.length ? `<table class="tbl"><thead><tr><th>Producto</th><th style="width:90px">Cantidad</th><th style="width:130px">Costo unit.</th>
      <th style="width:130px">Precio venta</th><th class="num">Margen</th><th class="num">Subtotal</th><th></th></tr></thead><tbody>
      ${d.items.map((i, k) => `<tr><td>${esc(i.nombre)}${i.nuevo ? ' <span class="pill blue">nuevo</span>' : ''}<div class="small muted mono">${esc(i.codigo_barras)} · stock actual ${i.stock}</div></td>
        <td><input class="input" data-k="${k}" data-f="cantidad" value="${i.cantidad}" inputmode="decimal"></td>
        <td><input class="input" data-k="${k}" data-f="costo_unitario" value="${i.costo_unitario}" inputmode="decimal"></td>
        <td>${i.margen != null ? `<b>${money(venta(i))}</b><div class="small muted">por margen ${+i.margen}%</div>` : `<input class="input" data-k="${k}" data-f="precio_venta" value="${i.precio_venta}" inputmode="decimal">`}</td>
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
      costo_unitario: +p.precio_costo || 0, precio_venta: +p.precio_venta || 0, precio_venta_orig: +p.precio_venta || 0, margen: p.margen ?? null, ...extra });
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
      + masResultados(results)
      + `<div class="${sel === results.length ? 'sel' : ''}" data-nuevo><span><b>+ Crear producto nuevo</b> «${esc(t)}»</span></div>`;
    $$('[data-i]', s).forEach(x => x.onmousedown = e => { e.preventDefault(); addP(results[+x.dataset.i]); });
    $('[data-nuevo]', s).onmousedown = e => { e.preventDefault(); crearProducto(t); };
    $('.sel', s)?.scrollIntoView({ block: 'nearest' });
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
    const exact = productos.find(p => mismoCodigo(p.codigo_barras, t));
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
      for (const i of d.items.filter(i => i.margen == null && i.precio_venta !== i.precio_venta_orig)) await store.guardarProducto({ id: i.producto_id, precio_venta: i.precio_venta });
    } finally { btn.disabled = false; }
    const n = d.items.length; compraDraft = null;
    toast(d.editId ? 'Compra actualizada · stock corregido' : `Compra registrada · ${n} producto(s) con stock actualizado`);
    // Si la compra salió de un pedido, ofrecer cerrarlo
    if (d.pedido_id && confirm(`¿Marcar el pedido N° ${d.pedido_numero} como recibido?`)) {
      await store.actualizarPedido(d.pedido_id, { estado: 'recibido', fecha_recibido: new Date().toISOString() });
      toast(`Pedido N° ${d.pedido_numero} recibido`);
    }
    go('#/compras');
  });

  paint();
  b.focus();
}

// =====================================================================
// PEDIDOS DE MERCADERÍA (no tocan stock)
// =====================================================================
const ESTADO_PEDIDO = { pendiente: ['Pendiente', 'amber'], recibido: ['Recibido', 'green'], cancelado: ['Cancelado', 'gray'] };
const pillPedido = e => `<span class="pill ${ESTADO_PEDIDO[e][1]}">${ESTADO_PEDIDO[e][0]}</span>`;

ROUTES.pedidos = async ({ id, q }) => {
  if (id === 'nuevo') return nuevoPedido();
  if (id) return detallePedido(+id);
  const [pedidos, proveedores] = await Promise.all([store.pedidos(), store.proveedores()]);
  const provName = id => proveedores.find(x => x.id === id)?.nombre || 'Sin proveedor';
  let filtro = q.get('estado') || 'pendiente';
  const cuenta = e => pedidos.filter(p => e === 'todos' || p.estado === e).length;
  view().innerHTML = `
  <div class="page-head"><h1>Pedidos a proveedores</h1><div class="actions">
    <a class="btn primary" href="#/pedidos/nuevo">${pedidoDraft?.items.length ? `Continuar armado (${pedidoDraft.items.length})` : '+ Nuevo pedido'}</a></div></div>
  <p class="small muted" style="margin:-.6rem 0 1rem">Los pedidos no mueven stock: cuando llega la mercadería se ingresa en Compras → Ingresar mercadería (desde el pedido podés precargarla).</p>
  <div class="chips" id="chips"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Productos</th><th>Estado</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const paint = () => {
    $('#chips').innerHTML = ['pendiente', 'recibido', 'cancelado', 'todos'].map(e => `<button class="chip ${filtro === e ? 'active' : ''}" data-e="${e}">${e === 'todos' ? 'Todos' : ESTADO_PEDIDO[e][0]}<span class="count">${cuenta(e)}</span></button>`).join('');
    $$('#chips .chip').forEach(c => c.onclick = () => { filtro = c.dataset.e; paint(); });
    $('#rows').innerHTML = pedidos.filter(p => filtro === 'todos' || p.estado === filtro).map(p => `<tr class="click" data-href="#/pedidos/${p.id}">
      <td class="mono"><b>${p.numero}</b></td><td class="nowrap">${fdate(p.fecha)}</td><td>${esc(provName(p.proveedor_id))}</td>
      <td class="small">${p.items.length} producto(s) · ${p.items.slice(0, 3).map(i => esc(i.descripcion)).join(', ')}${p.items.length > 3 ? '…' : ''}</td>
      <td>${pillPedido(p.estado)}${p.estado === 'recibido' && p.fecha_recibido ? ` <span class="small muted">${fdate(p.fecha_recibido)}</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">No hay pedidos en este estado.</td></tr>';
    bindRowLinks();
  };
  paint();
};

async function nuevoPedido() {
  const [proveedores, productos, cats] = await Promise.all([store.proveedores(), store.productos(), store.categorias()]);
  const d = pedidoDraft ??= { notas: '', items: [] };   // se puede empezar vacío y agregar desde el buscador
  const provName = id => proveedores.find(x => x.id === +id)?.nombre || 'Sin proveedor asignado';
  const opciones = sel => `<option value="">— Sin proveedor —</option>${proveedores.map(p => `<option value="${p.id}" ${String(p.id) === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}`;

  view().innerHTML = `
  <div class="page-head"><div><a href="#/pedidos" class="small muted">← Pedidos</a><h1>Armar pedido de mercadería</h1></div>
    <div class="actions"><button class="btn danger" id="descartar">Descartar</button></div></div>
  <p class="small muted" style="margin:-.6rem 0 1rem">Cantidad sugerida: lo que falta para llegar al stock mínimo. El proveedor viene del habitual de cada producto, pero lo podés cambiar: se arma un pedido por proveedor.</p>
  <div class="card card-pad" style="margin-bottom:1rem">
    <div class="search" style="position:relative"><input class="input" id="b" placeholder="Agregar un producto al pedido (buscar o escanear)" autocomplete="off"><div class="suggest" id="s" hidden></div></div>
    <div class="small" style="margin-top:.6rem" id="bajo-box"></div>
  </div>
  <div id="grupos"></div>
  <div class="card card-pad" style="margin-top:1rem">
    <div class="field"><label>Notas para el proveedor (opcional, salen impresas)</label><input class="input" id="notas" value="${esc(d.notas)}" placeholder="ej: entregar antes del viernes"></div>
    <button class="btn ok lg block" id="guardar">Guardar pedido(s)</button>
  </div>`;

  function paint() {
    const grupos = {};
    d.items.forEach((it, k) => (grupos[it.proveedor_id || ''] ??= []).push([it, k]));
    const claves = Object.keys(grupos).sort((a, b) => provName(a).localeCompare(provName(b)));
    $('#grupos').innerHTML = claves.map(pk => `<div class="card card-pad" style="margin-bottom:1rem">
      <h2>${esc(provName(pk))} <span class="muted small">(${grupos[pk].length} producto(s))</span></h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th class="num">Stock</th><th class="num">Mín.</th><th style="width:220px">Proveedor</th><th style="width:100px">Cantidad</th><th></th></tr></thead><tbody>
      ${grupos[pk].map(([it, k]) => `<tr><td>${esc(it.descripcion)}<div class="small muted">${[it.marca, it.codigo].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td class="num">${it.stock}</td><td class="num muted">${it.stock_minimo}</td>
        <td><select class="input" data-prov="${k}">${opciones(it.proveedor_id)}</select>
          ${it.proveedor_id !== it.habitual ? `<div class="small muted">habitual: ${esc(provName(it.habitual))}</div>` : ''}</td>
        <td><input class="input" type="number" min="0" step="any" value="${it.cantidad}" data-cant="${k}"></td>
        <td><button class="x" data-del="${k}" title="Quitar">×</button></td></tr>`).join('')}
      </tbody></table></div></div>`).join('') || '<div class="card card-pad empty">Todavía no hay productos: buscalos o escanealos arriba.</div>';
    // atajo: sumar los que están en stock bajo (mínimo cargado y stock en el mínimo o por debajo)
    const bajos = productos.filter(p => faltaStock(p) && !d.items.some(i => i.producto_id === p.id));
    $('#bajo-box').innerHTML = bajos.length ? `<button class="btn sm" id="sumar-bajos">Sumar los de stock bajo (${bajos.length})</button>` : '<span class="muted">No hay otros productos con stock bajo.</span>';
    const sb = $('#sumar-bajos'); if (sb) sb.onclick = () => { bajos.forEach(p => addP(p, false)); paint(); toast(`${bajos.length} producto(s) agregado(s)`); };
    $$('[data-prov]').forEach(s => s.onchange = () => { d.items[+s.dataset.prov].proveedor_id = s.value; paint(); });
    $$('[data-cant]').forEach(inp => inp.onchange = () => { d.items[+inp.dataset.cant].cantidad = Math.max(0, +inp.value || 0); });
    $$('[data-del]').forEach(bt => bt.onclick = () => { d.items.splice(+bt.dataset.del, 1); paint(); });
  }
  // agregar productos sueltos
  const b = $('#b'), s = $('#s');
  function addP(p, repintar = true) {
    if (!d.items.some(i => i.producto_id === p.id)) d.items.push({ producto_id: p.id, descripcion: p.nombre, marca: p.marca || '', codigo: p.codigo_barras || '', stock: p.stock,
      stock_minimo: p.stock_minimo, proveedor_id: p.proveedor_id ? String(p.proveedor_id) : '', habitual: p.proveedor_id ? String(p.proveedor_id) : '', cantidad: Math.max(p.stock_minimo - p.stock, 1) });
    if (!repintar) return;
    b.value = ''; s.hidden = true; paint(); b.focus();
  }
  paint();
  b.focus();
  b.oninput = () => {
    const t = b.value.trim(); if (!t) { s.hidden = true; return; }
    const r = buscarProductos(productos, cats, t, p => !p.es_servicio);
    s.hidden = false;
    s.innerHTML = (r.map(p => `<div data-id="${p.id}">${prodSugHTML(p, cats, { costo: true })}</div>`).join('') || '<div class="muted">Sin resultados</div>') + masResultados(r);
    $$('[data-id]', s).forEach(x => x.onmousedown = e => { e.preventDefault(); addP(productos.find(p => p.id === +x.dataset.id)); });
  };
  b.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const p = productos.find(x => mismoCodigo(x.codigo_barras, b.value.trim())); if (p) addP(p); } };
  b.onblur = () => setTimeout(() => s.hidden = true, 150);
  $('#notas').oninput = e => d.notas = e.target.value;

  $('#descartar').onclick = () => { if (!confirm('¿Descartar este pedido sin guardarlo?')) return; pedidoDraft = null; go('#/pedidos'); };
  $('#guardar').onclick = () => run(async () => {
    const grupos = {};
    d.items.filter(i => +i.cantidad > 0).forEach(i => (grupos[i.proveedor_id || ''] ??= []).push(i));
    const claves = Object.keys(grupos);
    if (!claves.length) return toast('Cargá alguna cantidad a pedir', true);
    const btn = $('#guardar'); btn.disabled = true;
    const creados = [];
    try {
      for (const pk of claves) {
        const items = grupos[pk].map(({ producto_id, descripcion, codigo, cantidad }) => ({ producto_id, descripcion, codigo, cantidad: +cantidad }));
        creados.push(await store.crearPedido({ proveedor_id: pk ? +pk : null, items, notas: d.notas.trim() }));
      }
    } finally { btn.disabled = false; }
    pedidoDraft = null;
    const pedidos = await Promise.all(creados.map(id => store.pedido(id)));
    // ir a la lista sin disparar "hashchange" (que cerraría el cartel de abajo)
    history.replaceState(null, '', '#/pedidos'); await render();
    const m = modal(`${pedidos.length} pedido(s) guardado(s)`, `<p>${pedidos.map(p => `N° <b>${p.numero}</b> · ${esc(provName(p.proveedor_id))} (${p.items.length} producto(s))`).join('<br>')}</p>
      <p class="small muted" style="margin-top:.6rem">Quedan como <b>Pendientes</b> hasta que los marques como recibidos.</p>`,
      `<button class="btn" data-close>Cerrar</button><button class="btn primary" id="imp">Imprimir</button>`);
    $('#imp', m.el).onclick = () => run(() => imprimirPedidos(pedidos, proveedores));
  });
}

async function detallePedido(id) {
  const [p, proveedores, productos, encargos] = await Promise.all([store.pedido(id), store.proveedores(), store.productos(), store.encargosDePedido(id).catch(() => [])]);
  if (!p) { view().innerHTML = '<div class="empty">Pedido no encontrado</div>'; return; }
  const provName = pid => proveedores.find(x => x.id === pid)?.nombre || 'Sin proveedor';
  const pendiente = p.estado === 'pendiente';
  const items = p.items.map(i => ({ ...i }));
  const deEncargo = i => { const e = i.encargo_id && encargos.find(x => x.id === i.encargo_id); return e ? `<div class="small" style="color:var(--accent)">📌 Encargo N° ${e.numero} · ${esc(e.cliente?.nombre || e.contacto || 'sin nombre')}</div>` : ''; };
  view().innerHTML = `
  <div class="page-head"><div><a href="#/pedidos" class="small muted">← Pedidos</a><h1>Pedido N° ${p.numero} ${pillPedido(p.estado)}</h1></div>
    <div class="actions">
      <button class="btn" id="imp">Imprimir / PDF</button><button class="btn" id="xls">Excel</button><button class="btn wa" id="wa">WhatsApp</button>
      ${pendiente ? '<button class="btn" id="compra">Cargar como compra</button><button class="btn danger" id="cancelar">Cancelar pedido</button><button class="btn ok" id="recibido">Marcar recibido</button>'
        : '<button class="btn" id="reabrir">Volver a pendiente</button>'}</div></div>
  <div class="split">
    <div class="card card-pad"><h2>Productos</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Producto</th><th class="num">Stock actual</th><th style="width:110px" class="num">Cantidad</th>${pendiente ? '<th></th>' : ''}</tr></thead><tbody id="items"></tbody></table></div>
      ${pendiente ? '<button class="btn" id="guardar-items" style="margin-top:.8rem" hidden>Guardar cambios</button>' : ''}</div>
    <div class="card card-pad"><h2>Datos</h2>
      <dl class="kv"><dt>Proveedor</dt><dd>${esc(provName(p.proveedor_id))}</dd><dt>Fecha</dt><dd>${fdatetime(p.fecha)}</dd>
        ${p.fecha_recibido ? `<dt>Recibido</dt><dd>${fdatetime(p.fecha_recibido)}</dd>` : ''}
        <dt>Notas</dt><dd>${esc(p.notas) || '—'}</dd></dl>
      <p class="small muted" style="margin-top:1rem">El pedido no mueve stock. Para ingresar la mercadería usá <b>Cargar como compra</b> (abre Compras → Ingresar mercadería con estos productos) o cargala directo en Compras.</p></div>
  </div>`;
  const stockDe = pid => productos.find(x => x.id === pid)?.stock ?? '—';
  const paint = () => {
    $('#items').innerHTML = items.map((i, k) => `<tr><td class="mono small">${esc(i.codigo)}</td><td>${esc(i.descripcion)}${deEncargo(i)}</td><td class="num muted">${stockDe(i.producto_id)}</td>
      <td class="num">${pendiente ? `<input class="input" type="number" min="0" step="any" value="${+i.cantidad}" data-cant="${k}">` : `<b>${+i.cantidad}</b>`}</td>
      ${pendiente ? `<td><button class="x" data-del="${k}" title="Quitar">×</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="5" class="empty">Sin productos.</td></tr>';
    const cambio = () => { const g = $('#guardar-items'); if (g) g.hidden = false; };
    $$('[data-cant]').forEach(inp => inp.onchange = () => { items[+inp.dataset.cant].cantidad = Math.max(0, +inp.value || 0); cambio(); });
    $$('[data-del]').forEach(bt => bt.onclick = () => { items.splice(+bt.dataset.del, 1); paint(); cambio(); });
  };
  paint();
  const estado = (cambios, msg) => run(async () => { await store.actualizarPedido(id, cambios); toast(msg); render(); });
  $('#imp').onclick = () => run(() => imprimirPedidos([{ ...p, items }], proveedores));
  const prov = proveedores.find(x => x.id === p.proveedor_id);
  $('#xls').onclick = () => run(async () => {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const n = await store.negocio();
    const filas = [[`${n.nombre} — Pedido de mercadería N° ${p.numero}`], [`Proveedor: ${provName(p.proveedor_id)}`, '', `Fecha: ${fdate(p.fecha)}`],
      ...(p.notas ? [[`Notas: ${p.notas}`]] : []), [], ['Código', 'Producto', 'Cantidad'],
      ...items.filter(i => +i.cantidad > 0).map(i => [i.codigo, i.descripcion, +i.cantidad])];
    const hoja = XLSX.utils.aoa_to_sheet(filas);
    hoja['!cols'] = [{ wch: 18 }, { wch: 60 }, { wch: 10 }];
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Pedido');
    XLSX.writeFile(libro, `Pedido ${p.numero} - ${provName(p.proveedor_id).replace(/[\\/:*?"<>|]/g, '')}.xlsx`);
  });
  $('#wa').onclick = () => run(async () => {
    const n = await store.negocio();
    const texto = `Hola! Les paso un pedido de ${n.nombre} (N° ${p.numero}):\n\n${items.filter(i => +i.cantidad > 0).map(i => `• ${+i.cantidad} × ${i.descripcion}${i.codigo ? ` (${i.codigo})` : ''}`).join('\n')}${p.notas ? `\n\n${p.notas}` : ''}\n\nGracias!`;
    if (prov?.telefono) window.open(waLink(prov.telefono, texto), '_blank', 'noopener');
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');  // sin teléfono: elegís el contacto en WhatsApp
  });
  if (pendiente) {
    $('#guardar-items').onclick = () => run(async () => {
      if (!items.some(i => +i.cantidad > 0)) return toast('El pedido tiene que tener al menos un producto', true);
      await store.actualizarItemsPedido(id, items.map(({ producto_id, descripcion, codigo, cantidad, encargo_id }) => ({ producto_id, descripcion, codigo, cantidad: +cantidad, encargo_id: encargo_id || null })));
      toast('Pedido actualizado'); render();
    });
    $('#recibido').onclick = () => { if (confirm(`¿Marcar el pedido N° ${p.numero} como recibido?\n\nRecordá que el stock se carga en Compras → Ingresar mercadería.`)) estado({ estado: 'recibido', fecha_recibido: new Date().toISOString() }, 'Pedido recibido'); };
    $('#cancelar').onclick = () => { if (confirm(`¿Cancelar el pedido N° ${p.numero}?`)) estado({ estado: 'cancelado' }, 'Pedido cancelado'); };
    $('#compra').onclick = () => {
      if (compraDraft?.items.length && !confirm('Tenés otra carga de compra sin terminar. ¿Reemplazarla por este pedido?')) return;
      compraDraft = { proveedor_id: p.proveedor_id ? String(p.proveedor_id) : '', nro_comprobante: '', notas: `Pedido N° ${p.numero}`, pedido_id: p.id, pedido_numero: p.numero,
        items: items.filter(i => i.producto_id && productos.some(x => x.id === i.producto_id)).map(i => { const pr = productos.find(x => x.id === i.producto_id);
          return { producto_id: pr.id, nombre: pr.nombre, codigo_barras: pr.codigo_barras, stock: pr.stock, cantidad: +i.cantidad,
            costo_unitario: +pr.precio_costo || 0, precio_venta: +pr.precio_venta || 0, precio_venta_orig: +pr.precio_venta || 0 }; }) };
      go('#/compras/nueva');
    };
  } else {
    $('#reabrir').onclick = () => estado({ estado: 'pendiente', fecha_recibido: null }, 'Pedido pendiente otra vez');
  }
}

// =====================================================================
// ENCARGOS Y RESERVAS
// Encargo: algo que un cliente nos pide conseguir → va a un pedido pendiente
//   al proveedor y su estado acompaña al del pedido.
// Reserva: algo que tenemos en stock y se aparta para el cliente → no pasa por
//   pedidos; lo reservado se descuenta del stock DISPONIBLE (no del físico).
// Si piden más de lo que hay, se crean una reserva y un encargo vinculados.
// =====================================================================
const ESTADO_ENCARGO = {
  pendiente: ['A pedir', 'amber'], pedido: ['Pedido', 'blue'], recibido: ['Llegó', 'green'], reservado: ['Reservado', 'violet'],
  entregado: ['Entregado', 'gray'], cancelado: ['Cancelado', 'red'],
};
const pillEncargo = e => `<span class="pill ${ESTADO_ENCARGO[e][1]}">${ESTADO_ENCARGO[e][0]}</span>`;
const quienEncarga = e => e.cliente?.nombre || e.contacto || 'Sin nombre';
const telEncargo = e => e.cliente?.telefono || e.telefono || '';
const listoParaRetirar = e => e.estado === 'recibido' || e.estado === 'reservado';
const reservaVencida = e => e.estado === 'reservado' && e.reservado_hasta && e.reservado_hasta < new Date().toLocaleDateString('sv');
// Unidades reservadas de cada producto (para calcular el stock disponible)
const reservasPorProducto = encargos => encargos.filter(e => e.estado === 'reservado' && e.producto_id)
  .reduce((m, e) => m.set(e.producto_id, (m.get(e.producto_id) || 0) + +e.cantidad), new Map());

ROUTES.encargos = async ({ q }) => {
  const [encargos, proveedores, solicitudes] = await Promise.all([store.encargos(), store.proveedores(), store.solicitudesWeb().catch(() => [])]);
  const provName = id => proveedores.find(x => x.id === id)?.nombre || 'Sin proveedor';
  let filtro = q.get('estado') || 'activos', tipo = q.get('tipo') || 'todos', texto = '';
  const activo = e => !['entregado', 'cancelado'].includes(e.estado);
  const hermanos = e => e.solicitud ? encargos.filter(x => x.solicitud === e.solicitud && x.id !== e.id) : [];
  view().innerHTML = `
  <div class="page-head"><h1>Encargos y reservas</h1><div class="actions"><button class="btn primary" id="nuevo">+ Nuevo encargo / reserva</button></div></div>
  ${solicitudes.length ? `<div class="card card-pad" id="solicitudes" style="margin-bottom:1rem;border-color:#f5a623;background:#fffaf0">
    <h2 style="margin-bottom:.3rem">🛒 Solicitudes de la tienda <span class="badge">${solicitudes.length}</span></h2>
    <p class="small muted" style="margin-bottom:.7rem">Todavía <b>no reservan nada ni van a Pedidos</b>. Escribile al cliente por WhatsApp y confirmala (se convierte en reserva/encargo) o descartala. Mientras esté pendiente, el cliente la puede cancelar.</p>
    <table class="tbl"><tbody>${solicitudes.map(s => `<tr class="click" data-sol="${s.id}"><td class="mono"><b>${s.id}</b></td><td class="nowrap small">${fdatetime(s.fecha)}</td>
      <td>${esc(s.nombre)}<div class="small muted">${esc(s.telefono)}</div></td>
      <td class="small">${s.items.map(i => `${i.cantidad} × ${esc(i.nombre)}`).join('<br>')}${s.comentario ? `<div class="muted">“${esc(s.comentario)}”</div>` : ''}</td>
      <td class="num nowrap"><b>${money(s.total)}</b></td><td class="right"><button class="btn sm primary" data-sol-ver="${s.id}">Revisar</button></td></tr>`).join('')}</tbody></table></div>` : ''}
  <p class="small muted" style="margin:-.6rem 0 1rem"><b>Encargo:</b> algo que hay que pedirle al proveedor (se suma al pedido pendiente). <b>Reserva:</b> algo que tenemos en stock y apartamos para el cliente.
    Cuando llega o queda reservado, se le avisa y se entrega con <b>Vender</b>.</p>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="search"><input class="input" id="buscar" placeholder="Buscar por cliente, producto o N°"></div></div>
  <div class="chips" id="tipos"></div><div class="chips" id="chips"></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Fecha</th><th>Quién</th><th>Qué</th><th>Proveedor / pedido</th><th>Estado</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const paint = () => {
    const delTipo = encargos.filter(e => tipo === 'todos' || e.tipo === tipo);
    $('#tipos').innerHTML = [['todos', 'Todo'], ['encargo', 'Encargos'], ['reserva', 'Reservas']].map(([k, l]) =>
      `<button class="chip ${tipo === k ? 'active' : ''}" data-t="${k}">${l}<span class="count">${encargos.filter(e => k === 'todos' || e.tipo === k).length}</span></button>`).join('');
    const opciones = [['activos', 'En curso', delTipo.filter(activo).length], ['listos', 'Para retirar', delTipo.filter(listoParaRetirar).length],
      ...Object.entries(ESTADO_ENCARGO).map(([k, [l]]) => [k, l, delTipo.filter(e => e.estado === k).length]).filter(([, , n]) => n), ['todos', 'Todos', delTipo.length]];
    $('#chips').innerHTML = opciones.map(([k, l, n]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-k="${k}">${esc(l)}<span class="count">${n}</span></button>`).join('');
    $$('#tipos .chip').forEach(c => c.onclick = () => { tipo = c.dataset.t; paint(); });
    $$('#chips .chip').forEach(c => c.onclick = () => { filtro = c.dataset.k; paint(); });
    const l = delTipo.filter(e => (filtro === 'todos' || (filtro === 'activos' ? activo(e) : filtro === 'listos' ? listoParaRetirar(e) : e.estado === filtro))
      && (String(e.numero) === texto.replace('#', '') || matches(texto, quienEncarga(e), e.descripcion, e.notas)));
    $('#rows').innerHTML = l.map(e => `<tr class="click" data-enc="${e.id}"><td class="mono"><b>${e.numero}</b><div class="small muted">${e.tipo === 'reserva' ? 'reserva' : 'encargo'}</div></td>
      <td class="nowrap">${fdate(e.fecha)}</td>
      <td>${esc(quienEncarga(e))}${telEncargo(e) ? `<div class="small muted">${esc(telEncargo(e))}</div>` : ''}${!e.cliente_id ? '<div class="small muted">no es cliente</div>' : ''}</td>
      <td>${+e.cantidad !== 1 ? `${+e.cantidad} × ` : ''}${esc(e.descripcion)}${e.precio != null ? `<div class="small muted">acordado ${money(e.precio)}</div>` : ''}
        ${hermanos(e).map(h => `<div class="small" style="color:var(--accent)">🔗 ${h.descripcion === e.descripcion ? 'mismo producto' : `junto con ${+h.cantidad !== 1 ? `${+h.cantidad} × ` : ''}${esc(h.descripcion)}`}: ${h.tipo === 'reserva' ? 'reserva' : 'encargo'} N° ${h.numero}${h.descripcion === e.descripcion ? ` (${+h.cantidad})` : ''} · ${ESTADO_ENCARGO[h.estado][0]}</div>`).join('')}</td>
      <td class="small">${e.tipo === 'reserva' ? `<span class="muted">De stock</span>${e.reservado_hasta ? `<br>hasta ${fdate(e.reservado_hasta)}${reservaVencida(e) ? ' <span class="pill red">vencida</span>' : ''}` : ''}`
        : `${esc(provName(e.proveedor_id))}${e.pedido ? `<br><a href="#/pedidos/${e.pedido.id}">Pedido N° ${e.pedido.numero}</a>` : ''}`}</td>
      <td>${pillEncargo(e.estado)}${listoParaRetirar(e) && e.fecha_aviso ? '<div class="small muted">avisado</div>' : ''}</td>
      <td class="right nowrap">${listoParaRetirar(e) ? `<button class="btn sm wa" data-avisar="${e.id}">Avisar</button> <button class="btn sm ok" data-entregar="${e.id}">Entregar</button>` : ''}
        ${e.estado === 'pendiente' ? `<button class="btn sm" data-encargar="${e.id}">Agregar a pedido</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No hay nada acá.</td></tr>';
    $$('tr[data-enc]').forEach(tr => tr.onclick = ev => { if (ev.target.closest('button, a')) return; run(() => encargoModal(encargos.find(x => x.id === +tr.dataset.enc))); });
    $$('[data-avisar]').forEach(b => b.onclick = () => { const e = encargos.find(x => x.id === +b.dataset.avisar); avisarEncargo(e, hermanos(e)); });
    $$('[data-entregar]').forEach(b => b.onclick = () => entregarEncargo(encargos.find(x => x.id === +b.dataset.entregar)));
    $$('[data-encargar]').forEach(b => b.onclick = () => agregarAPedidoModal(encargos.find(x => x.id === +b.dataset.encargar), proveedores));
  };
  $('#buscar').oninput = e => { texto = e.target.value.trim(); paint(); };
  $('#nuevo').onclick = () => run(() => nuevoEncargoModal());
  $$('[data-sol]').forEach(tr => tr.onclick = () => run(() => solicitudModal(solicitudes.find(s => s.id === +tr.dataset.sol))));
  paint();
};

// Revisar una solicitud de la tienda: confirmarla (reserva lo que hay, encarga lo que falta) o descartarla
async function solicitudModal(s) {
  const [clientes, productos, proveedores, encargos] = await Promise.all([store.clientes(), store.productos(), store.proveedores(), store.encargos()]);
  const reservados = reservasPorProducto(encargos);
  const ult10 = t => String(t || '').replace(/\D/g, '').slice(-10);
  const conocido = clientes.find(c => ult10(c.telefono).length >= 8 && ult10(c.telefono) === ult10(s.telefono));
  const primer = s.nombre.split(' ')[0];
  const lineas = s.items.map(i => {
    const p = productos.find(x => x.id === i.producto_id);
    const disp = p ? Math.max(+p.stock - (reservados.get(p.id) || 0), 0) : 0;
    return { ...i, p, disp, reservar: Math.min(i.cantidad, disp), encargar: i.cantidad - Math.min(i.cantidad, disp), incluir: !!p, proveedor_id: p?.proveedor_id || null };
  });
  const m = modal(`Solicitud de la tienda N° ${s.id}`, `
    <div class="row" style="align-items:center;margin-bottom:.8rem"><div><b>${esc(s.nombre)}</b> · ${esc(s.telefono)} <span class="small muted">· ${fdatetime(s.fecha)}</span>
      ${conocido ? `<div class="small" style="color:var(--ok)">✓ Es cliente: <a href="#/clientes/${conocido.id}" data-close>${esc(conocido.nombre)}</a></div>` : '<div class="small muted">No coincide con ningún cliente cargado</div>'}</div>
      <a class="btn wa sm right" target="_blank" rel="noopener" href="${esc(waLink(s.telefono, `Hola ${primer}! Te escribimos de GScom por tu solicitud N° ${s.id} de la tienda online.`))}">Escribirle</a></div>
    ${s.comentario ? `<p class="small" style="margin-bottom:.8rem">Comentario: “${esc(s.comentario)}”</p>` : ''}
    <div class="field"><label>Queda a nombre de</label><select class="input" id="sol-cli">
      <option value="">${esc(s.nombre)} · ${esc(s.telefono)} (no es cliente)</option>
      ${clientes.map(c => `<option value="${c.id}" ${c.id === conocido?.id ? 'selected' : ''}>${esc(c.nombre)}${c.telefono ? ' — ' + esc(c.telefono) : ''}</option>`).join('')}</select></div>
    <table class="tbl" style="margin-bottom:.8rem"><thead><tr><th style="width:28px"></th><th>Producto</th><th>Qué se hace</th><th>Proveedor (lo que falte)</th></tr></thead><tbody>
      ${lineas.map((l, i) => `<tr><td><input type="checkbox" data-inc="${i}" ${l.incluir ? 'checked' : 'disabled'}></td>
        <td>${l.cantidad} × ${esc(l.nombre)}<div class="small muted">${money(l.precio)} c/u${l.p ? ` · stock ${l.p.stock}${reservados.get(l.p.id) ? `, ${reservados.get(l.p.id)} reservado(s)` : ''}` : ' · ya no está en la base'}</div></td>
        <td class="small">${!l.p ? '—' : !l.encargar ? `Se <b>reservan ${l.reservar}</b>` : !l.reservar ? `Se <b>encargan ${l.encargar}</b>` : `Se <b>reservan ${l.reservar}</b> y se <b>encargan ${l.encargar}</b>`}</td>
        <td>${l.encargar && l.p ? `<select class="input" data-prov="${i}"><option value="">— Sin proveedor —</option>${proveedores.map(p => `<option value="${p.id}" ${p.id === l.proveedor_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>` : '<span class="muted small">—</span>'}</td></tr>`).join('')}
    </tbody></table>
    <div class="field" style="max-width:220px"><label>Reservado hasta (opcional)</label><input class="input" type="date" id="sol-hasta"></div>
    <p class="small muted">Al confirmar: lo reservado se aparta del stock disponible y lo encargado se suma al pedido pendiente de cada proveedor. Todo queda en Encargos con el precio de la tienda.</p>`,
    `<button class="btn danger" id="descartar" style="margin-right:auto">Descartar</button><button class="btn" data-close>Cerrar</button><button class="btn primary" id="confirmar">Confirmar solicitud</button>`, { wide: true });

  const mensaje = texto => { if (confirm('¿Le avisás al cliente por WhatsApp?')) window.open(waLink(s.telefono, texto), '_blank', 'noopener'); };
  $('#descartar', m.el).onclick = () => run(async () => {
    if (!confirm(`¿Descartar la solicitud N° ${s.id}? No se reserva ni se encarga nada.`)) return;
    await store.atenderSolicitudWeb(s.id, 'descartada');
    m.close(); toast('Solicitud descartada'); render(); actualizarContador();
    mensaje(`Hola ${primer}! Te escribimos de GScom por tu solicitud N° ${s.id}: lamentablemente no podemos confirmarla. Si querés, lo charlamos por acá.`);
  });
  $('#confirmar', m.el).onclick = () => run(async () => {
    const elegidas = lineas.filter((l, i) => l.p && $(`[data-inc="${i}"]`, m.el).checked);
    if (!elegidas.length) return toast('No quedó ningún producto marcado: si no se hace nada, descartala', true);
    const cli = $('#sol-cli', m.el).value, hasta = $('#sol-hasta', m.el).value || null;
    lineas.forEach((l, i) => { const sel = $(`[data-prov="${i}"]`, m.el); if (sel) l.proveedor_id = sel.value ? +sel.value : null; });
    await store.atenderSolicitudWeb(s.id, 'confirmada');   // falla si el cliente la canceló recién
    const quien = cli ? { cliente_id: +cli, contacto: '', telefono: '' } : { cliente_id: null, contacto: s.nombre, telefono: s.telefono };
    const notas = `Solicitud web N° ${s.id}${s.comentario ? ` · ${s.comentario}` : ''}`;
    let nRes = 0, nEnc = 0;
    // todo lo de la solicitud queda vinculado (se ve junto en Encargos y el aviso al cliente menciona el resto)
    const partes = elegidas.reduce((n, l) => n + (l.reservar ? 1 : 0) + (l.encargar ? 1 : 0), 0);
    const vinculo = partes > 1 && crypto.randomUUID ? crypto.randomUUID() : null;
    for (const l of elegidas) {
      const base = { ...quien, producto_id: l.p.id, descripcion: l.nombre, precio: l.precio, notas };
      if (l.reservar) { await store.crearEncargo({ ...base, tipo: 'reserva', estado: 'reservado', cantidad: l.reservar, proveedor_id: null, reservado_hasta: hasta, solicitud: vinculo }); nRes++; }
      if (l.encargar) { const e = await store.crearEncargo({ ...base, tipo: 'encargo', cantidad: l.encargar, proveedor_id: l.proveedor_id, solicitud: vinculo }); await store.encargar(e.id, l.proveedor_id); nEnc++; }
    }
    m.close(); toast(`Solicitud N° ${s.id} confirmada: ${nRes} reserva(s), ${nEnc} encargo(s)`); render(); actualizarContador();
    const detalle = elegidas.map(l => `• ${l.cantidad} × ${l.nombre}${l.encargar ? (l.reservar ? ` (${l.reservar} ya separados, ${l.encargar} por encargo)` : ' (por encargo)') : ''}`).join('\n');
    mensaje(`Hola ${primer}! Te escribimos de GScom: confirmamos tu solicitud N° ${s.id}.\n\n${detalle}\n\n${elegidas.some(l => l.encargar) ? 'Lo que está por encargo te avisamos cuando llegue. ' : ''}Podés ver tu solicitud acá: ${new URL(`tienda.html?solicitud=${s.token}`, location.href).href}`);
  });
}

// Alta y edición. Al dar de alta un producto con stock disponible se puede reservar;
// si piden más de lo disponible, se reserva lo que hay y se encarga el resto.
async function encargoModal(e) {
  const [clientes, productos, proveedores, cats, encargos] = await Promise.all([store.clientes(), store.productos(), store.proveedores(), store.categorias(), store.encargos()]);
  const nuevo = !e, editable = nuevo || e.estado === 'pendiente';
  const esReserva = !nuevo && e.tipo === 'reserva';
  const v = e || { cliente_id: null, contacto: '', telefono: '', producto_id: null, descripcion: '', cantidad: 1, precio: null, proveedor_id: null, notas: '', reservado_hasta: null };
  const reservados = reservasPorProducto(encargos);
  const disponible = p => p ? Math.max(+p.stock - (reservados.get(p.id) || 0), 0) : 0;
  let productoId = v.producto_id;
  const opcProv = sel => `<option value="">— Sin proveedor —</option>${proveedores.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}`;
  const titulo = nuevo ? 'Nuevo encargo / reserva' : `${esReserva ? 'Reserva' : 'Encargo'} N° ${e.numero}`;
  const m = modal(titulo, `
    ${!nuevo ? `<div style="margin-bottom:.8rem">${pillEncargo(e.estado)} <span class="small muted">· ${fdatetime(e.fecha)}${e.pedido ? ` · <a href="#/pedidos/${e.pedido.id}" data-close>Pedido N° ${e.pedido.numero}</a>` : ''}</span></div>` : ''}
    <div class="field"><label>¿Quién lo pide?</label><select class="input" name="cliente_id" ${editable ? '' : 'disabled'}>
      <option value="">— No es cliente (cargar nombre y teléfono) —</option>
      ${clientes.map(c => `<option value="${c.id}" ${c.id === v.cliente_id ? 'selected' : ''}>${esc(c.nombre)}${c.telefono ? ' — ' + esc(c.telefono) : ''}</option>`).join('')}</select></div>
    <div class="row" id="contacto"><div class="field"><label>Nombre / empresa</label><input class="input" name="contacto" value="${esc(v.contacto)}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="telefono" value="${esc(v.telefono)}" ${editable ? '' : 'disabled'}></div></div>
    <div class="field"><label>¿Qué pide? <span class="muted">(buscá un producto de la base, o escribí la descripción si es algo nuevo)</span></label>
      <div class="search" style="position:relative"><input class="input" name="descripcion" value="${esc(v.descripcion)}" autocomplete="off" ${editable ? '' : 'disabled'}><div class="suggest" id="s" hidden></div></div>
      <div class="small" id="prodinfo" style="margin-top:.3rem"></div></div>
    <div class="row"><div class="field"><label>Cantidad</label><input class="input" type="number" min="1" step="any" name="cantidad" value="${+v.cantidad}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>Precio acordado (opcional)</label><input class="input" type="number" min="0" step="any" name="precio" value="${v.precio ?? ''}"></div>
      <div class="field" id="f-prov" ${esReserva ? 'hidden' : ''}><label>Proveedor (si hay que pedirlo)</label><select class="input" name="proveedor_id" ${editable ? '' : 'disabled'}>${opcProv(v.proveedor_id)}</select></div></div>
    ${nuevo ? `<div id="reservar-box" class="card card-pad" style="background:#fafbfc;margin-bottom:.8rem" hidden>
      <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="reservar" checked> <b>Reservar del stock</b> <span id="disp" class="muted"></span></label>
      <div class="small" id="reparto" style="margin:.4rem 0 .2rem"></div>
      <div class="field" style="margin:.5rem 0 0;max-width:220px"><label>Reservado hasta (opcional)</label><input class="input" type="date" name="reservado_hasta"></div></div>` : ''}
    ${esReserva ? `<div class="field" style="max-width:220px"><label>Reservado hasta (opcional)</label><input class="input" type="date" name="reservado_hasta" value="${v.reservado_hasta || ''}"></div>` : ''}
    <div class="field"><label>Notas internas</label><input class="input" name="notas" value="${esc(v.notas)}" placeholder="ej: lo necesita antes del lunes · dejó seña"></div>`,
    `${!nuevo && !['entregado', 'cancelado'].includes(e.estado) ? `<button class="btn danger" id="cancelar" style="margin-right:auto">${esReserva ? 'Liberar reserva' : 'Cancelar encargo'}</button>` : ''}
     <button class="btn" data-close>Cerrar</button><button class="btn primary" id="ok">${nuevo ? 'Guardar' : 'Guardar cambios'}</button>`, { wide: true });

  const selCli = $('[name=cliente_id]', m.el), inpDesc = $('[name=descripcion]', m.el), s = $('#s', m.el), selProv = $('[name=proveedor_id]', m.el), inpCant = $('[name=cantidad]', m.el);
  const pintarContacto = () => $('#contacto', m.el).hidden = !!selCli.value;
  selCli.onchange = pintarContacto; pintarContacto();

  // Reparto entre reserva (lo disponible) y encargo (lo que falta)
  const reparto = () => {
    const p = productos.find(x => x.id === productoId), cant = +inpCant.value || 1;
    const quiereReservar = nuevo && p && disponible(p) > 0 && $('#reservar', m.el)?.checked;
    const r = quiereReservar ? Math.min(cant, disponible(p)) : 0;
    return { p, cant, reservar: r, encargar: cant - r };
  };
  const pintarReparto = () => {
    if (!nuevo) return;
    const { p, reservar, encargar } = reparto();
    const box = $('#reservar-box', m.el), d = p ? disponible(p) : 0;
    box.hidden = !(p && d > 0);
    if (p) $('#disp', m.el).textContent = `· hay ${d} disponible(s)${reservados.get(p.id) ? ` (${p.stock} en stock, ${reservados.get(p.id)} ya reservado(s))` : ''}`;
    $('#reparto', m.el).innerHTML = !reservar ? 'Se encarga todo al proveedor.'
      : !encargar ? `Se <b>reservan ${reservar}</b> del stock. No pasa por Pedidos.`
      : `Se <b>reservan ${reservar}</b> del stock y se <b>encargan ${encargar}</b> al proveedor (quedan vinculados).`;
    $('#f-prov', m.el).hidden = !!reservar && !encargar;
    $('#ok', m.el).textContent = !reservar ? 'Guardar y agregar al pedido' : !encargar ? 'Guardar reserva' : 'Guardar reserva y encargo';
  };
  const pintarProd = () => {
    const p = productos.find(x => x.id === productoId);
    $('#prodinfo', m.el).innerHTML = p ? `✓ Producto de la base: <b>${esc(p.nombre)}</b> · stock ${p.stock}${reservados.get(p.id) ? ` (${reservados.get(p.id)} reservado/s)` : ''} · venta ${money(p.precio_venta)}${editable ? ' <a href="#" id="soltar">(no es este)</a>' : ''}`
      : '<span class="muted">Producto nuevo (no está en la base): se pide al proveedor con esta descripción.</span>';
    const sol = $('#soltar', m.el); if (sol) sol.onclick = ev => { ev.preventDefault(); productoId = null; pintarProd(); };
    pintarReparto();
  };
  pintarProd();
  if (nuevo) { inpCant.oninput = pintarReparto; $('#reservar', m.el).onchange = pintarReparto; }
  if (editable) {
    inpDesc.oninput = () => {
      productoId = null; pintarProd();
      const t = inpDesc.value.trim(); if (!t) { s.hidden = true; return; }
      const r = buscarProductos(productos, cats, t, p => !p.es_servicio);
      s.hidden = !r.length;
      s.innerHTML = r.map(p => `<div data-id="${p.id}">${prodSugHTML(p, cats, { costo: true })}</div>`).join('') + masResultados(r);
      $$('[data-id]', s).forEach(x => x.onmousedown = ev => {
        ev.preventDefault(); const p = productos.find(y => y.id === +x.dataset.id);
        productoId = p.id; inpDesc.value = p.nombre; s.hidden = true;
        if (p.proveedor_id && !selProv.value) selProv.value = p.proveedor_id;   // proveedor habitual por defecto
        if ($('[name=precio]', m.el).value === '') $('[name=precio]', m.el).value = p.precio_venta;
        pintarProd();
      });
    };
    inpDesc.onblur = () => setTimeout(() => s.hidden = true, 150);
  }

  const can = $('#cancelar', m.el);
  if (can) can.onclick = () => run(async () => {
    const msg = esReserva ? `¿Liberar la reserva N° ${e.numero}? Las unidades vuelven a estar disponibles.`
      : `¿Cancelar el encargo N° ${e.numero}?${e.estado === 'pedido' ? '\n\nSi el pedido todavía está pendiente, se lo quita de ese pedido.' : ''}`;
    if (!confirm(msg)) return;
    await store.cancelarEncargo(e.id); m.close(); toast(esReserva ? 'Reserva liberada' : 'Encargo cancelado'); render();
  });
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    const datos = { precio: f.precio === '' ? null : +f.precio, notas: f.notas };
    if (esReserva) datos.reservado_hasta = f.reservado_hasta || null;
    if (editable) {
      if (!f.cliente_id && !f.contacto) return toast('Elegí el cliente o cargá el nombre de quién lo pide', true);
      if (!f.descripcion) return toast('Describí qué pide', true);
      Object.assign(datos, { cliente_id: f.cliente_id ? +f.cliente_id : null, contacto: f.cliente_id ? '' : f.contacto, telefono: f.cliente_id ? '' : f.telefono,
        producto_id: productoId, descripcion: f.descripcion, cantidad: +f.cantidad || 1, proveedor_id: f.proveedor_id ? +f.proveedor_id : null });
    }
    if (!nuevo) { await store.actualizarEncargo(e.id, datos); m.close(); toast('Guardado'); return render(); }

    const { reservar, encargar } = reparto();
    const solicitud = reservar && encargar ? (crypto.randomUUID ? crypto.randomUUID() : null) : null;
    let reserva = null, encargo = null, pedidoId = null;
    if (reservar) reserva = await store.crearEncargo({ ...datos, tipo: 'reserva', estado: 'reservado', cantidad: reservar, proveedor_id: null,
      reservado_hasta: f.reservado_hasta || null, solicitud });
    if (encargar) {
      encargo = await store.crearEncargo({ ...datos, tipo: 'encargo', cantidad: encargar, solicitud });
      pedidoId = await store.encargar(encargo.id, datos.proveedor_id);
    }
    m.close();
    if (pedidoId) {
      const ped = await store.pedido(pedidoId);
      toast(`${reserva ? `Reserva N° ${reserva.numero} (${reservar}) y encargo` : 'Encargo'} N° ${encargo.numero} agregado al pedido N° ${ped.numero}`);
      go(`#/pedidos/${pedidoId}`);
    } else {
      toast(`Reserva N° ${reserva.numero}: ${reservar} unidad(es) apartada(s)`);
      go('#/encargos?tipo=reserva'); if (parseHash().name === 'encargos') render();
    }
  });
}

// Alta de encargos y reservas: el cliente se elige una vez y se cargan varios productos.
// Se crea un encargo/reserva por producto (cada uno sigue su camino: proveedor, llegada, entrega),
// todos vinculados con el mismo "solicitud" para verlos juntos.
async function nuevoEncargoModal() {
  const [clientes, productos, proveedores, cats, encargos] = await Promise.all([store.clientes(), store.productos(), store.proveedores(), store.categorias(), store.encargos()]);
  const reservados = reservasPorProducto(encargos);
  const opcProv = sel => `<option value="">— Sin proveedor —</option>${proveedores.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}`;
  const m = modal('Nuevo encargo / reserva', `
    <div class="field"><label>¿Quién lo pide?</label><select class="input" name="cliente_id">
      <option value="">— No es cliente (cargar nombre y teléfono) —</option>
      ${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}${c.telefono ? ' — ' + esc(c.telefono) : ''}</option>`).join('')}</select></div>
    <div class="row" id="contacto"><div class="field"><label>Nombre / empresa</label><input class="input" name="contacto"></div>
      <div class="field"><label>Teléfono (WhatsApp)</label><input class="input" name="telefono"></div></div>
    <label style="display:block;margin-bottom:.4rem">¿Qué pide? <span class="muted small">(buscá un producto de la base, o escribí la descripción si es algo nuevo)</span></label>
    <div id="lineas"></div>
    <button class="btn sm" id="otra">+ Agregar otro producto</button>
    <div class="row" style="margin-top:1rem"><div class="field" id="f-hasta" hidden style="flex:0 0 220px"><label>Reservado hasta (opcional)</label><input class="input" type="date" name="reservado_hasta"></div>
      <div class="field"><label>Notas internas</label><input class="input" name="notas" placeholder="ej: lo necesita antes del lunes · dejó seña"></div></div>`,
    `<button class="btn" data-close>Cerrar</button><button class="btn primary" id="ok">Guardar</button>`, { wide: true });

  const selCli = $('[name=cliente_id]', m.el);
  selCli.onchange = () => $('#contacto', m.el).hidden = !!selCli.value;
  const lineas = [];   // { id, productoId, el }
  let sec = 0;
  const val = (l, sel) => $(sel, l.el).value.trim();
  const prod = l => productos.find(x => x.id === l.productoId);
  // Lo que se puede reservar en esta línea, descontando lo que ya reservan las líneas anteriores del mismo producto
  const reparto = l => {
    const p = prod(l), cant = +val(l, '[data-cant]') || 1;
    if (!p || !l.reservar) return { p, cant, reservar: 0, encargar: cant, disp: p ? dispPara(l) : 0 };
    const disp = dispPara(l), reservar = Math.min(cant, disp);
    return { p, cant, reservar, encargar: cant - reservar, disp };
  };
  const dispPara = l => {
    const p = prod(l); if (!p) return 0;
    const antes = lineas.slice(0, lineas.indexOf(l)).filter(x => x.productoId === p.id).reduce((s, x) => s + reparto(x).reservar, 0);
    return Math.max(+p.stock - (reservados.get(p.id) || 0) - antes, 0);
  };
  const pintar = () => {
    let hayReserva = false, nRes = 0, nEnc = 0;
    lineas.forEach(l => {
      const { p, reservar, encargar, disp } = reparto(l);
      const info = $('[data-info]', l.el), chk = l.reservar;
      info.innerHTML = !p ? (val(l, '[data-desc]') ? '<span class="muted">Producto nuevo (no está en la base): se pide al proveedor con esta descripción.</span>' : '')
        : `✓ <b>${esc(p.nombre)}</b> · stock ${p.stock}${reservados.get(p.id) ? ` (${reservados.get(p.id)} reservado/s)` : ''} · venta ${money(p.precio_venta)} <a href="#" data-soltar>(no es este)</a>
          ${disp > 0 || reservar ? `<label style="display:flex;gap:.4rem;align-items:center;margin-top:.3rem"><input type="checkbox" data-reservar ${chk ? 'checked' : ''}> Reservar del stock <span class="muted">· hay ${disp} disponible(s)</span></label>` : ''}
          <div style="margin-top:.2rem">${!reservar ? 'Se encarga al proveedor.' : !encargar ? `Se <b>reservan ${reservar}</b> del stock.` : `Se <b>reservan ${reservar}</b> y se <b>encargan ${encargar}</b> al proveedor.`}</div>`;
      $('[data-f-prov]', l.el).style.visibility = reservar && !encargar ? 'hidden' : '';
      $('[data-quitar]', l.el).style.visibility = lineas.length > 1 ? '' : 'hidden';
      const sol = $('[data-soltar]', l.el); if (sol) sol.onclick = ev => { ev.preventDefault(); l.productoId = null; pintar(); };
      const r = $('[data-reservar]', l.el); if (r) r.onchange = () => { l.reservar = r.checked; pintar(); };
      if (val(l, '[data-desc]')) { if (reservar) { hayReserva = true; nRes++; } if (encargar) nEnc++; }
    });
    $('#f-hasta', m.el).hidden = !hayReserva;
    $('#ok', m.el).textContent = !nRes && !nEnc ? 'Guardar' : [nRes && `${nRes} reserva${nRes > 1 ? 's' : ''}`, nEnc && `${nEnc} encargo${nEnc > 1 ? 's' : ''}`].filter(Boolean).join(' y ').replace(/^/, 'Guardar ');
  };
  const agregarLinea = () => {
    const l = { id: ++sec, productoId: null, reservar: true };   // reservar: usar el stock disponible (se puede destildar)
    const div = document.createElement('div');
    div.className = 'card card-pad'; div.style.cssText = 'background:#fafbfc;margin-bottom:.6rem';
    div.innerHTML = `<div class="row" style="align-items:flex-end">
      <div class="field" style="flex:3;margin:0"><label class="small">Producto</label><div class="search" style="position:relative"><input class="input" data-desc autocomplete="off" placeholder="Buscá o describí qué pide"><div class="suggest" hidden></div></div></div>
      <div class="field" style="flex:0 0 90px;margin:0"><label class="small">Cantidad</label><input class="input" data-cant type="number" min="1" step="any" value="1"></div>
      <div class="field" style="flex:0 0 130px;margin:0"><label class="small">Precio acordado</label><input class="input" data-precio type="number" min="0" step="any" placeholder="opcional"></div>
      <div class="field" style="flex:1 1 170px;margin:0" data-f-prov><label class="small">Proveedor</label><select class="input" data-prov>${opcProv(null)}</select></div>
      <button class="x" data-quitar title="Quitar este producto" style="flex:0 0 auto;align-self:center">×</button></div>
      <div class="small" data-info style="margin-top:.4rem"></div>`;
    l.el = div; lineas.push(l); $('#lineas', m.el).appendChild(div);
    const inp = $('[data-desc]', div), s = $('.suggest', div);
    inp.oninput = () => {
      l.productoId = null; pintar();
      const t = inp.value.trim(); if (!t) { s.hidden = true; return; }
      const r = buscarProductos(productos, cats, t, p => !p.es_servicio);
      s.hidden = !r.length;
      s.innerHTML = r.map(p => `<div data-id="${p.id}">${prodSugHTML(p, cats, { costo: true })}</div>`).join('') + masResultados(r);
      $$('[data-id]', s).forEach(x => x.onmousedown = ev => {
        ev.preventDefault(); const p = productos.find(y => y.id === +x.dataset.id);
        l.productoId = p.id; l.reservar = true; inp.value = p.nombre; s.hidden = true;
        if (p.proveedor_id && !$('[data-prov]', div).value) $('[data-prov]', div).value = p.proveedor_id;   // proveedor habitual
        if (!$('[data-precio]', div).value) $('[data-precio]', div).value = p.precio_venta;
        pintar(); $('[data-cant]', div).select();
      });
    };
    inp.onblur = () => setTimeout(() => s.hidden = true, 150);
    $('[data-cant]', div).oninput = pintar;
    $('[data-quitar]', div).onclick = () => { lineas.splice(lineas.indexOf(l), 1); div.remove(); pintar(); };
    pintar(); inp.focus();
  };
  $('#otra', m.el).onclick = agregarLinea;
  agregarLinea();
  setTimeout(() => selCli.focus(), 40);

  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el);
    if (!f.cliente_id && !f.contacto) return toast('Elegí el cliente o cargá el nombre de quién lo pide', true);
    const plan = lineas.filter(l => val(l, '[data-desc]')).map(l => ({ ...reparto(l), l, desc: val(l, '[data-desc]'),
      precio: val(l, '[data-precio]') === '' ? null : +val(l, '[data-precio]'), prov: val(l, '[data-prov]') ? +val(l, '[data-prov]') : null }));
    if (!plan.length) return toast('Cargá al menos un producto', true);
    const quien = { cliente_id: f.cliente_id ? +f.cliente_id : null, contacto: f.cliente_id ? '' : f.contacto, telefono: f.cliente_id ? '' : f.telefono };
    const partes = plan.reduce((n, x) => n + (x.reservar ? 1 : 0) + (x.encargar ? 1 : 0), 0);
    const vinculo = partes > 1 && crypto.randomUUID ? crypto.randomUUID() : null;
    const pedidos = new Set(); let nRes = 0, nEnc = 0, ultimaReserva = null;
    for (const x of plan) {
      const base = { ...quien, producto_id: x.p?.id || null, descripcion: x.desc, precio: x.precio, notas: f.notas, solicitud: vinculo };
      if (x.reservar) { ultimaReserva = await store.crearEncargo({ ...base, tipo: 'reserva', estado: 'reservado', cantidad: x.reservar, proveedor_id: null, reservado_hasta: f.reservado_hasta || null }); nRes++; }
      if (x.encargar) { const e = await store.crearEncargo({ ...base, tipo: 'encargo', cantidad: x.encargar, proveedor_id: x.prov }); pedidos.add(await store.encargar(e.id, x.prov)); nEnc++; }
    }
    m.close();
    if (plan.length === 1 && pedidos.size === 1 && !nRes) {   // un solo encargo: como siempre, a su pedido
      const ped = await store.pedido([...pedidos][0]);
      toast(`Encargo agregado al pedido N° ${ped.numero}`); return go(`#/pedidos/${ped.id}`);
    }
    toast(plan.length === 1 && !nEnc ? `Reserva N° ${ultimaReserva.numero}: ${nRes && plan[0].reservar} unidad(es) apartada(s)`
      : `${[nRes && `${nRes} reserva(s)`, nEnc && `${nEnc} encargo(s)`].filter(Boolean).join(' y ')} guardados${pedidos.size ? ` · sumados a ${pedidos.size} pedido(s)` : ''}`);
    go('#/encargos'); if (parseHash().name === 'encargos') render();
  });
}

// Encargo que quedó "A pedir" (por ejemplo, se canceló su pedido): volver a agregarlo a un pedido
function agregarAPedidoModal(e, proveedores) {
  const m = modal(`Agregar encargo N° ${e.numero} a un pedido`, `
    <p class="small muted" style="margin-bottom:.8rem">${esc(e.descripcion)} · ${esc(quienEncarga(e))}. Se suma al pedido pendiente de ese proveedor (o se crea uno).</p>
    <div class="field"><label>Proveedor</label><select class="input" id="prov"><option value="">— Sin proveedor —</option>
      ${proveedores.map(p => `<option value="${p.id}" ${p.id === e.proveedor_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Agregar al pedido</button>`);
  $('#ok', m.el).onclick = () => run(async () => {
    const prov = $('#prov', m.el).value;
    const pedidoId = await store.encargar(e.id, prov ? +prov : null);
    m.close(); toast('Encargo agregado al pedido'); go(`#/pedidos/${pedidoId}`);
  });
}

function avisarEncargo(e, hermanos = []) {
  const tel = telEncargo(e);
  if (!tel) return toast('No tiene teléfono cargado', true);
  const nombre = (e.cliente?.nombre ? e.cliente.nombre.split(',').pop() : e.contacto).trim().split(' ')[0];
  const que = `${+e.cantidad !== 1 ? `${+e.cantidad} × ` : ''}${e.descripcion}`;
  // Vinculados: el mismo producto partido en reserva + encargo, y los otros productos del mismo pedido del cliente
  const mismoProd = h => h.descripcion === e.descripcion && h.producto_id === e.producto_id;
  const esperando = h => ['pendiente', 'pedido'].includes(h.estado);
  const faltan = hermanos.filter(h => mismoProd(h) && esperando(h)).reduce((s, h) => s + +h.cantidad, 0);
  const total = +e.cantidad + faltan;
  const cosa = h => `${+h.cantidad !== 1 ? `${+h.cantidad} × ` : ''}${h.descripcion}`;
  const otrosListos = hermanos.filter(h => !mismoProd(h) && listoParaRetirar(h)).map(cosa);
  const otrosEsperando = [...new Set(hermanos.filter(h => !mismoProd(h) && esperando(h)).map(h => h.descripcion))];
  let texto = e.tipo === 'reserva'
    ? `Hola ${nombre}! Te escribimos de GScom: te reservamos ${que}${e.reservado_hasta ? ` hasta el ${fdate(e.reservado_hasta)}` : ''}. Podés pasar a retirarlo cuando quieras.`
    : `Hola ${nombre}! Te escribimos de GScom: ya llegó lo que nos encargaste (${que}). Podés pasar a retirarlo cuando quieras.`;
  if (faltan) texto += ` Ya tenemos ${+e.cantidad} de las ${total}; las otras ${faltan} llegan cuando entre el pedido.`;
  if (otrosListos.length) texto += ` También tenemos listo: ${otrosListos.join(', ')}.`;
  if (otrosEsperando.length) texto += ` Todavía estamos esperando: ${otrosEsperando.join(', ')}; te avisamos cuando llegue.`;
  window.open(waLink(tel, texto), '_blank', 'noopener');
  store.actualizarEncargo(e.id, { fecha_aviso: new Date().toISOString() }).then(() => render()).catch(() => {});
}

// Entregar: si el producto está en la base, se abre Vender con todo cargado (al cobrar queda entregado);
// si no, se marca entregado directamente.
function entregarEncargo(e) {
  const m = modal(`Entregar ${e.tipo === 'reserva' ? 'reserva' : 'encargo'} N° ${e.numero}`, `
    <p>${+e.cantidad !== 1 ? `${+e.cantidad} × ` : ''}<b>${esc(e.descripcion)}</b> · ${esc(quienEncarga(e))}${e.precio != null ? ` · acordado ${money(e.precio)}` : ''}</p>
    <p class="small muted" style="margin-top:.6rem">${e.producto_id ? '<b>Vender</b> abre la pantalla de venta con el producto y el cliente cargados; al cobrar, queda entregado.'
      : 'Es un producto que no está en la base: podés venderlo como ítem manual, o solo marcarlo como entregado.'}</p>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn" id="solo">Solo marcar entregado</button><button class="btn ok" id="vender">Vender</button>`);
  $('#solo', m.el).onclick = () => run(async () => { await store.actualizarEncargo(e.id, { estado: 'entregado', fecha_entrega: new Date().toISOString() }); m.close(); toast('Entregado'); render(); });
  $('#vender', m.el).onclick = () => run(async () => {
    if (cart.items.length && !confirm('Tenés una venta en curso en "Vender". ¿Reemplazarla por esto?')) return;
    const p = e.producto_id ? (await store.productos()).find(x => x.id === e.producto_id) : null;
    cart = { ...carritoVacio(), cliente_id: e.cliente_id ? String(e.cliente_id) : '', notas: `${e.tipo === 'reserva' ? 'Reserva' : 'Encargo'} N° ${e.numero}${!e.cliente_id && e.contacto ? ` · ${e.contacto}` : ''}`, encargoId: e.id,
      items: [{ producto_id: p?.id || null, descripcion: p?.nombre || e.descripcion, cantidad: +e.cantidad, precio_unitario: e.precio ?? p?.precio_venta ?? 0, stock: p?.stock ?? 0, es_servicio: !p }] };
    m.close(); go('#/vender');
  });
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
// =====================================================================
// TIENDA ONLINE (administradores y usuarios "Tienda")
// Usa solo las funciones tienda_* de la base: nunca costos, proveedores,
// stock exacto ni datos de clientes.
// =====================================================================
const ESTADO_TIENDA = { disponible: ['Disponible', 'green'], ultimas: ['Últimas unidades', 'amber'], encargo: ['Por encargo', 'violet'] };
const COLOR_AVISO = { info: ['Azul', '#e8f0fe', '#1a4fa0'], ok: ['Verde', '#e6f6ec', '#17693a'], warn: ['Naranja', '#fff3e0', '#9a5200'] };
const tiendaURL = () => new URL('tienda.html', location.href).href;
const tiendaSel = new Set();

ROUTES.tienda = async ({ q }) => {
  const vista = q.get('v') === 'config' ? 'config' : 'productos';
  const datos = await store.tiendaAdmin();
  view().innerHTML = `
  <div class="page-head"><div><h1>Tienda online</h1><div class="small muted">Lo que ven los clientes en la tienda</div></div>
    <div class="actions"><button class="btn" id="compartir">Compartir link / QR</button><a class="btn" href="tienda.html" target="_blank" rel="noopener">Ver tienda ↗</a></div></div>
  <div class="chips"><button class="chip ${vista === 'productos' ? 'active' : ''}" data-v="">Productos</button><button class="chip ${vista === 'config' ? 'active' : ''}" data-v="config">Aviso, textos y categorías</button></div>
  <div id="tienda-cuerpo"></div>`;
  $$('[data-v]').forEach(b => b.onclick = () => go(b.dataset.v ? '#/tienda?v=config' : '#/tienda'));
  $('#compartir').onclick = compartirTienda;
  (vista === 'config' ? tiendaConfig : tiendaProductos)(datos);
};

function tiendaProductos({ productos, categorias, config }) {
  const ocultas = new Set(config.categorias_ocultas || []);
  const catName = id => categorias.find(c => c.id === id)?.nombre || '';
  const seVe = p => p.publicado && +p.precio_venta > 0 && !ocultas.has(p.categoria_id);
  const FILTROS = { todos: ['Todos', () => true], publicados: ['En la tienda', seVe], ocultos: ['Ocultos', p => !p.publicado], destacados: ['★ Destacados', p => p.destacado],
    sinfoto: ['Sin foto', p => !p.foto_url], sindesc: ['Sin descripción web', p => !p.descripcion_web] };
  let filtro = 'todos', texto = '', cat = '', mostrar = 150;
  $('#tienda-cuerpo').innerHTML = `
  <p class="small" id="resumen" style="margin:.2rem 0 .8rem"></p>
  <div class="card card-pad" style="margin-bottom:1rem"><div class="row" style="align-items:center">
    <div class="search" style="flex:3"><input class="input" id="buscar" placeholder="Buscar por nombre, marca o código"></div>
    <select class="input" id="cat" style="flex:1"><option value="">Todas las categorías</option>${categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}${ocultas.has(c.id) ? ' (oculta)' : ''}</option>`).join('')}</select></div></div>
  <div class="chips" id="filtros"></div>
  <div class="actions" id="acciones-sel" hidden style="margin-bottom:.8rem"><span class="small" id="nsel"></span>
    <button class="btn sm" data-lote="publicado:1">Mostrar en la tienda</button><button class="btn sm" data-lote="publicado:0">Ocultar</button>
    <button class="btn sm" data-lote="destacado:1">★ Destacar</button><button class="btn sm" data-lote="destacado:0">Quitar destacado</button></div>
  <div class="card tbl-wrap"><table class="tbl"><thead><tr><th style="width:32px"><input type="checkbox" id="all"></th><th style="width:56px"></th><th>Producto</th><th>Categoría</th><th class="num">Precio</th><th>Disponibilidad</th><th style="text-align:center">En tienda</th><th style="text-align:center">Destacado</th></tr></thead><tbody id="rows"></tbody></table></div>
  <div style="text-align:center;margin:1rem 0"><button class="btn" id="mas" hidden>Mostrar más</button></div>`;

  const lista = () => productos.filter(p => FILTROS[filtro][1](p) && (!cat || p.categoria_id === +cat)
    && (mismoCodigo(p.codigo_barras, texto) || matches(texto, p.nombre, p.marca, p.codigo_barras)));
  const avisos = p => [+p.precio_venta > 0 ? '' : '<span class="pill red" title="Los productos sin precio no se muestran">sin precio</span>',
    ocultas.has(p.categoria_id) ? '<span class="pill gray" title="Su categoría está oculta en la tienda">categoría oculta</span>' : ''].join(' ');
  function pintar() {
    const vis = productos.filter(seVe);
    $('#resumen').innerHTML = `Se ven <b>${vis.length}</b> productos en la tienda · <b>${vis.filter(p => p.destacado).length}</b> destacados · <b>${vis.filter(p => !p.foto_url).length}</b> sin foto`;
    $('#filtros').innerHTML = Object.entries(FILTROS).map(([k, [l, f]]) => `<button class="chip ${filtro === k ? 'active' : ''}" data-f="${k}">${l}<span class="count">${productos.filter(f).length}</span></button>`).join('');
    $$('#filtros .chip').forEach(b => b.onclick = () => { filtro = b.dataset.f; mostrar = 150; pintar(); });
    const l = lista();
    $('#rows').innerHTML = l.slice(0, mostrar).map(p => `<tr class="click" data-id="${p.id}">
      <td><input type="checkbox" data-sel="${p.id}" ${tiendaSel.has(p.id) ? 'checked' : ''}></td>
      <td>${p.foto_url ? `<img src="${esc(p.foto_url)}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff">` : '<div class="small muted" style="width:44px;height:44px;border:1px dashed var(--line);border-radius:6px;display:grid;place-items:center">—</div>'}</td>
      <td>${esc(p.nombre)} ${avisos(p)}<div class="small muted">${esc([p.marca, p.descripcion_web ? '✓ descripción web' : ''].filter(Boolean).join(' · '))}</div></td>
      <td class="muted">${esc(catName(p.categoria_id))}</td><td class="num">${money(p.precio_venta)}</td>
      <td><span class="pill ${ESTADO_TIENDA[p.estado][1]}">${ESTADO_TIENDA[p.estado][0]}</span></td>
      <td style="text-align:center"><input type="checkbox" data-pub="${p.id}" ${p.publicado ? 'checked' : ''} title="Mostrar en la tienda"></td>
      <td style="text-align:center"><button class="btn sm" data-dest="${p.id}" title="${p.destacado ? 'Quitar destacado' : 'Destacar'}" style="color:${p.destacado ? '#f5a623' : 'var(--muted)'};font-size:1.1rem;padding:.1rem .5rem">${p.destacado ? '★' : '☆'}</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">No hay productos con ese filtro.</td></tr>';
    $('#mas').hidden = l.length <= mostrar;
    $$('#rows tr[data-id]').forEach(tr => tr.onclick = e => { if (e.target.closest('input,button')) return; tiendaProductoModal(productos.find(p => p.id === +tr.dataset.id), catName, pintar); });
    $$('[data-sel]').forEach(cb => cb.onchange = () => { cb.checked ? tiendaSel.add(+cb.dataset.sel) : tiendaSel.delete(+cb.dataset.sel); pintarSel(); });
    $$('[data-pub]').forEach(cb => cb.onchange = () => cambiar([+cb.dataset.pub], 'publicado', cb.checked));
    $$('[data-dest]').forEach(b => b.onclick = () => { const p = productos.find(x => x.id === +b.dataset.dest); cambiar([p.id], 'destacado', !p.destacado); });
    pintarSel();
  }
  const pintarSel = () => { $('#acciones-sel').hidden = !tiendaSel.size; $('#nsel').textContent = `${tiendaSel.size} seleccionado(s):`; };
  // Cambia publicado/destacado de uno o varios productos y actualiza la lista sin recargar
  const cambiar = (ids, campo, valor) => run(async () => {
    if (campo === 'publicado') await store.publicarProductos(ids, valor);
    else for (const id of ids) await store.tiendaActualizarProducto(id, { [campo]: valor });
    ids.forEach(id => { const p = productos.find(x => x.id === id); if (p) p[campo] = valor; });
    if (ids.length > 1) { tiendaSel.clear(); toast(`${ids.length} productos actualizados`); }
    pintar();
  });
  $$('[data-lote]').forEach(b => b.onclick = () => { const [campo, v] = b.dataset.lote.split(':'); cambiar([...tiendaSel].filter(id => productos.some(p => p.id === id)), campo, v === '1'); });
  $('#all').onchange = e => { lista().slice(0, mostrar).forEach(p => e.target.checked ? tiendaSel.add(p.id) : tiendaSel.delete(p.id)); pintar(); };
  let t;
  $('#buscar').oninput = e => { clearTimeout(t); t = setTimeout(() => { texto = e.target.value.trim(); mostrar = 150; pintar(); }, 150); };
  $('#cat').onchange = e => { cat = e.target.value; mostrar = 150; pintar(); };
  $('#mas').onclick = () => { mostrar += 150; pintar(); };
  pintar();
  $('#buscar').focus();
}

function tiendaProductoModal(p, catName, alGuardar) {
  const m = modal(p.nombre, `
    <div class="small muted" style="margin-bottom:1rem">${esc([p.marca, catName(p.categoria_id), p.codigo_barras].filter(Boolean).join(' · '))} · <b style="color:var(--ink)">${money(p.precio_venta)}</b>
      · <span class="pill ${ESTADO_TIENDA[p.estado][1]}">${ESTADO_TIENDA[p.estado][0]}</span></div>
    <div style="margin-bottom:1rem">${FOTO_HTML}</div>
    <div class="field"><label>Descripción para la web</label><textarea class="input" name="descripcion_web" rows="4" maxlength="2000"
      placeholder="${esc(p.descripcion_publica ? `Si la dejás vacía se muestra: ${p.descripcion_publica}` : 'Características, medidas, compatibilidad, qué incluye…')}">${esc(p.descripcion_web)}</textarea></div>
    <div style="display:flex;gap:1.2rem;flex-wrap:wrap"><label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" name="publicado" ${p.publicado ? 'checked' : ''}> Mostrar en la tienda</label>
      <label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" name="destacado" ${p.destacado ? 'checked' : ''}> ★ Destacado (aparece primero)</label></div>
    <p class="small muted" style="margin-top:.9rem">El nombre, el precio y la categoría se cambian desde Productos (lo hace un administrador).</p>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Guardar</button>`);
  controlFoto(m.el, p.id, p.foto_url, url => { p.foto_url = url; alGuardar(); });
  $('#ok', m.el).onclick = () => run(async () => {
    const f = formData(m.el), cambios = { descripcion_web: f.descripcion_web, publicado: f.publicado, destacado: f.destacado };
    await store.tiendaActualizarProducto(p.id, cambios);
    Object.assign(p, cambios); m.close(); toast('Guardado'); alGuardar();
  });
}

function tiendaConfig({ config: c, categorias, productos }) {
  const ocultas = new Set(c.categorias_ocultas || []);
  const cuenta = id => productos.filter(p => p.categoria_id === id && p.publicado).length;
  const area = (name, label, ph, filas = 3, max = 1000) => `<div class="field"><label>${label}</label><textarea class="input" name="${name}" rows="${filas}" maxlength="${max}" placeholder="${esc(ph)}">${esc(c[name])}</textarea></div>`;
  const campo = (name, label, ph) => `<div class="field"><label>${label}</label><input class="input" name="${name}" maxlength="200" value="${esc(c[name])}" placeholder="${esc(ph)}"></div>`;
  $('#tienda-cuerpo').innerHTML = `<div style="max-width:820px">
    <div class="card card-pad" style="margin-bottom:1rem"><h2>Aviso</h2><p class="small muted" style="margin-bottom:.8rem">Una franja arriba de todo en la tienda. Dejalo vacío para no mostrar nada.</p>
      <div class="field"><input class="input" name="aviso" maxlength="300" value="${esc(c.aviso)}" placeholder="ej: El lunes 12 cerramos por feriado · Envíos sin cargo en la ciudad"></div>
      <div class="row" style="align-items:center"><div class="field" style="flex:0 0 180px"><label>Color</label><select class="input" name="aviso_color">${Object.entries(COLOR_AVISO).map(([k, [l]]) => `<option value="${k}" ${c.aviso_color === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div id="aviso-prev" style="flex:1;padding:.6rem 1rem;border-radius:8px;text-align:center;font-weight:500"></div></div></div>
    <div class="card card-pad" style="margin-bottom:1rem"><h2>Textos</h2>
      ${area('bienvenida', 'Bienvenida (arriba de los productos)', 'ej: Insumos, accesorios y service de informática. Consultá por lo que no veas publicado: lo conseguimos.', 2, 500)}
      ${area('pagos', 'Formas de pago', 'ej: Efectivo, transferencia, débito y crédito (consultá cuotas)')}
      ${area('envios', 'Envíos y retiro', 'ej: Retiro en el local. Envíos en la ciudad a cargo del cliente.')}</div>
    <div class="card card-pad" style="margin-bottom:1rem"><h2>Redes</h2><p class="small muted" style="margin-bottom:.8rem">Poné el usuario (ej: <b>@gscom</b>) o el link completo. Aparecen al pie de la tienda.</p>
      <div class="row">${campo('instagram', 'Instagram', '@usuario')}${campo('facebook', 'Facebook', 'usuario o link')}${campo('tiktok', 'TikTok', '@usuario')}</div></div>
    <div class="card card-pad" style="margin-bottom:1rem"><h2>Categorías</h2><p class="small muted" style="margin-bottom:.8rem">Las que desmarques no aparecen en la tienda (sus productos tampoco).</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.4rem .8rem">${categorias.map(k => `<label class="small" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" data-cat="${k.id}" ${ocultas.has(k.id) ? '' : 'checked'}> ${esc(k.nombre)} <span class="muted">(${cuenta(k.id)})</span></label>`).join('')}</div></div>
    <p class="small muted" style="margin-bottom:1rem">El nombre del negocio, la dirección, el teléfono, el WhatsApp y el horario se cambian en Ajustes${soloTienda() ? ' (lo hace un administrador)' : ''}.</p>
    <button class="btn primary lg" id="guardar">Guardar</button></div>`;
  const previa = () => {
    const [, fondo, color] = COLOR_AVISO[$('[name=aviso_color]').value], txt = $('[name=aviso]').value.trim();
    Object.assign($('#aviso-prev').style, { background: txt ? fondo : 'transparent', color: txt ? color : 'var(--muted)' });
    $('#aviso-prev').textContent = txt || '(sin aviso)';
  };
  $('[name=aviso]').oninput = $('[name=aviso_color]').onchange = previa; previa();
  $('#guardar').onclick = () => run(async () => {
    const f = formData($('#tienda-cuerpo'));
    f.categorias_ocultas = $$('[data-cat]').filter(cb => !cb.checked).map(cb => +cb.dataset.cat);
    await store.guardarTiendaConfig(f); toast('Tienda actualizada'); render();
  });
}

function compartirTienda() {
  const url = tiendaURL();
  const m = modal('Compartir la tienda', `
    <div style="text-align:center"><div style="width:190px;margin:0 auto 1rem">${qrSVG(url)}</div>
      <div class="mono small" style="word-break:break-all;margin-bottom:1rem">${esc(url)}</div></div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center">
      <button class="btn" id="copiar">Copiar link</button>
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(`Mirá nuestra tienda online 👉 ${url}`)}" target="_blank" rel="noopener">Compartir por WhatsApp</a>
      <button class="btn" id="imp-qr">Imprimir QR para el mostrador</button></div>`);
  $('#copiar', m.el).onclick = () => navigator.clipboard.writeText(url).then(() => toast('Link copiado'), () => prompt('Copiá el link:', url));
  $('#imp-qr', m.el).onclick = () => printHTML(`<div style="text-align:center;font-family:'DM Sans',sans-serif;padding-top:25mm">
    <img src="img/logo.png" alt="" style="width:30mm;height:30mm"><h1 style="font-size:30pt;margin:6mm 0 3mm">Nuestra tienda online</h1>
    <p style="font-size:15pt;margin:0">Escaneá con la cámara del celular, elegí y hacé tu pedido por WhatsApp</p>
    <div style="width:105mm;margin:12mm auto">${qrSVG(url)}</div><p style="font-size:11pt;color:#555">${esc(url)}</p></div>`, 'size: A4 portrait; margin: 10mm');
}

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
      <div class="row"><div class="field"><label>Garantía de service (días)</label><input class="input" type="number" name="garantia_dias" value="${n.garantia_dias}"></div>
        <div class="field"><label>Redondeo de precios calculados</label><select class="input" name="redondeo_precios" title="Para los productos con precio por margen y la actualización de precios">
          ${REDONDEOS.map(([v, l]) => `<option value="${v}" ${+v === +(n.redondeo_precios ?? 1) ? 'selected' : ''}>${v ? `Hacia arriba a ${l}` : l}</option>`).join('')}</select></div></div>
      <div class="field"><label>Texto al pie del comprobante de service</label><textarea class="input" name="pie_comprobante">${esc(n.pie_comprobante)}</textarea></div>
      <button class="btn primary" id="guardar">Guardar</button></div>
    ${store.modo === 'demo' ? `<div class="card card-pad"><h2>Modo demostración</h2>
      <p class="small" style="margin-bottom:.8rem">La app está funcionando con <b>datos de ejemplo guardados solo en este navegador</b>. Podés cargar, vender y probar todo libremente: nada se envía a ningún lado.</p>
      <p class="small muted" style="margin-bottom:1rem">Cuando conectemos Supabase, los datos pasan a guardarse en la base real y quedan disponibles desde cualquier computadora o celular.</p>
      <button class="btn danger" id="reset">Restablecer datos de ejemplo</button></div>` : ''}
  </div>
  ${store.modo !== 'demo' ? `<div class="card card-pad" style="margin-top:1rem"><h2>Usuarios</h2>
    <p class="small muted" style="margin-bottom:.8rem"><b>Administrador</b>: todo el sistema. <b>Tienda</b>: solo la pestaña Tienda (fotos, descripciones, destacados, aviso y textos); no ve costos, caja, clientes ni cuentas.</p>
    <div id="usuarios" class="small muted">Cargando…</div></div>` : ''}
  </div>`;
  if ($('#usuarios')) pintarUsuarios();
  $('#guardar').onclick = () => run(async () => { const f = formData(view()); f.garantia_dias = +f.garantia_dias || 0; f.redondeo_precios = +f.redondeo_precios || 0; await store.guardarNegocio(f); toast('Datos guardados'); });
  if ($('#reset')) $('#reset').onclick = () => { if (confirm('¿Borrar todo lo cargado y volver a los datos de ejemplo?')) { resetDemo(); cart = carritoVacio(); prodSel.clear(); toast('Datos restablecidos'); go('#/inicio'); } };
};

// Usuarios: cada uno con su acceso (el propio no se puede cambiar, para no quedarse afuera)
async function pintarUsuarios() {
  const usuarios = await run(() => store.usuarios());
  if (!usuarios) { $('#usuarios').textContent = 'No se pudieron cargar los usuarios.'; return; }
  const acceso = u => !u.activo ? 'no' : u.rol;
  const OPC = [['admin', 'Administrador'], ['tienda', 'Tienda'], ['no', 'Sin acceso']];
  $('#usuarios').className = '';
  $('#usuarios').innerHTML = `<table class="tbl"><tbody>${usuarios.map(u => `<tr><td>${esc(u.nombre)}<div class="small muted">${esc(u.email)}</div></td>
    <td style="width:190px">${u.yo ? '<span class="small muted">Vos (administrador)</span>'
      : `<select class="input" data-u="${u.id}">${OPC.map(([k, l]) => `<option value="${k}" ${acceso(u) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</td></tr>`).join('')}</tbody></table>
    <p class="small muted" style="margin-top:.6rem">Para sumar a alguien: en Supabase → Authentication → Add user (email y contraseña). Después aparece acá y le elegís el acceso.</p>`;
  $$('[data-u]').forEach(s => s.onchange = () => run(async () => {
    const u = usuarios.find(x => x.id === s.dataset.u), v = s.value;
    await store.actualizarUsuario(u.id, { activo: v !== 'no', rol: v === 'no' ? u.rol : v });
    Object.assign(u, { activo: v !== 'no', rol: v === 'no' ? u.rol : v });
    toast(`${u.nombre || u.email}: ${OPC.find(([k]) => k === v)[1]}`);
  }).then(() => { s.value = acceso(usuarios.find(x => x.id === s.dataset.u)); }));
}

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
const pintarNav = () => { $('nav.tabs').innerHTML = NAV.filter(([r]) => !soloTienda() || r === 'tienda').map(([r, l]) => `<a href="#/${r}" data-r="${r}">${l}</a>`).join(''); };
let iniciada = false;

async function iniciar() {
  if (store.modo === 'demo') {
    $('#demo-badge').hidden = false;
    ROL = (await store.perfil()).rol;
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
    ROL = perfil.rol || 'admin';
  }
  pintarNav();
  $('nav.tabs').hidden = false;
  if (!iniciada) { window.addEventListener('hashchange', render); if (!soloTienda()) { store.escucharRespuestas(avisarRespuesta); store.escucharSolicitudes(avisarSolicitud, quitarAvisoSolicitud); } iniciada = true; }
  render();
}
iniciar();
