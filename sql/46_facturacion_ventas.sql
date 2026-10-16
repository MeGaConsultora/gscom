-- =====================================================================
-- GScom — Control de facturación de ventas y de entregas de service
-- Solo registra el estado (no emite nada en AFIP): saber qué se factura,
-- qué ya tiene su factura emitida y qué queda pendiente de emitir, sin
-- importar si se cobró, está en cuenta corriente o ambas.
-- · facturacion: 'no' (no se factura) | 'pendiente' (hay que emitirla) | 'emitida'
-- · factura_nro: número de la factura emitida (opcional, texto libre: "0005-00001234")
-- · factura_fecha: cuándo se marcó como emitida
-- Aplica a ventas y a órdenes de service (el encargo/reserva se entrega con una
-- venta, así que ya queda cubierto por la venta).
-- No toca registrar_venta / editar_venta / entregar_orden: se guarda aparte.
-- =====================================================================

alter table ventas add column if not exists facturacion   text not null default 'no';
alter table ventas add column if not exists factura_nro   text not null default '';
alter table ventas add column if not exists factura_fecha timestamptz;
alter table ventas drop constraint if exists ventas_facturacion_check;
alter table ventas add constraint ventas_facturacion_check check (facturacion in ('no', 'pendiente', 'emitida'));

alter table ordenes_servicio add column if not exists facturacion   text not null default 'no';
alter table ordenes_servicio add column if not exists factura_nro   text not null default '';
alter table ordenes_servicio add column if not exists factura_fecha timestamptz;
alter table ordenes_servicio drop constraint if exists ordenes_servicio_facturacion_check;
alter table ordenes_servicio add constraint ordenes_servicio_facturacion_check check (facturacion in ('no', 'pendiente', 'emitida'));

-- Para listar rápido las pendientes
create index if not exists idx_ventas_factura_pendiente on ventas (fecha) where facturacion = 'pendiente' and not anulada;
create index if not exists idx_ordenes_factura_pendiente on ordenes_servicio (fecha_entrega) where facturacion = 'pendiente';
