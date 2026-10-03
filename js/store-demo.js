// =====================================================================
// GScom — capa de datos MODO DEMO: guarda todo en el navegador
// (localStorage) con datos de ejemplo. Misma interfaz que store-supabase.js.
// =====================================================================

const DEMO_KEY = 'gscom_demo_v3';
const CC = 'Cuenta corriente';

// ---------- código de barras interno (EAN-13, prefijo 20) ----------
export function ean13CheckDigit(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += +d12[i] * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}
function nuevoCodigoInterno(db) {
  db.seq.codigo = (db.seq.codigo || 0) + 1;
  const base = '20' + String(db.seq.codigo).padStart(10, '0');
  return base + ean13CheckDigit(base);
}

// ---------- almacenamiento ----------
let db = null;


function load() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* sin storage: usamos datos en memoria */ }
  const d = seed();
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch (e) {}  // así la página de seguimiento ve los mismos datos
  return d;
}
function save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) {} }
const now = () => new Date().toISOString();
const clone = x => JSON.parse(JSON.stringify(x));
function insert(table, row) {
  db.seq[table] = (db.seq[table] || 0) + 1;
  const r = { id: db.seq[table], ...row };
  db[table].push(r);
  return r;
}
const byId = (table, id) => db[table].find(r => r.id === +id);
function token() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));
}

export function resetDemo() { db = seed(); save(); }

// Precio por margen (mismo criterio que 27_margen_y_precios.sql): redondeo hacia arriba al múltiplo del negocio
const redondearPrecio = (v, m) => +m > 0 ? Math.ceil(Math.round(v * 100) / 100 / m) * m : Math.round(v * 100) / 100;
function aplicarMargen(p) {
  if (p.margen != null && p.margen !== '' && +p.precio_costo > 0) p.precio_venta = redondearPrecio(p.precio_costo * (1 + p.margen / 100), db.negocio.redondeo_precios ?? 1);
  return p;
}

