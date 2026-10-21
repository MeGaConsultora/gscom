-- =====================================================================
-- GScom — Cargar un saldo a favor a mano en el Fichero
-- Es lo opuesto a "Cargar deuda manual": un movimiento de cuenta corriente
-- a favor del cliente (monto negativo), sin venta ni orden asociada.
-- · cc_movimientos.manual: marca estos movimientos para poder editarlos y
--   eliminarlos, y distinguirlos de otros ajustes (anulaciones, etc.).
-- · cc_movimientos.imputa_deuda: si el saldo a favor se aplica a lo que el
--   cliente ya debe (baja las deudas pendientes, de lo más viejo a lo más
--   nuevo) o queda aparte como saldo a favor, sin tocar esas deudas. Se puede
--   cambiar después. El saldo total de la cuenta es el mismo en los dos casos.
-- · NO mueve la caja: si el cliente entregó plata de verdad, se registra con
--   "Cobrar" (que sí entra a caja). Esto es para saldos que no pasan por caja
--   (saldo anterior a favor, nota de crédito, devolución pendiente, etc.).
-- =====================================================================

alter table cc_movimientos add column if not exists manual boolean not null default false;
alter table cc_movimientos add column if not exists imputa_deuda boolean not null default true;

create or replace function editar_saldo_favor_manual(p_id bigint, p_monto numeric, p_concepto text, p_imputa boolean default true) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto, 0) <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
  if not exists (select 1 from cc_movimientos where id = p_id and tipo = 'ajuste' and manual) then
    raise exception 'Este movimiento no es un saldo a favor cargado a mano: no se puede editar directamente';
  end if;
  update cc_movimientos set monto = -p_monto, concepto = p_concepto, imputa_deuda = coalesce(p_imputa, true) where id = p_id;
end $$;

create or replace function eliminar_saldo_favor_manual(p_id bigint) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from cc_movimientos where id = p_id and tipo = 'ajuste' and manual) then
    raise exception 'Este movimiento no es un saldo a favor cargado a mano: no se puede eliminar directamente';
  end if;
  delete from cc_movimientos where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['editar_saldo_favor_manual(bigint, numeric, text, boolean)', 'eliminar_saldo_favor_manual(bigint)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
