// =====================================================================
// GScom — capa de datos con Supabase. Misma interfaz que store-demo.js.
// Las operaciones que tocan varias tablas (ventas, compras, entregas)
// son funciones SQL atómicas definidas en sql/01_esquema.sql.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Traduce errores de Postgres a mensajes entendibles
function check({ data, error }) {
  if (!error) return data;
  console.error(error);
  if (error.code === '23505') throw new Error('Ya existe un registro con ese dato (¿código de barras repetido?)');
  if (error.code === '42501' || /permission|policy/i.test(error.message)) throw new Error('Sin permiso. ¿Tu usuario está activado?');
  if (/Failed to fetch|NetworkError/i.test(error.message)) throw new Error('Sin conexión a internet');
  throw new Error(error.message);
}
const q = async p => check(await p);

const ORDEN_SEL = '*, cliente:clientes(*), equipo:equipos(*)';

export const store = {
  modo: 'supabase',

  // Sesión
  async sesion() { return (await sb.auth.getSession()).data.session; },
  async login(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Email o contraseña incorrectos' : error.message);
  },
  async logout() { await sb.auth.signOut(); },
  async perfil() {
    const s = await this.sesion(); if (!s) return null;
    const p = await q(sb.from('perfiles').select('*').eq('id', s.user.id).maybeSingle());
    return p ? { ...p, email: s.user.email } : { activo: false, email: s.user.email };
  },

  async negocio() { return q(sb.from('negocio').select('*').eq('id', 1).single()); },
  async guardarNegocio(n) { await q(sb.from('negocio').update(n).eq('id', 1)); },

  // Productos
  async categorias() { return q(sb.from('categorias').select('*').order('nombre')); },
  async crearCategoria(nombre) { return q(sb.from('categorias').insert({ nombre }).select().single()); },
  async productos() { return q(sb.from('productos').select('*').eq('activo', true).order('nombre')); },
  async producto(id) { return q(sb.from('productos').select('*').eq('id', id).single()); },
  async productoPorCodigo(code) { return q(sb.from('productos').select('*').eq('activo', true).eq('codigo_barras', String(code).trim()).maybeSingle()); },
  async guardarProducto(p) {
    const { id, stock, ...datos } = p;
    if (id) return q(sb.from('productos').update(datos).eq('id', id).select().single());
    if (!datos.codigo_barras) datos.codigo_barras = null; // la base genera el código interno
    const r = await q(sb.from('productos').insert(datos).select().single());
    if (+stock) await this.ajustarStock(r.id, +stock, 'Stock inicial');
    return r;
  },
  async ajustarStock(productoId, cantidad, nota) {
    await q(sb.from('stock_movimientos').insert({ producto_id: productoId, cantidad, tipo: 'ajuste', nota: nota || '' }));
  },
  async movimientosStock(productoId) {
    return q(sb.from('stock_movimientos').select('*').eq('producto_id', productoId).order('created_at', { ascending: false }).limit(100));
  },

  // Clientes y equipos
  async clientes() { return q(sb.from('clientes').select('*').order('nombre')); },
  async cliente(id) { return q(sb.from('clientes').select('*').eq('id', id).maybeSingle()); },
  async guardarCliente(c) {
    const { id, ...datos } = c;
    return id ? q(sb.from('clientes').update(datos).eq('id', id).select().single())
              : q(sb.from('clientes').insert(datos).select().single());
  },
  async equipos(clienteId) { return q(sb.from('equipos').select('*').eq('cliente_id', clienteId).order('created_at')); },
  async guardarEquipo(e) {
    const { id, ...datos } = e;
    return id ? q(sb.from('equipos').update(datos).eq('id', id).select().single())
              : q(sb.from('equipos').insert(datos).select().single());
  },
  async historialCliente(clienteId) {
    const [ventas, ordenes] = await Promise.all([
      q(sb.from('ventas').select('*, items:venta_items(*)').eq('cliente_id', clienteId).order('fecha', { ascending: false })),
      q(sb.from('ordenes_servicio').select('*, equipo:equipos(*)').eq('cliente_id', clienteId).order('fecha_ingreso', { ascending: false })),
    ]);
    return { ventas, ordenes };
  },

  // Ventas
  async ventas() { return q(sb.from('ventas').select('*').order('fecha', { ascending: false }).limit(2000)); },
  async venta(id) { return q(sb.from('ventas').select('*, items:venta_items(*), cliente:clientes(*)').eq('id', id).single()); },
  async registrarVenta({ cliente_id, items, descuento = 0, forma_pago, notas = '' }) {
    const id = await q(sb.rpc('registrar_venta', {
      p_cliente_id: cliente_id || null,
      p_items: items.map(({ producto_id, descripcion, cantidad, precio_unitario }) => ({ producto_id, descripcion, cantidad, precio_unitario })),
      p_descuento: +descuento || 0, p_forma_pago: forma_pago, p_notas: notas,
    }));
    return q(sb.from('ventas').select('*').eq('id', id).single());
  },
  async itemsVendidos(desdeISO) {
    return q(sb.from('venta_items').select('*, venta:ventas!inner(fecha, anulada)')
      .gte('venta.fecha', desdeISO).eq('venta.anulada', false).limit(20000));
  },
  async anularVenta(id) { await q(sb.rpc('anular_venta', { p_venta_id: id })); },

  // Caja
  async cajaMovimientos() { return q(sb.from('caja_movimientos').select('*').order('fecha', { ascending: false }).limit(3000)); },
  async agregarMovimientoCaja(m) { return q(sb.from('caja_movimientos').insert(m).select().single()); },
  async cierresCaja() { return q(sb.from('caja_cierres').select('*').order('fecha', { ascending: false }).limit(60)); },
  async cerrarCaja(c) { return q(sb.from('caja_cierres').insert(c).select().single()); },

  // Proveedores y compras
  async proveedores() { return q(sb.from('proveedores').select('*').order('nombre')); },
  async guardarProveedor(p) {
    const { id, ...datos } = p;
    return id ? q(sb.from('proveedores').update(datos).eq('id', id).select().single())
              : q(sb.from('proveedores').insert(datos).select().single());
  },
  async compras() { return q(sb.from('compras').select('*, items:compra_items(*)').order('fecha', { ascending: false }).limit(500)); },
  async registrarCompra({ proveedor_id, nro_comprobante, items, notas = '' }) {
    const id = await q(sb.rpc('registrar_compra', { p_proveedor_id: proveedor_id || null, p_nro_comprobante: nro_comprobante || '', p_items: items, p_notas: notas }));
    return { id };
  },
  async editarCompra(id, { proveedor_id, nro_comprobante, items, notas = '' }) {
    await q(sb.rpc('editar_compra', { p_compra_id: id, p_proveedor_id: proveedor_id || null, p_nro_comprobante: nro_comprobante || '', p_items: items, p_notas: notas }));
  },
  async eliminarCompra(id) { await q(sb.rpc('eliminar_compra', { p_compra_id: id })); },

  // Service técnico
  async ordenes() { return q(sb.from('ordenes_servicio').select(ORDEN_SEL).order('fecha_ingreso', { ascending: false }).limit(2000)); },
  async orden(id) {
    return q(sb.from('ordenes_servicio')
      .select(`${ORDEN_SEL}, items:orden_items(*), historial:orden_estados(*)`)
      .eq('id', id)
      .order('id', { referencedTable: 'orden_items' })
      .order('created_at', { referencedTable: 'orden_estados' })
      .maybeSingle());
  },
  async crearOrden(o) { return q(sb.from('ordenes_servicio').insert(o).select().single()); },
  async actualizarOrden(id, cambios) { await q(sb.from('ordenes_servicio').update(cambios).eq('id', id)); },
  async cambiarEstadoOrden(id, estado, comentario = '') {
    await q(sb.rpc('cambiar_estado_orden', { p_orden_id: id, p_estado: estado, p_comentario: comentario }));
  },
  async guardarItemsOrden(id, items) {
    await q(sb.from('orden_items').delete().eq('orden_id', id));
    if (items.length) await q(sb.from('orden_items').insert(items.map(i => ({
      orden_id: id, producto_id: i.producto_id || null, descripcion: i.descripcion, cantidad: +i.cantidad, precio_unitario: +i.precio_unitario,
    }))));
  },
  async entregarOrden(id, { total, forma_pago, comentario = '' }) {
    await q(sb.rpc('entregar_orden', { p_orden_id: id, p_total: +total || 0, p_forma_pago: forma_pago, p_comentario: comentario }));
  },

  // Página pública (no requiere login)
  async seguimiento(token) {
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) return null;
    return q(sb.rpc('seguimiento_orden', { p_token: token }));
  },
};
