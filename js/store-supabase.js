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

// Supabase entrega como máximo 1000 filas por consulta: esto las pide en tandas
// hasta traer todas (o hasta 'max'). 'armar' devuelve la consulta ya ordenada.
async function todas(armar, max = Infinity, tanda = 1000) {
  let filas = [];
  while (filas.length < max) {
    const lote = await q(armar().range(filas.length, Math.min(filas.length + tanda, max) - 1));
    filas = filas.concat(lote);
    if (lote.length < tanda) break;
  }
  return filas;
}

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
  async categorias() { return todas(() => sb.from('categorias').select('*').order('nombre')); },
  async crearCategoria(nombre) { return q(sb.from('categorias').insert({ nombre }).select().single()); },
  async productos() { return todas(() => sb.from('productos').select('*').eq('activo', true).order('nombre').order('id')); },
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
  async eliminarProducto(id) { return q(sb.rpc('eliminar_producto', { p_id: id })); },  // 'eliminado' | 'baja'

  // Tienda online
  async catalogoTienda() { return q(sb.rpc('catalogo_tienda')); },
  // (estas funciones las pueden usar admin y usuarios "Tienda": no exponen costos ni proveedores)
  async tiendaAdmin() { return q(sb.rpc('tienda_admin_datos')); },
  async tiendaActualizarProducto(id, datos) { await q(sb.rpc('tienda_actualizar_producto', { p_id: id, p_datos: datos })); },
  async guardarTiendaConfig(cfg) { await q(sb.rpc('tienda_guardar_config', { p: cfg })); },
  async publicarProductos(ids, publicado) {
    for (let i = 0; i < ids.length; i += 200) await q(sb.rpc('tienda_publicar', { p_ids: ids.slice(i, i + 200), p_publicado: publicado }));
  },
  // Sube la foto (ya achicada a JPEG) y la deja asociada al producto; borra la anterior
  async subirFotoProducto(productoId, blob, fotoAnterior = '') {
    const ruta = `${productoId}-${Date.now()}.jpg`;
    const { error } = await sb.storage.from('productos').upload(ruta, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
    const url = sb.storage.from('productos').getPublicUrl(ruta).data.publicUrl;
    await this.tiendaActualizarProducto(productoId, { foto_url: url });
    await this.borrarArchivoFoto(fotoAnterior);
    return url;
  },
  async quitarFotoProducto(productoId, fotoAnterior = '') {
    await this.tiendaActualizarProducto(productoId, { foto_url: '' });
    await this.borrarArchivoFoto(fotoAnterior);
  },
  // Solicitudes desde la tienda (el cliente crea/ve/cancela con su token; GScom las atiende)
  async crearSolicitudWeb({ nombre, telefono, comentario = '', items, trampa = '' }) {
    return q(sb.rpc('crear_solicitud_web', { p_nombre: nombre, p_telefono: telefono, p_comentario: comentario, p_items: items, p_trampa: trampa }));
  },
  async verSolicitudWeb(token) { return /^[0-9a-f-]{36}$/i.test(token || '') ? q(sb.rpc('ver_solicitud_web', { p_token: token })) : null; },
  async cancelarSolicitudWeb(token) { return q(sb.rpc('cancelar_solicitud_web', { p_token: token })); },
  async solicitudesWeb() { return q(sb.from('solicitudes_web').select('*').eq('estado', 'pendiente').order('fecha')); },
  async atenderSolicitudWeb(id, estado) { return q(sb.rpc('atender_solicitud_web', { p_id: id, p_estado: estado })); },
  // Llama a alta(id) cuando entra una solicitud y a baja(id) cuando el cliente la cancela
  escucharSolicitudes(alta, baja) {
    sb.channel('solicitudes-web')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'solicitudes_web' }, ({ new: s }) => alta(s.id))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'solicitudes_web' }, ({ old: s }) => baja(s.id))
      .subscribe();
  },

  // Usuarios (solo admin)
  async usuarios() { return q(sb.rpc('usuarios_listar')); },
  async actualizarUsuario(id, { activo, rol }) { await q(sb.rpc('usuario_actualizar', { p_id: id, p_activo: !!activo, p_rol: rol })); },
  async borrarArchivoFoto(url) {
    const ruta = (url || '').split('/storage/v1/object/public/productos/')[1];
    if (ruta) await sb.storage.from('productos').remove([decodeURIComponent(ruta)]).catch(() => {});
  },
  // Inventario: fija el stock contado y marca el producto como contado
  async contarStock(productoId, cantidad) { return q(sb.rpc('contar_stock', { p_producto_id: productoId, p_cantidad: +cantidad })); },
  async ajustarStock(productoId, cantidad, nota) {
    await q(sb.from('stock_movimientos').insert({ producto_id: productoId, cantidad, tipo: 'ajuste', nota: nota || '' }));
  },
  async movimientosStock(productoId) {
    return q(sb.from('stock_movimientos').select('*').eq('producto_id', productoId).order('created_at', { ascending: false }).limit(100));
  },

  // Clientes y equipos
  async clientes() { return todas(() => sb.from('clientes').select('*').order('nombre').order('id')); },
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
  async ventas() { return todas(() => sb.from('ventas').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }), 5000); },
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
    return todas(() => sb.from('venta_items').select('*, venta:ventas!inner(fecha, anulada)')
      .gte('venta.fecha', desdeISO).eq('venta.anulada', false).order('id'), 20000);
  },
  async anularVenta(id) { await q(sb.rpc('anular_venta', { p_venta_id: id })); },
  async editarVenta(id, { cliente_id, items, descuento = 0, forma_pago, notas = '' }) {
    await q(sb.rpc('editar_venta', {
      p_venta_id: id, p_cliente_id: cliente_id || null,
      p_items: items.map(({ producto_id, descripcion, cantidad, precio_unitario }) => ({ producto_id, descripcion, cantidad, precio_unitario })),
      p_descuento: +descuento || 0, p_forma_pago: forma_pago, p_notas: notas,
    }));
  },

  // Caja
  async cajaMovimientos() { return todas(() => sb.from('caja_movimientos').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }), 5000); },
  async agregarMovimientoCaja(m) { return q(sb.from('caja_movimientos').insert(m).select().single()); },
  async cierresCaja() { return q(sb.from('caja_cierres').select('*').order('fecha', { ascending: false }).limit(60)); },
  async cerrarCaja(c) { return q(sb.from('caja_cierres').insert(c).select().single()); },

  // Proveedores y compras
  async proveedores() { return todas(() => sb.from('proveedores').select('*').order('nombre').order('id')); },
  async guardarProveedor(p) {
    const { id, ...datos } = p;
    return id ? q(sb.from('proveedores').update(datos).eq('id', id).select().single())
              : q(sb.from('proveedores').insert(datos).select().single());
  },
  // Pedidos de mercadería (no tocan stock)
  async pedidos() { return todas(() => sb.from('pedidos').select('*, items:pedido_items(*)').order('fecha', { ascending: false }).order('id', { ascending: false }), 2000); },
  async pedido(id) { return q(sb.from('pedidos').select('*, items:pedido_items(*)').eq('id', id).order('id', { referencedTable: 'pedido_items' }).maybeSingle()); },
  async crearPedido({ proveedor_id, items, notas = '' }) {
    return q(sb.rpc('crear_pedido', { p_proveedor_id: proveedor_id || null, p_items: items, p_notas: notas }));
  },
  async actualizarItemsPedido(id, items) { await q(sb.rpc('actualizar_items_pedido', { p_pedido_id: id, p_items: items })); },
  async actualizarPedido(id, cambios) { await q(sb.from('pedidos').update(cambios).eq('id', id)); },

  // Encargos de clientes (se agregan a un pedido pendiente del proveedor)
  async encargos() {
    return todas(() => sb.from('encargos').select('*, cliente:clientes(id, nombre, telefono), pedido:pedidos(id, numero, estado)')
      .order('fecha', { ascending: false }).order('id', { ascending: false }), 3000);
  },
  async encargosDePedido(pedidoId) { return q(sb.from('encargos').select('*, cliente:clientes(id, nombre, telefono)').eq('pedido_id', pedidoId)); },
  async crearEncargo(e) { return q(sb.from('encargos').insert(e).select().single()); },
  async encargar(id, proveedor_id) { return q(sb.rpc('encargar', { p_encargo_id: id, p_proveedor_id: proveedor_id || null })); },  // devuelve el id del pedido
  async actualizarEncargo(id, cambios) { await q(sb.from('encargos').update(cambios).eq('id', id)); },
  async cancelarEncargo(id) { await q(sb.rpc('cancelar_encargo', { p_encargo_id: id })); },

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
  async ordenes() { return todas(() => sb.from('ordenes_servicio').select(ORDEN_SEL).order('fecha_ingreso', { ascending: false }).order('id', { ascending: false }), 3000); },
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
  async anticiposOrden(ordenId) {
    return q(sb.from('cc_movimientos').select('*').eq('orden_id', ordenId).eq('tipo', 'pago').order('fecha'));
  },
  async registrarAnticipoOrden(id, { monto, forma_pago, nota = '' }) {
    return q(sb.rpc('registrar_anticipo_orden', { p_orden_id: id, p_monto: +monto, p_forma_pago: forma_pago, p_nota: nota }));
  },

  // Página pública (no requiere login)
  async seguimiento(token) {
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) return null;
    return q(sb.rpc('seguimiento_orden', { p_token: token }));
  },
  async anularEntregaOrden(id) { await q(sb.rpc('anular_entrega_orden', { p_orden_id: id })); },
  async eliminarMovimientoCaja(id) { await q(sb.rpc('eliminar_movimiento_caja', { p_id: id })); },
  async editarMovimientoCaja(id, { concepto, monto, forma_pago }) {
    await q(sb.rpc('editar_movimiento_caja', { p_id: id, p_concepto: concepto, p_monto: +monto, p_forma_pago: forma_pago }));
  },
  async eliminarProveedor(id) { await q(sb.from('proveedores').delete().eq('id', id)); },

  // Fichero (cuentas corrientes)
  async ccSaldos() { return q(sb.from('cc_saldos').select('*').order('saldo', { ascending: false })); },
  async ccMovimientos(clienteId) { return q(sb.from('cc_movimientos').select('*, venta:ventas(notas)').eq('cliente_id', clienteId).order('fecha', { ascending: false }).order('id', { ascending: false })); },
  async ccMovimiento(id) { return q(sb.from('cc_movimientos').select('*').eq('id', id).maybeSingle()); },
  async cobrarCuenta(clienteId, { monto, forma_pago, nota = '', imputaciones = [] }) {
    if (imputaciones.length) return q(sb.rpc('cobrar_cuenta_imputado', { p_cliente_id: clienteId, p_monto: +monto, p_forma_pago: forma_pago, p_nota: nota, p_imputaciones: imputaciones }));
    return q(sb.rpc('cobrar_cuenta', { p_cliente_id: clienteId, p_monto: +monto, p_forma_pago: forma_pago, p_nota: nota }));
  },
  async ccImputaciones(clienteId) {
    return q(sb.from('cc_imputaciones').select('*, pago:cc_movimientos!inner(cliente_id)').eq('pago.cliente_id', clienteId));
  },
  async cargarDeuda(clienteId, { monto, concepto }) {
    await q(sb.from('cc_movimientos').insert({ cliente_id: clienteId, tipo: 'cargo', monto: +monto, concepto }));
  },
  async anularCobroCuenta(ccId) { await q(sb.rpc('anular_cobro_cuenta', { p_cc_id: ccId })); },
  async editarCargoManual(id, { concepto, monto }) {
    await q(sb.rpc('editar_cargo_manual', { p_id: id, p_monto: +monto, p_concepto: concepto }));
  },
  async eliminarCargoManual(id) { await q(sb.rpc('eliminar_cargo_manual', { p_id: id })); },

  // Avisos: presupuestos respondidos por el cliente que todavía no se atendieron
  async presupuestosRespondidos() {
    const { count, error } = await sb.from('ordenes_servicio').select('id', { count: 'exact', head: true })
      .eq('estado', 'presupuesto').not('presupuesto_aprobado', 'is', null);
    if (error) throw new Error(error.message);
    return count || 0;
  },
  // Llama a cb(ordenId, acepta) cada vez que un cliente responde un presupuesto desde su link
  escucharRespuestas(cb) {
    sb.channel('respuestas-presupuesto')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orden_estados' }, ({ new: h }) => {
        const m = /^El cliente (ACEPTÓ|RECHAZÓ)/.exec(h.comentario || '');
        if (m) cb(h.orden_id, m[1] === 'ACEPTÓ');
      })
      .subscribe();
  },

  async responderPresupuesto(token, acepta) {
    return q(sb.rpc('responder_presupuesto', { p_token: token, p_acepta: !!acepta }));
  },
};
