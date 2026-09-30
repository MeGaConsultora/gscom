-- =====================================================================
-- GScom — Limpieza para empezar a trabajar en serio (29/09/2026)
-- CONSERVA: productos (con su stock actual, fotos, precios y categorías),
--           clientes, compras (con sus movimientos de stock) y proveedores.
--           También usuarios, datos del negocio y configuración de la tienda.
-- BORRA:    ventas, caja y cierres, cuentas corrientes (Fichero), service
--           (órdenes, historial y equipos de los clientes), encargos y
--           reservas, pedidos a proveedores, solicitudes de la tienda y los
--           movimientos de stock que no son de compras.
-- Reinicia la numeración: venta #1, orden #1, encargo #1, pedido #1.
-- El stock de cada producto NO cambia (queda como está hoy).
-- ¡NO SE PUEDE DESHACER! Antes, correr el backup a mano (GitHub → backups-gscom
-- → Actions → Backup diario GScom → Run workflow).
-- =====================================================================

begin;

-- Movimientos de stock: se conservan solo los de las compras (el stock de cada producto no se toca)
delete from stock_movimientos where compra_id is null;

truncate table
  cc_imputaciones, caja_movimientos, caja_cierres, cc_movimientos,
  venta_items, ventas,
  orden_items, orden_estados, ordenes_servicio, equipos,
  pedido_items, encargos, pedidos,
  solicitudes_web, solicitudes_limite
restart identity;   -- sin CASCADE: si algo más dependiera de estas tablas, da error en vez de borrarlo

alter sequence ventas_numero_seq   restart with 1;
alter sequence ordenes_numero_seq  restart with 1;
alter sequence encargos_numero_seq restart with 1;
alter sequence pedidos_numero_seq  restart with 1;

commit;

-- Verificación: lo borrado debe dar 0; lo conservado, sus cantidades
select 'ventas' as tabla, count(*) from ventas
union all select 'caja_movimientos', count(*) from caja_movimientos
union all select 'cc_movimientos (Fichero)', count(*) from cc_movimientos
union all select 'ordenes_servicio', count(*) from ordenes_servicio
union all select 'equipos', count(*) from equipos
union all select 'encargos', count(*) from encargos
union all select 'pedidos', count(*) from pedidos
union all select 'solicitudes_web', count(*) from solicitudes_web
union all select 'productos (se conservan)', count(*) from productos
union all select 'clientes (se conservan)', count(*) from clientes
union all select 'compras (se conservan)', count(*) from compras
union all select 'proveedores (se conservan)', count(*) from proveedores
union all select 'movimientos de stock de compras (se conservan)', count(*) from stock_movimientos;
