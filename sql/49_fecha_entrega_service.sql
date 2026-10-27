-- =====================================================================
-- GScom — Elegir la fecha de la entrega de un service
-- Por defecto la entrega se registra "ahora". Si se elige otro día, esta función
-- reubica la entrega (y lo que generó: cobro en caja, cargos de cuenta corriente,
-- baja de repuestos y el estado "Entregado" del historial) en esa fecha.
-- No toca entregar_orden. Reconoce lo generado por la entrega porque se crea con
-- el mismo instante que fecha_entrega; los anticipos (con su propia fecha) y los
-- movimientos posteriores no se mueven.
-- Los anticipos de service y de encargos usan fijar_fecha_cobro_cuenta (SQL 48),
-- porque son un pago de cuenta corriente con su ingreso en caja.
-- =====================================================================

create or replace function fijar_fecha_entrega_orden(p_orden_id bigint, p_fecha timestamptz) returns void
language plpgsql as $$
declare o ordenes_servicio;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_fecha is null then raise exception 'Falta la fecha'; end if;
  if p_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if o.estado <> 'entregado' or o.fecha_entrega is null then raise exception 'La orden no está entregada'; end if;

  update caja_movimientos  set fecha = p_fecha      where orden_id = p_orden_id and fecha = o.fecha_entrega;
  update cc_movimientos    set fecha = p_fecha      where orden_id = p_orden_id and fecha = o.fecha_entrega and tipo <> 'pago';
  update stock_movimientos set created_at = p_fecha where orden_id = p_orden_id and created_at = o.fecha_entrega;
  update orden_estados     set created_at = p_fecha where orden_id = p_orden_id and estado = 'entregado' and created_at = o.fecha_entrega;
  update ordenes_servicio  set fecha_entrega = p_fecha where id = p_orden_id;
end $$;

revoke execute on function fijar_fecha_entrega_orden(bigint, timestamptz) from public, anon;
grant  execute on function fijar_fecha_entrega_orden(bigint, timestamptz) to authenticated;
