-- =====================================================================
-- GScom — Eliminar clientes
-- Solo se puede borrar un cliente que nunca tuvo movimientos: ventas,
-- órdenes de service, encargos/reservas ni cuenta corriente. Si los tiene,
-- borrarlo dejaría ese historial sin cliente (o directamente no se puede
-- por las órdenes y el Fichero), así que se avisa qué tiene.
-- Se borran también los equipos que tenía cargados (nadie los usa).
-- =====================================================================
create or replace function eliminar_cliente(p_id bigint) returns void
language plpgsql as $$
declare c clientes; v_ventas int; v_ordenes int; v_enc int; v_cc int; v_tiene text[] := '{}';
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into c from clientes where id = p_id for update;
  if not found then raise exception 'El cliente no existe'; end if;

  select count(*) into v_ventas  from ventas where cliente_id = p_id;
  select count(*) into v_ordenes from ordenes_servicio where cliente_id = p_id;
  select count(*) into v_enc     from encargos where cliente_id = p_id;
  select count(*) into v_cc      from cc_movimientos where cliente_id = p_id;

  if v_ventas  > 0 then v_tiene := v_tiene || (v_ventas  || ' venta(s)'); end if;
  if v_ordenes > 0 then v_tiene := v_tiene || (v_ordenes || ' orden(es) de service'); end if;
  if v_enc     > 0 then v_tiene := v_tiene || (v_enc     || ' encargo(s)/reserva(s)'); end if;
  if v_cc      > 0 then v_tiene := v_tiene || (v_cc      || ' movimiento(s) de cuenta corriente'); end if;
  if array_length(v_tiene, 1) > 0 then
    raise exception 'No se puede eliminar a %: tiene % registrados. Un cliente con historial no se borra para no perder esos datos.',
      c.nombre, array_to_string(v_tiene, ', ');
  end if;

  delete from clientes where id = p_id;   -- sus equipos se borran en cascada
end $$;

revoke execute on function eliminar_cliente(bigint) from public, anon;
grant  execute on function eliminar_cliente(bigint) to authenticated;
