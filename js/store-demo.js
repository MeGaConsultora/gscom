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

// ---------- API ----------
export const store = {
  modo: 'demo',

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
      Object.assign(byId('productos', p.id), p); save(); return clone(byId('productos', p.id));
    }
    const nuevo = { codigo_barras: '', codigo_interno: false, descripcion: '', marca: '', categoria_id: null,
      precio_costo: 0, precio_venta: 0, stock: 0, stock_minimo: 0, es_servicio: false, activo: true, created_at: now(), ...p };
    const stockInicial = +nuevo.stock || 0; nuevo.stock = 0;
    if (!nuevo.codigo_barras) { nuevo.codigo_barras = nuevoCodigoInterno(db); nuevo.codigo_interno = true; }
    if (db.productos.some(x => x.codigo_barras === nuevo.codigo_barras)) throw new Error('Ya existe un producto con ese código de barras');
    const r = insert('productos', nuevo);
    if (stockInicial) movStock(r.id, stockInicial, 'ajuste', { nota: 'Stock inicial' });
    save(); return clone(r);
  },
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
  async movimientosStock(productoId) { return clone(db.stock_movimientos.filter(m => m.producto_id === +productoId).reverse()); },

  // Clientes y equipos
  async clientes() { return clone(db.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))); },
  async cliente(id) { return clone(byId('clientes', id)); },
  async guardarCliente(c) {
    c = { ...c, nombre: nombreCliente(c) };  // igual que el trigger armar_nombre_cliente de la base
    if (c.id) { Object.assign(byId('clientes', c.id), c); save(); return clone(byId('clientes', c.id)); }
    const r = insert('clientes', { apellido: '', nombres: '', dni_cuit: '', telefono: '', email: '', direccion: '', notas: '', condicion_iva: 'Consumidor Final', created_at: now(), ...c });
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

    db.venta_items.filter(i => i.venta_id === v.id && i.producto_id).forEach(i => movStock(i.producto_id, i.cantidad, 'ajuste', { venta_id: v.id, nota: `Corrección de venta #${v.numero}` }));
    if (v.forma_pago === CC) insert('cc_movimientos', { cliente_id: v.cliente_id, fecha: now(), tipo: 'ajuste', monto: -v.total, concepto: `Corrección de venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
    else insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Corrección de venta #${v.numero}`, monto: v.total, forma_pago: v.forma_pago, venta_id: v.id });

    db.venta_items = db.venta_items.filter(i => i.venta_id !== v.id);
    const subtotal = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const total = subtotal - (+descuento || 0);
    for (const i of items) {
      insert('venta_items', { venta_id: v.id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: i.cantidad,
        precio_unitario: i.precio_unitario, subtotal: i.cantidad * i.precio_unitario });
      if (i.producto_id) movStock(i.producto_id, -i.cantidad, 'venta', { venta_id: v.id, nota: `Venta #${v.numero} (editada)` });
    }
    Object.assign(v, { cliente_id: cliente_id || null, subtotal, descuento: +descuento || 0, total, forma_pago, notas: notas ?? v.notas });
    if (forma_pago === CC) insert('cc_movimientos', { cliente_id: v.cliente_id, fecha: now(), tipo: 'cargo', monto: total, concepto: `Venta #${v.numero}`, forma_pago: '', venta_id: v.id, anulado: false });
    else insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Venta #${v.numero}`, monto: total, forma_pago, venta_id: v.id });
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
    return clone(Object.values(por).sort((a, b) => b.saldo - a.saldo));
  },
  async ccMovimientos(clienteId) { return clone(db.cc_movimientos.filter(m => m.cliente_id === +clienteId).reverse()); },
  async ccMovimiento(id) { return clone(byId('cc_movimientos', id) || null); },
  async cobrarCuenta(clienteId, { monto, forma_pago, nota = '' }) {
    if (!(+monto > 0)) throw new Error('El monto a cobrar tiene que ser mayor a cero');
    if (forma_pago === CC) throw new Error('Elegí cómo paga (efectivo, transferencia, etc.)');
    const c = byId('clientes', clienteId);
    const m = insert('cc_movimientos', { cliente_id: +clienteId, fecha: now(), tipo: 'pago', monto: -monto, concepto: nota || 'Cobro de cuenta corriente', forma_pago, anulado: false });
    insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Cobro cta. cte. — ${c.nombre}`, monto: +monto, forma_pago, cc_movimiento_id: m.id });
    save(); return m.id;
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
  async compras() { return clone(db.compras.slice().reverse().map(c => ({ ...c, items: db.compra_items.filter(i => i.compra_id === c.id) }))); },
  async registrarCompra({ proveedor_id, nro_comprobante, items, notas = '' }) {
    const c = insert('compras', { fecha: now(), proveedor_id: proveedor_id || null, nro_comprobante, notas,
      total: items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0) });
    for (const i of items) {
      insert('compra_items', { compra_id: c.id, ...i });
      movStock(i.producto_id, i.cantidad, 'compra', { compra_id: c.id });
      byId('productos', i.producto_id).precio_costo = i.costo_unitario;
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
      byId('productos', i.producto_id).precio_costo = i.costo_unitario;
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
    const r = insert('ordenes_servicio', { numero: db.seq.orden_numero, token: token(), accesorios: '', contrasena_equipo: '', diagnostico: '',
      trabajo_realizado: '', presupuesto: null, presupuesto_aprobado: null, estado: 'recibido', tecnico: '', fecha_ingreso: now(),
      fecha_estimada: null, fecha_entrega: null, total_cobrado: null, notas_internas: '', ...o });
    insert('orden_estados', { orden_id: r.id, estado: 'recibido', comentario: '', created_at: now() });
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
    items.forEach(i => insert('orden_items', { orden_id: +id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: +i.cantidad, precio_unitario: +i.precio_unitario }));
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
  async entregarOrden(id, { total, forma_pago, comentario = '' }) {
    const o = byId('ordenes_servicio', id);
    if (o.estado === 'entregado') throw new Error('La orden ya fue entregada');
    db.orden_items.filter(i => i.orden_id === o.id && i.producto_id).forEach(i => movStock(i.producto_id, -i.cantidad, 'service', { orden_id: o.id, nota: `Orden #${o.numero}` }));
    const anticipos = -db.cc_movimientos.filter(m => m.orden_id === o.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    const restante = Math.max(+total - anticipos, 0);
    if (anticipos > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'cargo', monto: anticipos, concepto: `Service orden #${o.numero} (aplica anticipo)`, forma_pago: '', orden_id: o.id, anulado: false });
    if (forma_pago === CC) {
      if (restante > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'cargo', monto: restante, concepto: `Service orden #${o.numero}`, forma_pago: '', orden_id: o.id, anulado: false });
    } else if (restante > 0) {
      insert('caja_movimientos', { fecha: now(), tipo: 'ingreso', concepto: `Service orden #${o.numero}`, monto: restante, forma_pago, orden_id: o.id });
    }
    o.total_cobrado = +total; o.forma_pago_entrega = forma_pago;
    await this.cambiarEstadoOrden(id, 'entregado', comentario);
  },
  async anularEntregaOrden(id) {
    const o = byId('ordenes_servicio', id);
    if (o.estado !== 'entregado') throw new Error('La orden no está entregada');
    db.orden_items.filter(i => i.orden_id === o.id && i.producto_id).forEach(i => movStock(i.producto_id, i.cantidad, 'anulacion', { orden_id: o.id, nota: `Anulación entrega orden #${o.numero}` }));
    const anticipos = -db.cc_movimientos.filter(m => m.orden_id === o.id && m.tipo === 'pago' && !m.anulado).reduce((s, m) => s + m.monto, 0);
    const restante = Math.max(+o.total_cobrado - anticipos, 0);
    if (+o.total_cobrado > 0) {
      if (anticipos > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'ajuste', monto: -anticipos, concepto: `Anulación entrega orden #${o.numero}`, forma_pago: '', orden_id: o.id, anulado: false });
      if (o.forma_pago_entrega === CC) {
        if (restante > 0) insert('cc_movimientos', { cliente_id: o.cliente_id, fecha: now(), tipo: 'ajuste', monto: -restante, concepto: `Anulación entrega orden #${o.numero}`, forma_pago: '', orden_id: o.id, anulado: false });
      } else if (restante > 0) {
        const fp = o.forma_pago_entrega || 'Efectivo';
        insert('caja_movimientos', { fecha: now(), tipo: 'egreso', concepto: `Anulación cobro service orden #${o.numero}`, monto: restante, forma_pago: fp, orden_id: o.id });
      }
    }
    Object.assign(o, { total_cobrado: null, fecha_entrega: null, forma_pago_entrega: '' });
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
      numero: o.numero, cliente: c?.nombres || (c?.nombre || '').split(' ')[0],
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
