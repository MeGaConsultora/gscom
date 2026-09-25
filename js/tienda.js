// =====================================================================
// GScom — Tienda online (página pública, sin login)
// Lee solo el catálogo público (función catalogo_tienda): nunca costos,
// proveedores ni cantidades exactas. El carrito vive en el navegador del
// cliente y el pedido se envía por WhatsApp.
// =====================================================================
import { store, linkWhatsApp } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(+n || 0);
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const matches = (q, ...f) => { const t = norm(q).trim(); return !t || t.split(/\s+/).every(w => f.some(x => norm(x).includes(w))); };
const POR_PAGINA = 48;
const CARRITO_KEY = 'gscom_carrito';
const ESTADO = {
  disponible: ['Disponible', 'green', 'Agregar'],
  ultimas: ['Últimas unidades', 'amber', 'Agregar'],
  encargo: ['Por encargo', 'violet', 'Encargar'],
};
const ICONO = { 'Cables y adaptadores': '🔌', Cables: '🔌', Redes: '📶', Almacenamiento: '💾', Audio: '🎧', 'TV y Audio': '📺', Gaming: '🎮', Energía: '🔋',
  Papel: '📄', Tóner: '🖨️', 'Cartuchos y tintas': '🖨️', Impresión: '🖨️', Periféricos: '🖱️', Componentes: '🧩', Accesorios: '🎒' };
const icono = p => ICONO[p.categoria] || '🖥️';

let catalogo = { negocio: {}, productos: [] };
let filtro = { q: '', cat: '', soloDisp: false, orden: 'nombre' }, mostrados = POR_PAGINA;
let carrito = leerCarrito();   // { [id]: cantidad }