// Tienda: configuración, estado público y descripción pública (mismo criterio que la base)
const TIENDA_CFG = { aviso: '', aviso_color: 'info', bienvenida: '', pagos: '', envios: '', instagram: '', facebook: '', tiktok: '', categorias_ocultas: [] };
const tiendaCfg = () => ({ ...TIENDA_CFG, ...(db.tienda_config || {}) });
const descPublica = (web, interna) => web ? web : /^⚠|\[dado de baja/.test(interna || '') ? '' : (interna || '');
function estadoTienda(p) {
  const reservado = (db.encargos || []).filter(e => e.estado === 'reservado' && e.producto_id === p.id).reduce((s, e) => s + +e.cantidad, 0);
  const disp = Math.max(p.stock - reservado, 0);
  return disp <= 0 ? 'encargo' : disp <= Math.max(p.stock_minimo, 1) ? 'ultimas' : 'disponible';
}

// ---------- API ----------
export const store = {
  modo: 'demo',

  // Para probar el rol "Tienda" en el demo: localStorage.gscom_demo_rol = 'tienda'
  async perfil() { let rol = 'admin'; try { rol = localStorage.getItem('gscom_demo_rol') || 'admin'; } catch {} return { activo: true, rol, nombre: 'Demo' }; },
  async negocio() { return clone(db.negocio); },
  async guardarNegocio(n) { Object.assign(db.negocio, n); save(); },

  // Productos
  async categorias() { return clone(db.categorias); },
  async crearCategoria(nombre) { const c = insert('categorias', { nombre }); save(); return clone(c); },
  async productos() { return clone(db.productos.filter(p => p.activo)); },
  async producto(id) { return clone(byId('productos', id)); },
  async productoPorCodigo(code) { return clone(db.productos.find(p => p.activo && p.codigo_barras === String(code).trim()) || null); },
  async guardarProducto(p) {
    if (p.id) {
      if (p.codigo_barras && db.productos.some(x => x.id !== p.id && x.codigo_barras === p.codigo_barras)) throw new Error('Ya existe un producto con ese código de barras');
      aplicarMargen(Object.assign(byId('productos', p.id), p)); save(); return clone(byId('productos', p.id));
    }
    const nuevo = { codigo_barras: '', codigo_interno: false, descripcion: '', marca: '', categoria_id: null,
      precio_costo: 0, precio_venta: 0, stock: 0, stock_minimo: 0, es_servicio: false, activo: true, created_at: now(), ...p };
    const stockInicial = +nuevo.stock || 0; nuevo.stock = 0;
    if (!nuevo.codigo_barras) { nuevo.codigo_barras = nuevoCodigoInterno(db); nuevo.codigo_interno = true; }
    if (db.productos.some(x => x.codigo_barras === nuevo.codigo_barras)) throw new Error('Ya existe un producto con ese código de barras');
    const r = insert('productos', aplicarMargen(nuevo));
    if (stockInicial) movStock(r.id, stockInicial, 'ajuste', { nota: 'Stock inicial' });
    save(); return clone(r);
  },
  // Tienda online (misma lógica que catalogo_tienda de la base)
  async catalogoTienda() {
    const cfg = tiendaCfg();
    const productos = db.productos.filter(p => p.activo && p.publicado !== false && !p.es_servicio && p.precio_venta > 0
      && !cfg.categorias_ocultas.includes(p.categoria_id)).map(p => ({
        id: p.id, nombre: p.nombre, marca: p.marca, descripcion: descPublica(p.descripcion_web, p.descripcion),
        categoria: byId('categorias', p.categoria_id)?.nombre || null, precio: p.precio_venta, foto: p.foto_url || '',
        destacado: !!p.destacado, etiqueta: p.etiqueta_web || null, estado: estadoTienda(p) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const n = db.negocio, { categorias_ocultas, ...tienda } = cfg;
    return clone({ negocio: { nombre: n.nombre, direccion: n.direccion, telefono: n.telefono, whatsapp: n.whatsapp, email: n.email, horario: n.horario }, tienda, productos });
  },
  // Pantalla "Tienda" (misma forma que tienda_admin_datos de la base)
  async tiendaAdmin() {
    return clone({ config: tiendaCfg(), categorias: db.categorias.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)),
      productos: db.productos.filter(p => p.activo && !p.es_servicio).map(p => ({
        id: p.id, codigo_barras: p.codigo_barras, nombre: p.nombre, marca: p.marca, categoria_id: p.categoria_id, precio_venta: p.precio_venta,
        publicado: p.publicado !== false, destacado: !!p.destacado, foto_url: p.foto_url || '', descripcion_web: p.descripcion_web || '',
        etiqueta_web: p.etiqueta_web || '', descripcion_publica: descPublica('', p.descripcion), estado: estadoTienda(p) })).sort((a, b) => a.nombre.localeCompare(b.nombre)) });
  },
  async tiendaActualizarProducto(id, datos) {
    const p = byId('productos', id); if (!p) throw new Error('Producto no encontrado');
    ['publicado', 'destacado', 'descripcion_web', 'etiqueta_web', 'foto_url'].forEach(k => { if (k in datos) p[k] = datos[k]; }); save();
  },
  async guardarTiendaConfig(cfg) { db.tienda_config = { ...tiendaCfg(), ...cfg }; save(); },
  async publicarProductos(ids, publicado) { ids.forEach(id => { const p = byId('productos', id); if (p) p.publicado = publicado; }); save(); },
  // Actualización masiva de precios (con registro para deshacer)
  async ajustarPrecios(ids, campo, porcentaje, redondeo, detalle = '', monto = null) {
    if (!['venta', 'costo'].includes(campo)) throw new Error('Campo no válido');
    if (monto != null ? !+monto : (!porcentaje || porcentaje < -90 || porcentaje > 500)) throw new Error(monto != null ? 'Monto fuera de rango' : 'Porcentaje fuera de rango');
    const lote = token(), fecha = now(), nuevo = v => monto != null ? v + +monto : v * (1 + porcentaje / 100);
    const afectados = ids.map(id => byId('productos', id)).filter(p => p && p.activo
      && (campo === 'venta' ? p.margen == null && p.precio_venta > 0 && nuevo(p.precio_venta) > 0 : p.precio_costo > 0 && nuevo(p.precio_costo) > 0));
    db.precios_historial ??= [];
    afectados.forEach(p => {
      const h = { lote, fecha, producto_id: p.id, costo_antes: p.precio_costo, venta_antes: p.precio_venta, detalle };
      if (campo === 'venta') p.precio_venta = redondearPrecio(nuevo(p.precio_venta), redondeo);
      else { p.precio_costo = Math.round(nuevo(p.precio_costo) * 100) / 100; aplicarMargen(p); }
      db.precios_historial.push({ ...h, costo_despues: p.precio_costo, venta_despues: p.precio_venta });
    });
    save(); return { lote, cantidad: afectados.length };
  },
  // margen % a un grupo (el precio pasa a calcularse solo); margen null = quitar el margen automático
  async asignarMargen(ids, margen, detalle = '') {
    if (margen != null && (margen < 0 || margen > 1000)) throw new Error('Margen fuera de rango (0 a 1000%)');
    const lote = token(), fecha = now();
    const afectados = ids.map(id => byId('productos', id)).filter(p => p && p.activo && (margen == null ? p.margen != null : +p.precio_costo > 0));
    db.precios_historial ??= [];
    afectados.forEach(p => {
      const h = { lote, fecha, producto_id: p.id, costo_antes: p.precio_costo, venta_antes: p.precio_venta, margen_antes: p.margen ?? null, cambia_margen: true, detalle };
      p.margen = margen == null ? null : +margen; aplicarMargen(p);
      db.precios_historial.push({ ...h, costo_despues: p.precio_costo, venta_despues: p.precio_venta, margen_despues: p.margen });
    });
    save(); return { lote, cantidad: afectados.length };
  },
  async deshacerAjustePrecios(lote) {
    let n = 0;
    (db.precios_historial || []).filter(h => h.lote === lote).forEach(h => {
      const p = byId('productos', h.producto_id);
      if (p && p.precio_costo === h.costo_despues && p.precio_venta === h.venta_despues && (!h.cambia_margen || (p.margen ?? null) === (h.margen_despues ?? null))) {
        p.precio_costo = h.costo_antes; p.precio_venta = h.venta_antes; if (h.cambia_margen) p.margen = h.margen_antes; n++;
      }
    });
    db.precios_historial = (db.precios_historial || []).filter(h => h.lote !== lote); save(); return n;
  },
  async ultimoAjustePrecios() {
    const h = (db.precios_historial || []).at(-1); if (!h) return null;
    const lote = db.precios_historial.filter(x => x.lote === h.lote);
    return { lote: h.lote, fecha: h.fecha, cantidad: lote.length, detalle: h.detalle };
  },

  // Solicitudes desde la tienda (misma lógica que 26_solicitudes_web.sql, sin límites)
  async crearSolicitudWeb({ nombre, telefono, comentario = '', items, trampa = '' }) {
    if (trampa) return { token: token(), numero: 0 };
    const tel = String(telefono || '').replace(/\D/g, '');
    if ((nombre || '').trim().length < 2) throw new Error('Poné tu nombre');
    if (tel.length < 8 || tel.length > 15) throw new Error('Revisá el número de WhatsApp');
    const lineas = items.map(x => ({ p: byId('productos', x.producto_id), cant: Math.min(Math.max(Math.round(+x.cantidad || 0), 0), 20) }))
      .filter(({ p, cant }) => p && p.activo && p.publicado !== false && !p.es_servicio && p.precio_venta > 0 && cant > 0)
      .map(({ p, cant }) => ({ producto_id: p.id, nombre: p.nombre, precio: p.precio_venta, cantidad: cant, estado: estadoTienda(p) }));
    if (!lineas.length) throw new Error('Los productos elegidos ya no están disponibles en la tienda');
    db.solicitudes_web ??= [];
    const s = insert('solicitudes_web', { token: token(), fecha: now(), nombre: nombre.trim().slice(0, 80), telefono: tel, comentario: (comentario || '').trim().slice(0, 300),
      items: lineas, total: lineas.reduce((t, l) => t + l.precio * l.cantidad, 0), estado: 'pendiente', atendida_at: null });
    save(); return { token: s.token, numero: s.id };
  },
  async verSolicitudWeb(tk) {
    db = load();   // la tienda y GScom pueden estar en pestañas distintas
    const s = (db.solicitudes_web || []).find(x => x.token === tk); if (!s) return null;
    return clone({ numero: s.id, fecha: s.fecha, nombre: s.nombre.split(' ')[0], items: s.items, total: s.total, estado: s.estado, comentario: s.comentario });
  },
  async cancelarSolicitudWeb(tk) {
    db = load();
    const s = (db.solicitudes_web || []).find(x => x.token === tk); if (!s) return 'no_existe';
    if (s.estado !== 'pendiente') return s.estado;
    db.solicitudes_web = db.solicitudes_web.filter(x => x !== s); save(); return 'cancelada';
  },
  async solicitudesWeb() { db = load(); return clone((db.solicitudes_web || []).filter(s => s.estado === 'pendiente')); },
  async atenderSolicitudWeb(id, estado) {
    db = load();
    const s = (db.solicitudes_web || []).find(x => x.id === +id && x.estado === 'pendiente');
    if (!s) throw new Error('La solicitud ya no está pendiente (quizás el cliente la canceló)');
    Object.assign(s, { estado, atendida_at: now() }); save(); return clone(s);
  },
  escucharSolicitudes() {},

  // Mayorista Elit: en el demo no hay conexión real; "sincronizar" carga un catálogo de ejemplo
  async elitFuncion(accion, extra = {}) {
    // carrito simulado (el de verdad está en Elit)
    db.elit_carrito ??= [];
    if (accion === 'carrito_ver') {
      // mismo formato que devuelve Elit (ver elitCarritosDe en app.js); precios en dólares
      const det = db.elit_carrito.map(c => { const e = (db.elit_productos || []).find(x => x.id === c.code) || {}; return { code: c.code, name: e.nombre, brand: e.marca, price: e.precio_usd, cart: c.quantity, cartTotal: c.quantity, vat: e.iva, stock: e.stock_total }; });
      const sub = det.reduce((s, d) => s + d.price * d.cart, 0), iva = det.reduce((s, d) => s + d.price * d.cart * d.vat / 100, 0);
      const shared = { warehouses: [{ warehouse: 9, name: 'Buenos Aires' }, { warehouse: 11, name: 'Santa Fe' }], saleConditions: [{ code: 101, name: 'Transferencia / Dep. Bancario' }], currentExchange: 1545 };
      return { codigo: 200, carrito: { shared, carts: det.length ? [{ items: det.length, details: det, warehouse: 11, saleCondition: 101,
        shippingMethods: [{ warehouse: 11, name: 'Santa Fe', shippings: [{ code: 4, name: 'Retira de Deposito', cost: 0, selected: true }] }],
        total: { subtotal: sub, surcharge: { total: 0 }, net: sub, shippings: { total: 0 }, vat: Math.round(iva * 1000) / 1000, internalTax: 0, perceptions: { total: 0 }, total: sub + iva, finalTotal: Math.round((sub + iva) * 1000) / 1000 } }] : [{ items: 0, details: [] }] } };
    }
    if (accion === 'carrito_vaciar') { db.elit_carrito = []; save(); return { codigo: 200 }; }
    if (accion === 'carrito_agregar') {
      for (const it of extra.items || []) { const i = db.elit_carrito.findIndex(c => c.code === it.code); i >= 0 ? db.elit_carrito[i].quantity = it.quantity : db.elit_carrito.push({ code: it.code, quantity: it.quantity }); }
      const p = extra.pedido_id && byId('pedidos', extra.pedido_id); if (p) p.elit_enviado_at = now();
      save(); return { ok: true, agregados: (extra.items || []).length, errores: [] };
    }
    if (accion === 'carrito_confirmar') {
      if (!db.elit_carrito.length) throw new Error('No cart available');
      const r = { codigo: 200, notas: [{ numero: 'NV-DEMO-' + Date.now().toString().slice(-5), warehouse: 9 }] };
      const p = extra.pedido_id && byId('pedidos', extra.pedido_id); if (p) Object.assign(p, { elit_confirmado_at: now(), elit_notas: r.notas });
      db.elit_carrito = []; save(); return r;
    }
    if (accion === 'probar') return { ok: true, campos_respuesta: ['codigo', 'resultado'], campos_producto: ['id', 'nombre', 'precio'], ejemplo: 'Mouse de ejemplo' };
    if (accion !== 'sincronizar') throw new Error('Acción desconocida');
    const ahora = now(), cot = 1545;
    const ej = [
      [18636, 'Acces Point Cudy AC1200 Gigabit', 'Conectividad', 'Extensores', 'CUDY', 28.8, 10.5, 337, '6971690792022'],
      [20101, 'Mouse Logitech M170 Inalámbrico', 'Periféricos', 'Mouses', 'LOGITECH', 9.1, 21, 120, '097855078565'],
      [20102, 'Teclado Logitech K120 USB', 'Periféricos', 'Teclados', 'LOGITECH', 8.4, 21, 0, '5099206020962'],
      [20103, 'SSD Kingston A400 480GB', 'Almacenamiento', 'Discos SSD', 'KINGSTON', 27.5, 10.5, 45, '740617263442'],
      [20104, 'Memoria Kingston Fury 8GB DDR4 3200', 'Memorias', 'DDR4', 'KINGSTON', 19.9, 10.5, 60, '740617318241'],
      [20105, 'Router TP-Link Archer C6', 'Conectividad', 'Routers', 'TP-LINK', 31.2, 10.5, 15, '6935364088725'],
      [20106, 'Auricular HyperX Cloud Stinger 2', 'Audio', 'Auriculares', 'HYPERX', 38.0, 21, 8, '196188580912'],
      [20107, 'Cartucho HP 664 Negro', 'Insumos', 'Cartuchos', 'HP', 14.3, 21, 200, '888793185478'],
    ];
    db.elit_productos = ej.map(([id, nombre, categoria, sub_categoria, marca, precio, iva, stock, ean]) => ({ id, nombre, categoria, sub_categoria, marca,
      precio_usd: precio, iva, impuesto_interno: 0, moneda: 2, markup: 0, cotizacion: cot, costo_ars: Math.round(precio * (1 + iva / 100) * cot * 100) / 100,
      stock_total: stock, stock_cd: stock, stock_cliente: 0, nivel_stock: stock > 50 ? 'alto' : 'bajo', ean, garantia: '12', link: '', imagen: '', miniatura: '', activo: true, sincronizado_at: ahora }));
    let n = 0;
    db.productos.filter(p => p.elit_id && p.elit_sigue_costo).forEach(p => { const e = db.elit_productos.find(x => x.id === p.elit_id); if (e && p.precio_costo !== e.costo_ars) { p.precio_costo = e.costo_ars; aplicarMargen(p); n++; } });
    db.elit_config = { ...(db.elit_config || { margen_defecto: 30 }), ultima_sync: ahora, ultimo_resultado: { total: ej.length, costos_actualizados: n } };
    save(); return { ok: true, total: ej.length, costos_actualizados: n };
  },
  async elitProductos() { return clone(db.elit_productos || []); },
  async elitCategorias() { return clone(db.elit_categorias || []); },
  async guardarElitCategorias(filas) {
    db.elit_categorias ??= [];
    filas.forEach(f => { const i = db.elit_categorias.findIndex(x => x.categoria === f.categoria); i >= 0 ? db.elit_categorias[i] = f : db.elit_categorias.push(f); });
    save();
  },
  async elitConfig() { return clone(db.elit_config || { id: 1, margen_defecto: 30, ultima_sync: null }); },
  async guardarElitConfig(cambios) { db.elit_config = { ...(db.elit_config || { margen_defecto: 30 }), ...cambios }; save(); },
  async elitAgregar(ids, publicar = true) {
    const cfg = db.elit_config || { margen_defecto: 30 };
    let prov = db.proveedores.find(p => p.nombre.trim().toUpperCase() === 'ELIT');
    if (!prov) prov = insert('proveedores', { nombre: 'ELIT', cuit: '', telefono: '', email: '', notas: '' });
    let creados = 0, vinculados = 0, ya = 0;
    for (const e of (db.elit_productos || []).filter(x => ids.includes(x.id))) {
      if (db.productos.some(p => p.elit_id === e.id)) { ya++; continue; }
      const c = (db.elit_categorias || []).find(x => x.categoria === e.categoria) || {};
      const existe = e.ean && db.productos.find(p => p.activo && p.codigo_barras === e.ean);
      if (existe) { Object.assign(existe, { elit_id: e.id, elit_sigue_costo: false }); vinculados++; continue; }   // ya lo tenías: solo referencia
      await this.guardarProducto({ nombre: e.nombre, marca: e.marca, codigo_barras: e.ean || '', categoria_id: c.categoria_id ?? null, proveedor_id: prov.id,
        precio_costo: e.costo_ars, precio_venta: 0, margen: c.margen ?? cfg.margen_defecto, foto_url: e.imagen, elit_id: e.id, elit_sigue_costo: true, stock_minimo: 0, publicado: publicar });
      creados++;
    }
    save(); return { creados, vinculados, ya_estaban: ya };
  },

  // Usuarios: en el modo demo no hay usuarios reales
  async usuarios() { return []; },
  async actualizarUsuario() {},
  async subirFotoProducto(productoId, blob) {
    const url = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(blob); });
    byId('productos', productoId).foto_url = url; save(); return url;
  },
  async quitarFotoProducto(productoId) { byId('productos', productoId).foto_url = ''; save(); },
  async eliminarProducto(id) {
    const p = byId('productos', id); if (!p) throw new Error('El producto no existe');
    const usado = [db.venta_items, db.compra_items, db.orden_items].some(t => t.some(i => i.producto_id === p.id));
    if (!usado) {
      db.stock_movimientos = db.stock_movimientos.filter(m => m.producto_id !== p.id);
      db.productos = db.productos.filter(x => x.id !== p.id); save(); return 'eliminado';
    }
    Object.assign(p, { activo: false, codigo_barras: null, descripcion: `${p.descripcion || ''} [dado de baja; código ${p.codigo_barras || '—'}]`.trim() });
    save(); return 'baja';
  },
  async ajustarStock(productoId, cantidad, nota) { movStock(productoId, cantidad, 'ajuste', { nota }); save(); },
  async contarStock(productoId, cantidad) {
    if (!(+cantidad >= 0)) throw new Error('La cantidad contada no puede ser negativa');
    const p = byId('productos', productoId), antes = p.stock;
    if (+cantidad !== antes) movStock(p.id, +cantidad - antes, 'ajuste', { nota: `Conteo de inventario (había ${antes}, se contaron ${+cantidad})` });
    p.ultimo_conteo = now(); save(); return +cantidad;
  },
  async movimientosStock(productoId) { return clone(db.stock_movimientos.filter(m => m.producto_id === +productoId).reverse()); },

  // Clientes y equipos
  async clientes() { return clone(db.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))); },
  async cliente(id) { return clone(byId('clientes', id)); },
  async guardarCliente(c) {
    if ('apellido' in c) c = { ...c, apellido: apellidoFormato(c.apellido) };
    if ('nombres' in c) c = { ...c, nombres: nombresFormato(c.nombres) };
    c = { ...c, nombre: nombreCliente(c) };  // igual que el trigger armar_nombre_cliente de la base
    if (c.id) { Object.assign(byId('clientes', c.id), c); save(); return clone(byId('clientes', c.id)); }
    const r = insert('clientes', { apellido: '', nombres: '', dni_cuit: '', telefono: '', email: '', direccion: '', notas: '', condicion_iva: 'Consumidor Final', cuenta_corriente: false, created_at: now(), ...c });
    save(); return clone(r);
  },
  async equipos(clienteId) { return clone(db.equipos.filter(e => e.cliente_id === +clienteId)); },
  async guardarEquipo(e) {
    if (e.id) { Object.assign(byId('equipos', e.id), e); save(); return clone(byId('equipos', e.id)); }
    const r = insert('equipos', { marca: '', modelo: '', nro_serie: '', notas: '', created_at: now(), ...e });
    save(); return clone(r);
  },
  async historialCliente(clienteId) {
    const id = +clienteId;
    const ventas = db.ventas.filter(v => v.cliente_id === id).map(v => ({ ...v, items: db.venta_items.filter(i => i.venta_id === v.id) }));
    const ordenes = db.ordenes_servicio.filter(o => o.cliente_id === id).map(o => ({ ...o, equipo: byId('equipos', o.equipo_id) }));
    return clone({ ventas, ordenes });
  },

  // Ventas
  async ventas() { return clone(db.ventas.slice().reverse()); },
  async venta(id) { const v = byId('ventas', id); return v && clone({ ...v, items: db.venta_items.filter(i => i.venta_id === v.id), cliente: byId('clientes', v.cliente_id) }); },
  async itemsVendidos(desdeISO) {
    const ok = new Set(db.ventas.filter(v => !v.anulada && v.fecha >= desdeISO).map(v => v.id));
    return clone(db.venta_items.filter(i => ok.has(i.venta_id)));
  },
  async registrarVenta({ cliente_id, items, descuento = 0, forma_pago, notas = '' }) {
    if (!items.length) throw new Error('La venta no tiene ítems');
    if (forma_pago === CC && !cliente_id) throw new Error('Para vender a cuenta corriente hay que elegir el cliente');
    const subtotal = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    db.seq.venta_numero = (db.seq.venta_numero || 0) + 1;
    const v = insert('ventas', { numero: db.seq.venta_numero, fecha: now(), cliente_id: cliente_id || null, subtotal, descuento: +descuento || 0,
      total: subtotal - (+descuento || 0), forma_pago, notas, anulada: false });
    for (const i of items) {
      insert('venta_items', { venta_id: v.id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: i.cantidad,
        precio_unitario: i.precio_unitario, subtotal: i.cantidad * i.precio_unitario });
      if (i.producto_id) movStock(i.producto_id, -i.cantidad, 'venta', { venta_id: v.id });
    }
    if (forma_pago === CC) insert('cc_movimientos', { cliente_id: v.cliente_id, fecha: now(), tipo: 'cargo', monto: v.total, concepto: `Venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
    else insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Venta #${v.numero}`, monto: v.total, forma_pago, venta_id: v.id });
    save(); return clone(v);
  },
  async anularVenta(id) {
    const v = byId('ventas', id);
    if (v.anulada) throw new Error('La venta ya estaba anulada');
    v.anulada = true;
    db.venta_items.filter(i => i.venta_id === v.id && i.producto_id).forEach(i => movStock(i.producto_id, i.cantidad, 'anulacion', { venta_id: v.id, nota: `Anulación venta #${v.numero}` }));
    if (v.forma_pago === CC) insert('cc_movimientos', { cliente_id: v.cliente_id, fecha: now(), tipo: 'ajuste', monto: -v.total, concepto: `Anulación venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
    else insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Anulación venta #${v.numero}`, monto: v.total, forma_pago: v.forma_pago, venta_id: v.id });
    save();
  },
  async editarVenta(id, { cliente_id, items, descuento = 0, forma_pago, notas }) {
    const v = byId('ventas', id);
    if (!v) throw new Error('Venta no encontrada');
    if (v.anulada) throw new Error('La venta está anulada: no se puede editar');
    if (!items.length) throw new Error('La venta no tiene ítems');
    if (forma_pago === CC && !cliente_id) throw new Error('Para vender a cuenta corriente hay que elegir el cliente');

    // Igual que editar_venta en la base: solo se corrige lo que cambió
    const subtotal = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const total = subtotal - (+descuento || 0);
    const firma = l => JSON.stringify(l.map(i => [i.producto_id || null, i.descripcion, +i.cantidad, +i.precio_unitario]).sort());
    const itemsIguales = firma(db.venta_items.filter(i => i.venta_id === v.id)) === firma(items);
    const plataIgual = total === v.total && forma_pago === v.forma_pago && (cliente_id || null) === (v.cliente_id || null);

    if (!itemsIguales) {
      db.venta_items.filter(i => i.venta_id === v.id && i.producto_id).forEach(i => movStock(i.producto_id, i.cantidad, 'ajuste', { venta_id: v.id, nota: `Corrección de venta #${v.numero}` }));
      db.venta_items = db.venta_items.filter(i => i.venta_id !== v.id);
      for (const i of items) {
        insert('venta_items', { venta_id: v.id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: i.cantidad,
          precio_unitario: i.precio_unitario, subtotal: i.cantidad * i.precio_unitario });
        if (i.producto_id) movStock(i.producto_id, -i.cantidad, 'venta', { venta_id: v.id, nota: `Venta #${v.numero} (editada)` });
      }
    }
    if (!plataIgual) {
      if (v.forma_pago === CC) insert('cc_movimientos', { cliente_id: v.cliente_id, fecha: now(), tipo: 'ajuste', monto: -v.total, concepto: `Corrección de venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
      else insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Corrección de venta #${v.numero}`, monto: v.total, forma_pago: v.forma_pago, venta_id: v.id });
      if (forma_pago === CC) insert('cc_movimientos', { cliente_id: cliente_id || null, fecha: now(), tipo: 'cargo', monto: total, concepto: `Venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
      else insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Venta #${v.numero}`, monto: total, forma_pago, venta_id: v.id });
    }
    Object.assign(v, { cliente_id: cliente_id || null, subtotal, descuento: +descuento || 0, total, forma_pago, notas: notas ?? v.notas });
    save();
  },
  async eliminarMovimientoCaja(id) {
    const m = byId('caja_movimientos', id);
    if (m.venta_id || m.orden_id || m.cc_movimiento_id) throw new Error('Este movimiento viene de una venta, un service o un cobro: anulalo desde su origen');
    db.caja_movimientos = db.caja_movimientos.filter(x => x.id !== m.id); save();
  },
  async editarMovimientoCaja(id, { concepto, monto, forma_pago }) {
    const m = byId('caja_movimientos', id);
    if (!(+monto > 0)) throw new Error('El monto tiene que ser mayor a cero');
    if (m.venta_id || m.orden_id || m.cc_movimiento_id) throw new Error('Este movimiento viene de una venta, un service o un cobro: no se edita directamente');
    Object.assign(m, { concepto, monto: +monto, forma_pago }); save();
  },

  // Fichero (cuentas corrientes)
  async ccSaldos() {
    const por = {};
    db.cc_movimientos.forEach(m => {
      const c = byId('clientes', m.cliente_id);
      const s = por[m.cliente_id] ??= { cliente_id: m.cliente_id, nombre: c?.nombre, telefono: c?.telefono, saldo: 0, deuda_desde: null, ultimo_movimiento: null };
      s.saldo += m.monto;
      if (m.tipo === 'cargo' && !m.anulado && (!s.deuda_desde || m.fecha < s.deuda_desde)) s.deuda_desde = m.fecha;
      if (!s.ultimo_movimiento || m.fecha > s.ultimo_movimiento) s.ultimo_movimiento = m.fecha;
    });
    // Clientes marcados "de cuenta corriente" sin movimientos todavía: aparecen igual, con saldo $0
    db.clientes.filter(c => c.cuenta_corriente && !por[c.id]).forEach(c => {
      por[c.id] = { cliente_id: c.id, nombre: c.nombre, telefono: c.telefono, saldo: 0, deuda_desde: null, ultimo_movimiento: null };
    });
    return clone(Object.values(por).sort((a, b) => b.saldo - a.saldo));
  },
  async ccMovimientos(clienteId) { return clone(db.cc_movimientos.filter(m => m.cliente_id === +clienteId).reverse().map(m => ({ ...m, venta: m.venta_id ? { notas: byId('ventas', m.venta_id)?.notas || '' } : null }))); },
  async ccMovimiento(id) { return clone(byId('cc_movimientos', id) || null); },
  async cobrarCuenta(clienteId, { monto, forma_pago, nota = '', imputaciones = [] }) {
    if (!(+monto > 0)) throw new Error('El monto a cobrar tiene que ser mayor a cero');
    if (forma_pago === CC) throw new Error('Elegí cómo paga (efectivo, transferencia, etc.)');
    if (imputaciones.reduce((s, x) => s + +x.monto, 0) > +monto + 0.009) throw new Error('Lo imputado supera el monto cobrado');
    const c = byId('clientes', clienteId);
    const m = insert('cc_movimientos', { cliente_id: +clienteId, fecha: now(), tipo: 'pago', monto: -monto, concepto: nota || 'Cobro de cuenta corriente', forma_pago, anulado: false });
    insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Cobro cta. cte. — ${c.nombre}`, monto: +monto, forma_pago, cc_movimiento_id: m.id });
    db.cc_imputaciones ||= [];
    imputaciones.filter(x => +x.monto > 0).forEach(x => insert('cc_imputaciones', { pago_id: m.id, grupo: x.grupo, monto: +x.monto }));
    save(); return m.id;
  },
  async ccImputaciones(clienteId) {
    const pagos = new Set(db.cc_movimientos.filter(m => m.cliente_id === +clienteId).map(m => m.id));
    return clone((db.cc_imputaciones || []).filter(x => pagos.has(x.pago_id)));
  },
  async cargarDeuda(clienteId, { monto, concepto }) {
    insert('cc_movimientos', { cliente_id: +clienteId, fecha: now(), tipo: 'cargo', monto: +monto, concepto, forma_pago: '', anulado: false }); save();
  },
  async editarCargoManual(id, { concepto, monto }) {
    const m = byId('cc_movimientos', id);
    if (!m || m.tipo !== 'cargo' || m.venta_id || m.orden_id) throw new Error('Este cargo no se puede editar directamente: viene de una venta o de una orden de service');
    if (!(+monto > 0)) throw new Error('El monto tiene que ser mayor a cero');
    Object.assign(m, { concepto, monto: +monto }); save();
  },
  async eliminarCargoManual(id) {
    const m = byId('cc_movimientos', id);
    if (!m || m.tipo !== 'cargo' || m.venta_id || m.orden_id) throw new Error('Este cargo no se puede eliminar directamente: viene de una venta o de una orden de service');
    db.cc_movimientos = db.cc_movimientos.filter(x => x.id !== m.id); save();
  },
  async anularCobroCuenta(ccId) {
    const m = byId('cc_movimientos', ccId);
    if (m.tipo !== 'pago') throw new Error('Solo se pueden anular cobros');
    if (m.anulado) throw new Error('El cobro ya estaba anulado');
    if (m.orden_id && byId('ordenes_servicio', m.orden_id)?.estado === 'entregado') throw new Error('Esa orden ya fue entregada: anulá la entrega primero');
    if (m.encargo_id && byId('encargos', m.encargo_id)?.estado === 'entregado') throw new Error('Ese encargo ya fue entregado: anulá la venta primero');
    const c = byId('clientes', m.cliente_id);
    m.anulado = true;
    insert('cc_movimientos', { cliente_id: m.cliente_id, fecha: now(), tipo: 'ajuste', monto: -m.monto, concepto: `Anulación de cobro del ${new Date(m.fecha).toLocaleDateString('es-AR')}`, forma_pago: '', anulado: false });
    insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Anulación cobro cta. cte. — ${c.nombre}`, monto: -m.monto, forma_pago: m.forma_pago, cc_movimiento_id: m.id });
    save();
  },

  // Caja
  async cajaMovimientos() { return clone(db.caja_movimientos.slice().reverse()); },
  async agregarMovimientoCaja(m) { const r = insert('caja_movimientos', { fecha: now(), ...m }); save(); return clone(r); },
  async cierresCaja() { return clone(db.caja_cierres.slice().reverse()); },
  async cerrarCaja(c) { const r = insert('caja_cierres', { fecha: now(), ...c }); save(); return clone(r); },

  // Proveedores y compras
  async proveedores() { return clone(db.proveedores); },
  async guardarProveedor(p) {
    if (p.id) { Object.assign(byId('proveedores', p.id), p); save(); return clone(byId('proveedores', p.id)); }
    const r = insert('proveedores', { cuit: '', telefono: '', email: '', notas: '', ...p }); save(); return clone(r);
  },
  async eliminarProveedor(id) {
    db.compras.filter(c => c.proveedor_id === +id).forEach(c => c.proveedor_id = null);
    db.proveedores = db.proveedores.filter(p => p.id !== +id); save();
  },
  // Pedidos de mercadería (no tocan stock)
  async pedidos() {
    db.pedidos ||= []; db.pedido_items ||= [];
    return clone(db.pedidos.slice().reverse().map(p => ({ ...p, items: db.pedido_items.filter(i => i.pedido_id === p.id) })));
  },
  async pedido(id) {
    db.pedidos ||= []; db.pedido_items ||= [];
    const p = byId('pedidos', id); return p ? clone({ ...p, items: db.pedido_items.filter(i => i.pedido_id === p.id) }) : null;
  },
  async crearPedido({ proveedor_id, items, notas = '' }) {
    db.pedidos ||= []; db.pedido_items ||= [];
    const validos = items.filter(i => +i.cantidad > 0);
    if (!validos.length) throw new Error('El pedido no tiene productos');
    db.seq.pedido_numero = (db.seq.pedido_numero || 0) + 1;
    const p = insert('pedidos', { numero: db.seq.pedido_numero, proveedor_id: proveedor_id || null, fecha: now(), estado: 'pendiente', fecha_recibido: null, notas });
    validos.forEach(i => insert('pedido_items', { pedido_id: p.id, producto_id: i.producto_id || null, descripcion: i.descripcion, codigo: i.codigo || '', cantidad: +i.cantidad }));
    save(); return p.id;
  },
  async actualizarItemsPedido(id, items) {
    const p = byId('pedidos', id);
    if (p.estado !== 'pendiente') throw new Error('Solo se puede modificar un pedido pendiente');
    db.pedido_items = db.pedido_items.filter(i => i.pedido_id !== p.id);
    items.filter(i => +i.cantidad > 0).forEach(i => insert('pedido_items', { pedido_id: p.id, producto_id: i.producto_id || null, descripcion: i.descripcion, codigo: i.codigo || '', cantidad: +i.cantidad, encargo_id: i.encargo_id || null }));
    const siguen = new Set(db.pedido_items.filter(i => i.pedido_id === p.id && i.encargo_id).map(i => i.encargo_id));
    (db.encargos || []).filter(e => e.pedido_id === p.id && e.estado === 'pedido' && !siguen.has(e.id)).forEach(e => Object.assign(e, { estado: 'pendiente', pedido_id: null }));
    save();
  },
  async actualizarPedido(id, cambios) {
    const p = byId('pedidos', id), antes = p.estado;
    Object.assign(p, cambios);
    // igual que el trigger sincronizar_encargos_pedido de la base
    if (cambios.estado && cambios.estado !== antes) {
      const es = (db.encargos || []).filter(e => e.pedido_id === p.id);
      if (p.estado === 'recibido') es.filter(e => e.estado === 'pedido').forEach(e => e.estado = 'recibido');
      if (p.estado === 'cancelado') { es.filter(e => e.estado === 'pedido').forEach(e => Object.assign(e, { estado: 'pendiente', pedido_id: null })); db.pedido_items.filter(i => i.pedido_id === p.id).forEach(i => i.encargo_id = null); }
      if (p.estado === 'pendiente') es.filter(e => e.estado === 'recibido').forEach(e => e.estado = 'pedido');
    }
    save();
  },

  // Encargos de clientes
  async encargos() {
    db.encargos ||= [];
    return clone(db.encargos.slice().reverse().map(e => ({ ...e, cliente: byId('clientes', e.cliente_id) || null,
      pedido: e.pedido_id ? (({ id, numero, estado }) => ({ id, numero, estado }))(byId('pedidos', e.pedido_id)) : null })));
  },
  async encargosDePedido(pedidoId) { return clone((db.encargos || []).filter(e => e.pedido_id === +pedidoId).map(e => ({ ...e, cliente: byId('clientes', e.cliente_id) || null }))); },
  async crearEncargo(e) {
    db.encargos ||= [];
    db.seq.encargo_numero = (db.seq.encargo_numero || 0) + 1;
    const r = insert('encargos', { numero: db.seq.encargo_numero, fecha: now(), cliente_id: null, contacto: '', telefono: '', producto_id: null, cantidad: 1, precio: null,
      proveedor_id: null, pedido_id: null, estado: 'pendiente', fecha_aviso: null, fecha_entrega: null, notas: '', tipo: 'encargo', reservado_hasta: null, solicitud: null, ...e });
    save(); return clone(r);
  },
  async encargar(id, proveedor_id) {
    db.pedidos ||= []; db.pedido_items ||= [];
    const e = byId('encargos', id);
    if (e.tipo === 'reserva') throw new Error('Una reserva de stock no se pide al proveedor');
    if (e.estado !== 'pendiente') throw new Error('El encargo ya fue pedido');
    let p = db.pedidos.filter(x => x.estado === 'pendiente' && (x.proveedor_id || null) === (proveedor_id || null)).pop();
    if (!p) { db.seq.pedido_numero = (db.seq.pedido_numero || 0) + 1; p = insert('pedidos', { numero: db.seq.pedido_numero, proveedor_id: proveedor_id || null, fecha: now(), estado: 'pendiente', fecha_recibido: null, notas: '' }); }
    insert('pedido_items', { pedido_id: p.id, producto_id: e.producto_id || null, descripcion: e.descripcion, codigo: byId('productos', e.producto_id)?.codigo_barras || '', cantidad: e.cantidad, encargo_id: e.id });
    Object.assign(e, { estado: 'pedido', pedido_id: p.id, proveedor_id: proveedor_id || null });
    save(); return p.id;
  },
  async actualizarEncargo(id, cambios) { Object.assign(byId('encargos', id), cambios); save(); },
  async cancelarEncargo(id) {
    const e = byId('encargos', id);
    if (['entregado', 'cancelado'].includes(e.estado)) throw new Error(`El encargo ya está ${e.estado}`);
    if (e.pedido_id && byId('pedidos', e.pedido_id)?.estado === 'pendiente') db.pedido_items = db.pedido_items.filter(i => i.encargo_id !== e.id);
    e.estado = 'cancelado'; save();
  },

  async compras() { return clone(db.compras.slice().reverse().map(c => ({ ...c, items: db.compra_items.filter(i => i.compra_id === c.id) }))); },
  async registrarCompra({ proveedor_id, nro_comprobante, items, notas = '' }) {
    const c = insert('compras', { fecha: now(), proveedor_id: proveedor_id || null, nro_comprobante, notas,
      total: items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0) });
    for (const i of items) {
      insert('compra_items', { compra_id: c.id, ...i });
      movStock(i.producto_id, i.cantidad, 'compra', { compra_id: c.id });
      { const p = byId('productos', i.producto_id); p.precio_costo = i.costo_unitario; aplicarMargen(p); }
    }
    save(); return clone(c);
  },
  async editarCompra(id, { proveedor_id, nro_comprobante, items, notas = '' }) {
    const c = byId('compras', id); if (!c) throw new Error('La compra no existe');
    db.compra_items.filter(i => i.compra_id === c.id).forEach(i => movStock(i.producto_id, -i.cantidad, 'ajuste', { compra_id: c.id, nota: `Corrección de compra #${c.id}` }));
    db.compra_items = db.compra_items.filter(i => i.compra_id !== c.id);
    for (const i of items) {
      insert('compra_items', { compra_id: c.id, ...i });
      movStock(i.producto_id, i.cantidad, 'compra', { compra_id: c.id, nota: `Compra #${c.id} (editada)` });
      { const p = byId('productos', i.producto_id); p.precio_costo = i.costo_unitario; aplicarMargen(p); }
    }
    Object.assign(c, { proveedor_id: proveedor_id || null, nro_comprobante, notas, total: items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0) });
    save();
  },
  async eliminarCompra(id) {
    const c = byId('compras', id); if (!c) throw new Error('La compra no existe');
    db.compra_items.filter(i => i.compra_id === c.id).forEach(i => movStock(i.producto_id, -i.cantidad, 'anulacion', { compra_id: c.id, nota: `Eliminación de compra #${c.id}` }));
    db.compra_items = db.compra_items.filter(i => i.compra_id !== c.id);
    db.compras = db.compras.filter(x => x.id !== c.id);
    save();
  },

  // Service técnico
  async ordenes() { return clone(db.ordenes_servicio.slice().reverse().map(o => ({ ...o, cliente: byId('clientes', o.cliente_id), equipo: byId('equipos', o.equipo_id) }))); },
  async orden(id) {
    const o = byId('ordenes_servicio', id); if (!o) return null;
    return clone({ ...o, cliente: byId('clientes', o.cliente_id), equipo: byId('equipos', o.equipo_id),
      items: db.orden_items.filter(i => i.orden_id === o.id), historial: db.orden_estados.filter(h => h.orden_id === o.id) });
  },
  async crearOrden(o) {
    db.seq.orden_numero = (db.seq.orden_numero || 0) + 1;
    const r = insert('ordenes_servicio', { numero: db.seq.orden_numero, token: token(), tipo: 'reparacion', accesorios: '', contrasena_equipo: '', diagnostico: '',
      trabajo_realizado: '', presupuesto: null, presupuesto_aprobado: null, estado: 'recibido', tecnico: '', fecha_ingreso: now(),
      fecha_estimada: null, fecha_entrega: null, total_cobrado: null, notas_internas: '', ...o });
    insert('orden_estados', { orden_id: r.id, estado: r.estado, comentario: '', created_at: now() });
    save(); return clone(r);
  },
  async actualizarOrden(id, cambios) { Object.assign(byId('ordenes_servicio', id), cambios); save(); },
  async cambiarEstadoOrden(id, estado, comentario = '') {
    const o = byId('ordenes_servicio', id);
    if (o.estado === estado && !comentario) return;
    o.estado = estado;
    if (estado === 'entregado' && !o.fecha_entrega) o.fecha_entrega = now();
    insert('orden_estados', { orden_id: o.id, estado, comentario, created_at: now() });
    save();
  },
  async guardarItemsOrden(id, items) {
    db.orden_items = db.orden_items.filter(i => i.orden_id !== +id);
    items.forEach(i => insert('orden_items', { orden_id: +id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: +i.cantidad, precio_unitario: +i.precio_unitario, componente: i.componente || '' }));
    save();
  },
  async anticiposOrden(ordenId) { return clone(db.cc_movimientos.filter(m => m.orden_id === +ordenId && m.tipo === 'pago')); },
  async registrarAnticipoOrden(id, { monto, forma_pago, nota = '' }) {
    if (!(+monto > 0)) throw new Error('El monto del anticipo tiene que ser mayor a cero');
    if (forma_pago === CC) throw new Error('Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)');
    const o = byId('ordenes_servicio', id); if (!o) throw new Error('Orden no encontrada');
    if (o.estado === 'entregado') throw new Error('La orden ya fue entregada: registrá el pago desde el Fichero del cliente');
    const m = insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'pago', monto: -monto, concepto: nota || `Anticipo orden #${o.numero}`, forma_pago, orden_id: o.id, anulado: false });
    insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Anticipo orden #${o.numero}`, monto: +monto, forma_pago, orden_id: o.id, cc_movimiento_id: m.id });
    save(); return m.id;
  },
  async anticiposEncargo(encargoId) { return clone(db.cc_movimientos.filter(m => m.encargo_id === +encargoId && m.tipo === 'pago')); },
  async registrarAnticipoEncargo(id, { monto, forma_pago, nota = '' }) {
    if (!(+monto > 0)) throw new Error('El monto del anticipo tiene que ser mayor a cero');
    if (forma_pago === CC) throw new Error('Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)');
    const e = byId('encargos', id); if (!e) throw new Error('Encargo no encontrado');
    if (['entregado', 'cancelado'].includes(e.estado)) throw new Error(`Ese ${e.tipo === 'reserva' ? 'reserva' : 'encargo'} ya está ${e.estado}`);
    if (!e.cliente_id) throw new Error(`Este ${e.tipo === 'reserva' ? 'reserva' : 'encargo'} no tiene un cliente cargado (es a nombre de alguien que todavía no es cliente): no se le puede registrar un anticipo`);
    const etiqueta = e.tipo === 'reserva' ? 'Anticipo reserva N°' : 'Anticipo encargo N°';
    const m = insert('cc_movimientos', { cliente_id: e.cliente_id, fecha: now(), tipo: 'pago', monto: -monto, concepto: nota || `${etiqueta} ${e.numero}`, forma_pago, encargo_id: e.id, anulado: false });
    insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `${etiqueta} ${e.numero}`, monto: +monto, forma_pago, encargo_id: e.id, cc_movimiento_id: m.id });
    save(); return m.id;
  },
  async aplicarAnticipoEncargo(encargoId, ventaId) {
    const e = byId('encargos', +encargoId); if (!e) return 0;
    const anticipos = -db.cc_movimientos.filter(m => m.encargo_id === e.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    if (anticipos > 0) {
      const etiqueta = e.tipo === 'reserva' ? 'Reserva N°' : 'Encargo N°';
      insert('cc_movimientos', { cliente_id: e.cliente_id, fecha: now(), tipo: 'cargo', monto: anticipos, concepto: `${etiqueta} ${e.numero} (aplica anticipo)`, forma_pago: '', encargo_id: e.id, venta_id: +ventaId, anulado: false });
      save();
    }
    return anticipos;
  },
  async revertirAnticipoEncargo(ventaId) {
    const m = db.cc_movimientos.filter(x => x.venta_id === +ventaId && x.encargo_id && x.tipo === 'cargo').sort((a, b) => b.id - a.id)[0];
    if (!m) return;
    insert('cc_movimientos', { cliente_id: m.cliente_id, fecha: now(), tipo: 'ajuste', monto: -m.monto, concepto: 'Anulación de venta: se libera el anticipo aplicado', forma_pago: '', encargo_id: m.encargo_id, venta_id: +ventaId, anulado: false });
    save();
  },
  // pagado: cuánto paga ahora (lo que falta queda en su cuenta corriente); si no viene, paga todo
  async entregarOrden(id, { total, forma_pago, comentario = '', notaInterna = '', pagado = null }) {
    const o = byId('ordenes_servicio', id);
    if (o.estado === 'entregado') throw new Error('La orden ya fue entregada');
    if (pagado != null && pagado < 0) throw new Error('El monto pagado no puede ser negativo');
    db.orden_items.filter(i => i.orden_id === o.id && i.producto_id).forEach(i => movStock(i.producto_id, -i.cantidad, 'service', { orden_id: o.id, nota: `Orden #${o.numero}` }));
    const anticipos = -db.cc_movimientos.filter(m => m.orden_id === o.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    const restante = Math.max(+total - anticipos, 0);
    const pagadoAhora = forma_pago === CC ? 0 : Math.min(pagado == null ? restante : +pagado, restante);
    if (anticipos > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'cargo', monto: anticipos, concepto: `Service orden #${o.numero} (aplica anticipo)`, forma_pago: '', orden_id: o.id, anulado: false });
    if (pagadoAhora > 0) insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Service orden #${o.numero}`, monto: pagadoAhora, forma_pago, orden_id: o.id });
    if (restante - pagadoAhora > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'cargo', monto: restante - pagadoAhora,
      concepto: `Service orden #${o.numero}${pagadoAhora > 0 ? ' (saldo)' : ''}`, forma_pago: '', orden_id: o.id, anulado: false });
    o.total_cobrado = +total; o.forma_pago_entrega = forma_pago; o.pagado_entrega = pagadoAhora;
    if (notaInterna.trim()) o.notas_internas = o.notas_internas ? `${o.notas_internas}\n${notaInterna.trim()}` : notaInterna.trim();
    await this.cambiarEstadoOrden(id, 'entregado', comentario);
  },
  async anularEntregaOrden(id) {
    const o = byId('ordenes_servicio', id);
    if (o.estado !== 'entregado') throw new Error('La orden no está entregada');
    db.orden_items.filter(i => i.orden_id === o.id && i.producto_id).forEach(i => movStock(i.producto_id, i.cantidad, 'anulacion', { orden_id: o.id, nota: `Anulación entrega orden #${o.numero}` }));
    const anticipos = -db.cc_movimientos.filter(m => m.orden_id === o.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    const restante = Math.max(+o.total_cobrado - anticipos, 0);
    const pagadoAhora = o.pagado_entrega ?? (o.forma_pago_entrega === CC ? 0 : restante);
    if (+o.total_cobrado > 0) {
      if (anticipos > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'ajuste', monto: -anticipos, concepto: `Anulación entrega orden #${o.numero}`, forma_pago: '', orden_id: o.id, anulado: false });
      if (pagadoAhora > 0) insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Anulación cobro service orden #${o.numero}`, monto: pagadoAhora, forma_pago: o.forma_pago_entrega || 'Efectivo', orden_id: o.id });
      if (restante - pagadoAhora > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'ajuste', monto: -(restante - pagadoAhora), concepto: `Anulación entrega orden #${o.numero}`, forma_pago: '', orden_id: o.id, anulado: false });
    }
    Object.assign(o, { total_cobrado: null, fecha_entrega: null, forma_pago_entrega: '', pagado_entrega: null });
    await this.cambiarEstadoOrden(id, 'listo', 'Se anuló la entrega registrada por error.');
  },

  // Página pública de seguimiento (en Supabase será la función seguimiento_orden)
  async seguimiento(tok) {
    const o = db.ordenes_servicio.find(x => x.token === tok); if (!o) return null;
    const c = byId('clientes', o.cliente_id), e = byId('equipos', o.equipo_id);
    const anticipoPagado = -db.cc_movimientos.filter(m => m.orden_id === o.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    const saldoPendiente = o.estado === 'entregado' && o.forma_pago_entrega !== CC ? 0
      : Math.max((o.total_cobrado ?? o.presupuesto ?? 0) - anticipoPagado, 0);
    return clone({
      numero: o.numero, tipo: o.tipo, cliente: c?.nombres || (c?.nombre || '').split(' ')[0],
      equipo: e ? [e.tipo, e.marca, e.modelo].filter(Boolean).join(' ') : '',
      falla: o.falla_reportada, estado: o.estado, fecha_ingreso: o.fecha_ingreso, fecha_estimada: o.fecha_estimada,
      fecha_entrega: o.fecha_entrega, presupuesto: o.presupuesto, presupuesto_aprobado: o.presupuesto_aprobado,
      anticipo_pagado: anticipoPagado, saldo_pendiente: saldoPendiente,
      historial: db.orden_estados.filter(h => h.orden_id === o.id).map(h => ({ estado: h.estado, comentario: h.comentario, fecha: h.created_at })),
      negocio: db.negocio,
    });
  },
  async presupuestosRespondidos() {
    return db.ordenes_servicio.filter(o => o.estado === 'presupuesto' && o.presupuesto_aprobado != null).length;
  },
  // En demo, la respuesta llega desde otra pestaña (seguimiento.html) vía el evento "storage"
  escucharRespuestas(cb) {
    window.addEventListener('storage', e => {
      if (e.key !== DEMO_KEY || !e.newValue) return;
      const nuevo = JSON.parse(e.newValue);
      const vistos = new Set(db.orden_estados.map(h => h.id));
      db = nuevo;
      nuevo.orden_estados.filter(h => !vistos.has(h.id)).forEach(h => {
        const m = /^El cliente (ACEPTÓ|RECHAZÓ)/.exec(h.comentario || '');
        if (m) cb(h.orden_id, m[1] === 'ACEPTÓ');
      });
    });
  },
  async responderPresupuesto(tok, acepta) {
    const o = db.ordenes_servicio.find(x => x.token === tok);
    if (!o) throw new Error('Orden no encontrada');
    if (o.estado !== 'presupuesto' || o.presupuesto == null) throw new Error('Esta orden no tiene un presupuesto pendiente de respuesta');
    if (o.presupuesto_aprobado != null) throw new Error('El presupuesto ya fue respondido');
    o.presupuesto_aprobado = !!acepta;
    insert('orden_estados', { orden_id: o.id, estado: o.estado, created_at: now(),
      comentario: `El cliente ${acepta ? 'ACEPTÓ' : 'RECHAZÓ'} el presupuesto desde el link de seguimiento.` });
    save(); return this.seguimiento(tok);
  },
};

