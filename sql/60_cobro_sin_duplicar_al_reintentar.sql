-- =====================================================================
-- GScom — Un cobro de cuenta corriente reintentado no se registra dos veces
-- Si se corta la conexión justo al guardar, el cobro puede quedar registrado sin que
-- la pantalla se entere; al volver a tocar "Registrar cobro" se duplicaba. Ahora cada
-- intento lleva una clave (cc_movimientos.clave): con la misma clave, la base devuelve
-- el cobro que ya existe en lugar de crear otro. Los cobros viejos quedan sin clave.
-- =====================================================================
alter table cc_movimientos add column if not exists clave uuid;
create unique index if not exists idx_cc_movimientos_clave on cc_movimientos(clave) where clave is not null;

drop function if exists cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text);
create or replace function cobrar_cuenta_plan(p_cliente_id bigint, p_monto numeric, p_forma_pago text, p_nota text,
                                              p_imputaciones jsonb, p_recargo numeric, p_plan text, p_clave uuid default null)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- El mismo cobro reintentado (misma clave): no se registra de nuevo, se devuelve el que ya está
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
    select id into v_id from cc_movimientos where clave = p_clave;
    if found then return v_id; end if;
  end if;
  if coalesce(p_recargo, 0) < 0 then raise exception 'El recargo no puede ser negativo'; end if;
  if coalesce(p_recargo, 0) > 0 and p_forma_pago not in ('Débito', 'Crédito', 'Mercado Pago') then
    raise exception 'El recargo solo va con débito, crédito o Mercado Pago';
  end if;
  v_id := cobrar_cuenta_imputado(p_cliente_id, p_monto, p_forma_pago, p_nota, coalesce(p_imputaciones, '[]'::jsonb));
  if p_clave is not null then
    update cc_movimientos set clave = p_clave where id = v_id;
  end if;
  if coalesce(p_recargo, 0) > 0 then
    update cc_movimientos set recargo = round(p_recargo, 2), plan = nullif(p_plan, '') where id = v_id;
    update caja_movimientos set monto = monto + round(p_recargo, 2), concepto = concepto || coalesce(' · ' || nullif(p_plan, ''), '')
     where cc_movimiento_id = v_id and tipo = 'ingreso';
  end if;
  return v_id;
end $$;

revoke execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text, uuid) from public, anon;
grant  execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text, uuid) to authenticated;
notify pgrst, 'reload schema';