function leerCarrito() { try { return JSON.parse(localStorage.getItem(CARRITO_KEY)) || {}; } catch { return {}; } }
function guardarCarrito() { try { localStorage.setItem(CARRITO_KEY, JSON.stringify(carrito)); } catch { /* sin storage */ } }
const prod = id => catalogo.productos.find(p => p.id === +id);

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
function modal(titulo, cuerpo, pie = '') {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(titulo)}</h3><button class="x" data-close aria-label="Cerrar">×</button></div>
    <div class="modal-body">${cuerpo}</div>${pie ? `<div class="modal-foot">${pie}</div>` : ''}</div>`;
  const cerrar = () => { bg.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  bg.addEventListener('mousedown', e => { if (e.target === bg && e.clientX < bg.clientWidth) cerrar(); });
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]')) cerrar(); });
  document.addEventListener('keydown', tecla); document.body.appendChild(bg);
  return { el: bg, cerrar };
}
const imagen = p => p.foto ? `<img src="${esc(p.foto)}" alt="${esc(p.nombre)}" loading="lazy">` : `<div class="t-ph">${icono(p)}</div>`;
const badge = p => `<span class="pill ${ESTADO[p.estado][1]} t-badge">${ESTADO[p.estado][0]}</span>`;

// ---------- Listado ----------
function lista() {
  const l = catalogo.productos.filter(p => (!filtro.cat || p.categoria === filtro.cat) && (!filtro.soloDisp || p.estado !== 'encargo')
    && matches(filtro.q, p.nombre, p.marca, p.descripcion, p.categoria));
  const cmp = { nombre: (a, b) => a.nombre.localeCompare(b.nombre), menor: (a, b) => a.precio - b.precio, mayor: (a, b) => b.precio - a.precio }[filtro.orden];
  // con stock primero, después por el orden elegido
  return l.sort((a, b) => (a.estado === 'encargo') - (b.estado === 'encargo') || cmp(a, b));
}
function pintar() {
  const l = lista();
  $('#cuenta').textContent = `${l.length} producto${l.length === 1 ? '' : 's'}${filtro.cat ? ` en ${filtro.cat}` : ''}`;
  $('#grid').innerHTML = l.slice(0, mostrados).map(p => `
    <div class="t-card" data-id="${p.id}">
      <div class="t-img">${imagen(p)}${badge(p)}</div>
      <div class="t-body">
        ${p.marca ? `<div class="t-marca">${esc(p.marca)}</div>` : ''}
        <div class="t-nombre">${esc(p.nombre)}</div>
        <div class="t-precio">${money(p.precio)}</div>
        <button class="btn ${p.estado === 'encargo' ? '' : 'primary'} sm block" data-add="${p.id}">${carrito[p.id] ? `✓ En el pedido (${carrito[p.id]})` : ESTADO[p.estado][2]}</button>
      </div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No encontramos productos con esa búsqueda. ¿Lo necesitás? Escribinos y lo conseguimos.</div>';
  $('#mas').hidden = l.length <= mostrados;
  $$('.t-card').forEach(c => c.onclick = e => { if (e.target.closest('[data-add]')) return; detalle(prod(c.dataset.id)); });
  $$('[data-add]').forEach(b => b.onclick = () => agregar(+b.dataset.add, 1));
}
const categorias = () => [...new Set(catalogo.productos.map(p => p.categoria).filter(Boolean))].sort();
function elegirCategoria(c) { filtro.cat = c; mostrados = POR_PAGINA; pintarCategorias(); pintar(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function pintarCategorias() {
  // computadora: chips
  $('#cats').innerHTML = [['', 'Todo'], ...categorias().map(c => [c, c])].map(([k, l]) => `<button class="chip ${filtro.cat === k ? 'active' : ''}" data-c="${esc(k)}">${esc(l)}</button>`).join('');
  $$('#cats .chip').forEach(b => b.onclick = () => elegirCategoria(b.dataset.c));
  // celular: botón que abre el panel de categorías
  $('#cats-actual').textContent = filtro.cat || 'Todas';
  $('#cats-quitar').hidden = !filtro.cat;
}
// Panel de categorías (celular): todas a la vista, con ícono y cantidad
function panelCategorias() {
  const cuenta = c => catalogo.productos.filter(p => !c || p.categoria === c).length;
  const m = modal('Categorías', `<div class="t-catgrid">${[['', 'Todas', '🛍️'], ...categorias().map(c => [c, c, ICONO[c] || '🖥️'])].map(([k, l, ic]) =>
    `<button class="t-cat ${filtro.cat === k ? 'active' : ''}" data-c="${esc(k)}"><span class="t-cat-ic">${ic}</span><span>${esc(l)}</span><span class="muted small">${cuenta(k)}</span></button>`).join('')}</div>`);
  m.el.classList.add('sheet');
  $$('.t-cat', m.el).forEach(b => b.onclick = () => { m.cerrar(); elegirCategoria(b.dataset.c); });
}

// ---------- Detalle ----------
function detalle(p) {
  const m = modal(p.nombre, `<div class="t-det">
      <div class="t-img">${imagen(p)}${badge(p)}</div>
      <div>${p.marca ? `<div class="t-marca">${esc(p.marca)}</div>` : ''}
        <h2 style="font-size:1.15rem;margin:.2rem 0 .5rem">${esc(p.nombre)}</h2>
        ${p.descripcion ? `<p style="margin-bottom:.8rem">${esc(p.descripcion)}</p>` : ''}
        <div style="font-size:1.8rem;font-weight:700;margin-bottom:.4rem">${money(p.precio)}</div>
        <p class="small muted" style="margin-bottom:1rem">${p.estado === 'encargo' ? 'Sin stock en este momento: lo conseguimos por encargo. Te confirmamos precio y demora por WhatsApp.'
          : p.estado === 'ultimas' ? 'Quedan pocas unidades.' : 'Disponible para retirar en el local.'}</p>
        <div style="display:flex;gap:.6rem;align-items:center">
          <div class="qty"><button data-m>−</button><input value="1" id="cant" inputmode="numeric"><button data-p>+</button></div>
          <button class="btn primary" id="agregar">${ESTADO[p.estado][2]}</button></div></div></div>`);
  const cant = $('#cant', m.el);
  $('[data-m]', m.el).onclick = () => cant.value = Math.max(1, (+cant.value || 1) - 1);
  $('[data-p]', m.el).onclick = () => cant.value = (+cant.value || 1) + 1;
  $('#agregar', m.el).onclick = () => { agregar(p.id, Math.max(1, Math.round(+cant.value || 1))); m.cerrar(); };
}

// ---------- Carrito ----------
function agregar(id, n) {
  carrito[id] = (carrito[id] || 0) + n; guardarCarrito(); pintarBoton(); pintar();
  toast(`${prod(id).estado === 'encargo' ? 'Encargo agregado' : 'Agregado'} al pedido`);
}
function pintarBoton() {
  const ids = Object.keys(carrito).filter(id => prod(id));
  const n = ids.reduce((s, id) => s + carrito[id], 0);
  $('#carrito-btn').hidden = !n;
  $('#carrito-n').textContent = n;
  $('#carrito-total').textContent = money(ids.reduce((s, id) => s + carrito[id] * prod(id).precio, 0));
}
function verCarrito() {
  const m = modal('Tu pedido', '<div id="lineas"></div>', '');
  const neg = catalogo.negocio;
  const pintarLineas = () => {
    const ids = Object.keys(carrito).filter(id => prod(id) && carrito[id] > 0);
    if (!ids.length) { m.cerrar(); pintarBoton(); pintar(); return; }
    const total = ids.reduce((s, id) => s + carrito[id] * prod(id).precio, 0);
    const hayEncargo = ids.some(id => prod(id).estado === 'encargo');
    $('#lineas', m.el).innerHTML = `${ids.map(id => { const p = prod(id); return `<div class="t-linea">
        ${p.foto ? `<img src="${esc(p.foto)}" alt="">` : `<div class="t-ph-mini">${icono(p)}</div>`}
        <div><div style="font-weight:500">${esc(p.nombre)}</div><div class="small muted">${money(p.precio)} c/u${p.estado === 'encargo' ? ' · <b style="color:#6b3fc4">por encargo</b>' : ''}</div>
          <div class="qty" style="display:inline-flex;margin-top:.3rem"><button data-m="${id}">−</button><input value="${carrito[id]}" data-q="${id}" inputmode="numeric"><button data-p="${id}">+</button></div></div>
        <div class="right"><b>${money(carrito[id] * p.precio)}</b><br><button class="x" data-del="${id}" title="Quitar">×</button></div></div>`; }).join('')}
      <div class="row" style="align-items:baseline;margin:1rem 0"><span>Total estimado</span><span class="right" style="font-size:1.5rem;font-weight:700">${money(total)}</span></div>
      ${hayEncargo ? '<p class="small muted" style="margin-bottom:.8rem">Los productos <b>por encargo</b> se consiguen a pedido: te confirmamos precio y demora.</p>' : ''}
      <div class="row"><div class="field"><label>Tu nombre</label><input class="input" id="nombre" autocomplete="name"></div>
        <div class="field"><label>Comentario (opcional)</label><input class="input" id="coment" placeholder="ej: lo retiro el sábado"></div></div>
      <p class="small muted" style="margin:-.2rem 0 1rem">Retiro en el local${neg.direccion ? `: ${esc(neg.direccion)}` : ''}. Precios en pesos, sujetos a cambio sin previo aviso.</p>
      <button class="btn wa lg block" id="enviar" ${neg.whatsapp ? '' : 'disabled'}>Enviar pedido por WhatsApp</button>
      ${neg.whatsapp ? '' : '<p class="small muted" style="margin-top:.4rem">El local todavía no cargó su WhatsApp.</p>'}
      <button class="btn block" id="vaciar" style="margin-top:.5rem">Vaciar pedido</button>`;
    const cambiar = (id, v) => { carrito[id] = Math.max(0, Math.round(v)); if (!carrito[id]) delete carrito[id]; guardarCarrito(); pintarLineas(); pintarBoton(); };
    $$('[data-m]', m.el).forEach(b => b.onclick = () => cambiar(b.dataset.m, carrito[b.dataset.m] - 1));
    $$('[data-p]', m.el).forEach(b => b.onclick = () => cambiar(b.dataset.p, carrito[b.dataset.p] + 1));
    $$('[data-q]', m.el).forEach(i => i.onchange = () => cambiar(i.dataset.q, +i.value || 0));
    $$('[data-del]', m.el).forEach(b => b.onclick = () => cambiar(b.dataset.del, 0));
    $('#vaciar', m.el).onclick = () => { if (confirm('¿Vaciar el pedido?')) { carrito = {}; guardarCarrito(); pintarLineas(); } };
    $('#enviar', m.el).onclick = () => {
      const nombre = $('#nombre', m.el).value.trim(), coment = $('#coment', m.el).value.trim();
      const lineas = ids.map(id => { const p = prod(id); return `• ${carrito[id]} × ${p.nombre} — ${money(carrito[id] * p.precio)}${p.estado === 'encargo' ? ' (por encargo)' : ''}`; });
      const texto = `Hola ${neg.nombre || 'GScom'}! Quiero hacer este pedido desde la tienda online:\n\n${lineas.join('\n')}\n\nTotal estimado: ${money(total)}`
        + `${nombre ? `\nNombre: ${nombre}` : ''}${coment ? `\nComentario: ${coment}` : ''}\n\nQuedo a la espera de la confirmación. ¡Gracias!`;
      window.open(linkWhatsApp(neg.whatsapp, texto), '_blank', 'noopener');
    };
  };
  pintarLineas();
}

// ---------- Arranque ----------
function pintarPie() {
  const n = catalogo.negocio;
  const wa = n.whatsapp ? linkWhatsApp(n.whatsapp, 'Hola! Tengo una consulta desde la tienda online.') : '';
  $('#pie').innerHTML = `<b>${esc(n.nombre || 'GScom')}</b><br>${[n.direccion, n.telefono && `Tel. ${n.telefono}`].filter(Boolean).map(esc).join(' · ')}
    ${n.horario ? `<br>${esc(n.horario)}` : ''}${wa ? `<br><a href="${wa}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>` : ''}
    <br><span class="small">Precios en pesos argentinos, sujetos a cambio sin previo aviso. Imágenes ilustrativas.</span>`;
}

async function iniciar() {
  try { catalogo = await store.catalogoTienda(); }
  catch (e) { console.error(e); $('#grid').innerHTML = '<div class="empty" style="grid-column:1/-1">No pudimos cargar el catálogo. Probá de nuevo en un rato.</div>'; return; }
  document.title = `${catalogo.negocio.nombre || 'GScom'} — Tienda de informática`;
  Object.keys(carrito).forEach(id => { if (!prod(id)) delete carrito[id]; });   // productos que ya no están publicados
  guardarCarrito();
  pintarCategorias(); pintarPie(); pintar(); pintarBoton();
  let t;
  $('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { filtro.q = e.target.value; mostrados = POR_PAGINA; pintar(); }, 150); };
  $('#solo-disp').onchange = e => { filtro.soloDisp = e.target.checked; mostrados = POR_PAGINA; pintar(); };
  $('#orden').onchange = e => { filtro.orden = e.target.value; pintar(); };
  $('#mas').onclick = () => { mostrados += POR_PAGINA; pintar(); };
  $('#carrito-btn').onclick = verCarrito;
  $('#cats-btn').onclick = panelCategorias;
  $('#cats-quitar').onclick = () => elegirCategoria('');
}
iniciar();