// Formato del nombre (igual que el trigger armar_nombre_cliente de la base, 33_formato_nombre_cliente.sql):
// apellido / razón social en MAYÚSCULAS y nombres con la primera letra de cada uno en mayúscula
const limpiar = t => String(t || '').trim().replace(/\s+/g, ' ');
const apellidoFormato = t => limpiar(t).toLocaleUpperCase('es');
const nombresFormato = t => limpiar(t).toLocaleLowerCase('es').replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('es'));
function nombreCliente({ apellido = '', nombres = '', nombre = '' }) {
  apellido = apellido.trim(); nombres = nombres.trim();
  return apellido && nombres ? `${apellido}, ${nombres}` : apellido || nombres || nombre;
}

function movStock(producto_id, cantidad, tipo, extra = {}) {
  const p = byId('productos', producto_id);
  insert('stock_movimientos', { producto_id: +producto_id, cantidad: +cantidad, tipo, nota: '', created_at: now(), ...extra });
  if (p && !p.es_servicio) p.stock = +(p.stock + +cantidad).toFixed(2);
}

// ---------- datos de ejemplo ----------
function seed() {
  const d = {
    seq: {}, negocio: { nombre: 'GScom', direccion: 'Av. Siempre Viva 742', telefono: '342 555-0000', whatsapp: '5493425550000',
      email: 'contacto@gscom.com.ar', horario: 'Lun a Vie 9 a 13 y 16 a 20 · Sáb 9 a 13',
      pie_comprobante: 'Los equipos no retirados dentro de los 90 días se consideran abandonados.', garantia_dias: 30 },
    categorias: [], productos: [], stock_movimientos: [], clientes: [], equipos: [], ventas: [], venta_items: [],
    caja_movimientos: [], caja_cierres: [], proveedores: [], compras: [], compra_items: [],
    ordenes_servicio: [], orden_items: [], orden_estados: [], cc_movimientos: [],
  };
  const prev = db; db = d;
  const daysAgo = (n, h = 11) => { const t = new Date(); t.setDate(t.getDate() - n); t.setHours(h, 15, 0, 0); return t.toISOString(); };

  ['Almacenamiento', 'Periféricos', 'Cables y adaptadores', 'Componentes', 'Redes', 'Servicios'].forEach(nombre => insert('categorias', { nombre }));
  const prods = [
    ['SSD Kingston A400 480GB', 1, 'Kingston', 28000, 42000, 8, 3, '740617261196'],
    ['SSD NVMe WD Blue SN580 1TB', 1, 'Western Digital', 62000, 89000, 2, 2, ''],
    ['Pendrive SanDisk 64GB', 1, 'SanDisk', 6500, 11000, 15, 5, ''],
    ['Mouse inalámbrico Logitech M170', 2, 'Logitech', 9000, 15500, 12, 4, '097855164486'],
    ['Teclado USB Genius KB-116', 2, 'Genius', 7500, 13000, 6, 3, ''],
    ['Auriculares con micrófono', 2, 'Noga', 8000, 14500, 1, 3, ''],
    ['Cable HDMI 2.0 1.8m', 3, 'Netmak', 2500, 5500, 20, 5, ''],
    ['Cargador universal notebook 90W', 3, 'Noga', 14000, 24000, 4, 2, ''],
    ['Memoria RAM DDR4 8GB 3200', 4, 'Kingston', 19000, 29000, 5, 2, ''],
    ['Pasta térmica Arctic MX-4 4g', 4, 'Arctic', 5000, 9500, 9, 3, ''],
    ['Router TP-Link Archer C6', 5, 'TP-Link', 38000, 55000, 0, 1, ''],
    ['Mano de obra — limpieza completa', 6, '', 0, 18000, 0, 0, '', true],
    ['Mano de obra — instalación de sistema', 6, '', 0, 22000, 0, 0, '', true],
  ];
  prods.forEach(([nombre, categoria_id, marca, precio_costo, precio_venta, stock, stock_minimo, codigo, es_servicio]) => {
    const p = { nombre, categoria_id, marca, precio_costo, precio_venta, stock: 0, stock_minimo, descripcion: '', es_servicio: !!es_servicio,
      activo: true, created_at: daysAgo(40), codigo_barras: codigo, codigo_interno: false };
    if (!codigo) { p.codigo_barras = nuevoCodigoInterno(d); p.codigo_interno = true; }
    const r = insert('productos', p);
    if (stock) movStock(r.id, stock, 'ajuste', { nota: 'Stock inicial', created_at: daysAgo(40) });
  });

  const clientes = [
    ['Pérez', 'Juan', '28.456.789', '3425551234', 'juanperez@mail.com'],
    ['Gómez', 'María', '31.222.333', '3425559876', 'mgomez@mail.com'],
    ['Estudio Contable Ríos', '', '30-71234567-8', '3424567890', 'admin@estudiorios.com'],
    ['Fernández', 'Lucas', '40.111.222', '3426661122', ''],
  ];
  clientes.forEach(([apellido, nombres, dni_cuit, telefono, email], i) => insert('clientes', { apellido, nombres, nombre: nombreCliente({ apellido, nombres }), dni_cuit, telefono, email, direccion: '', notas: i === 2 ? 'Cliente con abono mensual. Facturar a la razón social.' : '', created_at: daysAgo(60 - i * 10) }));
  insert('equipos', { cliente_id: 1, tipo: 'Notebook', marca: 'Lenovo', modelo: 'IdeaPad 3 15ITL6', nro_serie: 'PF3ABC12', notas: '', created_at: daysAgo(30) });
  insert('equipos', { cliente_id: 2, tipo: 'PC de escritorio', marca: 'Armada', modelo: 'Ryzen 5 5600G', nro_serie: '', notas: 'Gabinete negro', created_at: daysAgo(20) });
  insert('equipos', { cliente_id: 3, tipo: 'Impresora', marca: 'HP', modelo: 'LaserJet Pro M404', nro_serie: 'VNB3K12345', notas: '', created_at: daysAgo(10) });
  insert('equipos', { cliente_id: 1, tipo: 'Celular', marca: 'Samsung', modelo: 'Galaxy A32', nro_serie: '', notas: '', created_at: daysAgo(5) });
  insert('equipos', { cliente_id: 4, tipo: 'Notebook', marca: 'HP', modelo: '250 G8', nro_serie: '5CD1234XYZ', notas: '', created_at: daysAgo(2) });
  insert('proveedores', { nombre: 'Distribuidora Mayorista Norte', cuit: '30-70000000-1', telefono: '0341 444-5555', email: '', notas: '' });
  insert('proveedores', { nombre: 'Air Computers', cuit: '30-60000000-2', telefono: '011 4000-0000', email: '', notas: '' });

  // Ventas de ejemplo
  const venta = (dias, cliente_id, items, forma_pago) => {
    d.seq.venta_numero = (d.seq.venta_numero || 0) + 1;
    const subtotal = items.reduce((s, [pid, q]) => s + q * byId('productos', pid).precio_venta, 0);
    const v = insert('ventas', { numero: d.seq.venta_numero, fecha: daysAgo(dias, 10 + dias % 7), cliente_id, subtotal, descuento: 0, total: subtotal, forma_pago, notas: '', anulada: false });
    items.forEach(([pid, q]) => {
      const p = byId('productos', pid);
      insert('venta_items', { venta_id: v.id, producto_id: pid, descripcion: p.nombre, cantidad: q, precio_unitario: p.precio_venta, subtotal: q * p.precio_venta });
      movStock(pid, -q, 'venta', { venta_id: v.id, created_at: v.fecha });
    });
    insert('caja_movimientos', { fecha: v.fecha, tipo: 'ingreso', concepto: `Venta #${v.numero}`, monto: v.total, forma_pago, venta_id: v.id });
  };
  venta(25, 1, [[4, 1], [7, 1]], 'Efectivo');
  venta(12, 3, [[1, 2], [9, 2]], 'Transferencia');
  venta(6, null, [[3, 2]], 'Efectivo');
  venta(3, 2, [[5, 1], [4, 1]], 'Débito');
  venta(0, null, [[7, 2], [10, 1]], 'Efectivo');
  venta(0, 4, [[8, 1]], 'Mercado Pago');

  // Cuenta corriente de ejemplo: el estudio contable tiene saldo pendiente
  insert('cc_movimientos', { cliente_id: 3, fecha: daysAgo(15), tipo: 'cargo', monto: 78000, concepto: 'Mantenimiento mensual de equipos', forma_pago: '', anulado: false });
  const pago = insert('cc_movimientos', { cliente_id: 3, fecha: daysAgo(4), tipo: 'pago', monto: -30000, concepto: 'Cobro de cuenta corriente', forma_pago: 'Transferencia', anulado: false });
  insert('caja_movimientos', { fecha: daysAgo(4), tipo: 'ingreso', concepto: 'Cobro cta. cte. — Estudio Contable Ríos', monto: 30000, forma_pago: 'Transferencia', cc_movimiento_id: pago.id });

  // Órdenes de service de ejemplo
  const orden = (dias, cliente_id, equipo_id, falla, estados, extra = {}) => {
    d.seq.orden_numero = (d.seq.orden_numero || 0) + 1;
    const o = insert('ordenes_servicio', { numero: d.seq.orden_numero, token: token(), cliente_id, equipo_id, falla_reportada: falla,
      accesorios: 'Cargador', contrasena_equipo: '', diagnostico: '', trabajo_realizado: '', presupuesto: null, presupuesto_aprobado: null,
      estado: estados[estados.length - 1][0], tecnico: 'Gonzalo', fecha_ingreso: daysAgo(dias), fecha_estimada: null, fecha_entrega: null,
      total_cobrado: null, notas_internas: '', ...extra });
    estados.forEach(([estado, comentario, dd]) => insert('orden_estados', { orden_id: o.id, estado, comentario, created_at: daysAgo(dd, 12) }));
    if (o.estado === 'entregado') o.fecha_entrega = daysAgo(estados[estados.length - 1][2], 12);
    return o;
  };
  orden(30, 1, 1, 'Muy lenta, tarda mucho en encender.', [['recibido', '', 30], ['diagnostico', '', 29], ['reparacion', 'Reemplazo de disco por SSD y reinstalación.', 28], ['listo', '', 27], ['entregado', '', 26]],
    { diagnostico: 'Disco mecánico con sectores dañados.', trabajo_realizado: 'Se reemplazó HDD por SSD 480GB, instalación de Windows y programas.', presupuesto: 64000, presupuesto_aprobado: true, total_cobrado: 64000 });
  orden(4, 2, 2, 'No da video. Enciende pero la pantalla queda en negro.', [['recibido', '', 4], ['diagnostico', '', 3], ['presupuesto', 'Hay que reemplazar la memoria RAM. Presupuesto: $29.000.', 2]],
    { diagnostico: 'Módulo de RAM defectuoso.', presupuesto: 29000, accesorios: 'Ninguno' });
  orden(3, 3, 3, 'Atasca las hojas y hace ruido al imprimir.', [['recibido', '', 3], ['diagnostico', '', 2], ['repuesto', 'Pedimos el rodillo de arrastre; llega en 3–5 días hábiles.', 1]],
    { diagnostico: 'Rodillo de arrastre gastado.', presupuesto: 35000, presupuesto_aprobado: true, accesorios: 'Cable de alimentación' });
  orden(1, 4, 5, 'Se recalienta y se apaga sola jugando.', [['recibido', '', 1], ['reparacion', 'Estamos haciendo limpieza interna y cambio de pasta térmica.', 0]],
    { diagnostico: 'Ventilador obstruido, pasta térmica seca.', presupuesto: 27500, presupuesto_aprobado: true });
  orden(0, 1, 4, 'Pantalla rota, el táctil funciona.', [['recibido', '', 0]], { accesorios: 'Funda' });
  insert('orden_items', { orden_id: 4, producto_id: 12, descripcion: 'Mano de obra — limpieza completa', cantidad: 1, precio_unitario: 18000 });
  insert('orden_items', { orden_id: 4, producto_id: 10, descripcion: 'Pasta térmica Arctic MX-4 4g', cantidad: 1, precio_unitario: 9500 });

  db = prev;
  return d;
}

// Cargar datos al final (cuando todas las funciones ya están definidas)
db = load();
