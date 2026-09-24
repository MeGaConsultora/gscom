-- =====================================================================
-- GScom — Editar/eliminar un cargo manual de cuenta corriente (los
-- cargados desde "Cargar deuda manual" en el Fichero, sin venta ni
-- orden de service asociada). Los cargos que sí vienen de una venta o
-- de un service se corrigen desde su origen (editar la venta, etc.).
-- =====================================================================

create or replace function editar_cargo_manual(p_id bigint, p_monto numeric, p_concepto text) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
  if not exists (select 1 from cc_movimientos where id = p_id and tipo = 'cargo' and venta_id is null and orden_id is null) then
    raise exception 'Este cargo no se puede editar directamente: viene de una venta o de una orden de service, corregilo desde ahí';
  end if;
  update cc_movimientos set monto = p_monto, concepto = p_concepto where id = p_id;
end $$;

create or replace function eliminar_cargo_manual(p_id bigint) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from cc_movimientos where id = p_id and tipo = 'cargo' and venta_id is null and orden_id is null) then
    raise exception 'Este cargo no se puede eliminar directamente: viene de una venta o de una orden de service, corregilo desde ahí';
  end if;
  delete from cc_movimientos where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['editar_cargo_manual(bigint, numeric, text)', 'eliminar_cargo_manual(bigint)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
