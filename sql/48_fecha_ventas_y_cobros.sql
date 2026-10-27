-- =====================================================================
-- GScom — Elegir la fecha de una venta o de un cobro de cuenta corriente
-- Por defecto todo se registra "ahora". Si se elige otro día, estas funciones
-- reubican el registro (y sus movimientos de caja / cuenta corriente / stock) en
-- esa fecha. No tocan registrar_venta ni cobrar_cuenta.
-- Los movimientos originales se reconocen porque la base los crea con el mismo
-- instante que la venta o el cobro (now() es el mismo dentro de una operación):
-- así, si después se edita la venta, los ajustes de esa edición conservan su
-- propia fecha (la de la edición) y no se mueven.
-- =====================================================================

create or replace function fijar_fecha_venta(p_venta_id bigint, p_fecha timestamptz) returns void
language plpgsql as $$
declare v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Falta la fecha'; end if;
  if p_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  update caja_movimientos  set fecha = p_fecha      where venta_id = p_venta_id and fecha = v.fecha;
  update cc_movimientos    set fecha = p_fecha      where venta_id = p_venta_id and fecha = v.fecha;
  update stock_movimientos set created_at = p_fecha where venta_id = p_venta_id and created_at = v.fecha;
  update ventas set fecha = p_fecha where id = p_venta_id;
end $$;

-- Cobro de cuenta corriente (el pago y su ingreso en caja)
create or replace function fijar_fecha_cobro_cuenta(p_cc_id bigint, p_fecha timestamptz) returns void
language plpgsql as $$
declare m cc_movimientos;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Falta la fecha'; end if;
  if p_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura'; end if;
  select * into m from cc_movimientos where id = p_cc_id and tipo = 'pago' for update;
  if not found then raise exception 'Cobro no encontrado'; end if;
  update caja_movimientos set fecha = p_fecha where cc_movimiento_id = p_cc_id and tipo = 'ingreso' and fecha = m.fecha;
  update cc_movimientos set fecha = p_fecha where id = p_cc_id;
end $$;

revoke execute on function fijar_fecha_venta(bigint, timestamptz) from public, anon;
revoke execute on function fijar_fecha_cobro_cuenta(bigint, timestamptz) from public, anon;
grant  execute on function fijar_fecha_venta(bigint, timestamptz) to authenticated;
grant  execute on function fijar_fecha_cobro_cuenta(bigint, timestamptz) to authenticated;
