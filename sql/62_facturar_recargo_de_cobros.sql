-- =====================================================================
-- GScom — El recargo de un cobro de cuenta corriente también se factura
-- En ventas y entregas de service el recargo ya va dentro del total facturado.
-- En un cobro de cuenta corriente no: la venta pudo facturarse antes, o el cobro
-- puede cubrir varias ventas. Por eso cada cobro con recargo tiene su propio estado
-- de factura y aparece en Facturas como pendiente de emitir (solo por el recargo).
-- Se puede marcar emitido junto con otros comprobantes del cliente, con el mismo número.
-- Es solo un registro: no emite nada en AFIP.
-- Al final muestra cuántos cobros ya hechos quedaron pendientes de facturar.
-- =====================================================================
alter table cc_movimientos add column if not exists facturacion   text not null default 'no';
alter table cc_movimientos add column if not exists factura_nro   text not null default '';
alter table cc_movimientos add column if not exists factura_fecha timestamptz;
alter table cc_movimientos drop constraint if exists cc_movimientos_facturacion_check;
alter table cc_movimientos add constraint cc_movimientos_facturacion_check check (facturacion in ('no', 'pendiente', 'emitida'));
create index if not exists idx_cc_recargo_factura on cc_movimientos (fecha) where recargo > 0 and facturacion <> 'no';

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
    update cc_movimientos set recargo = round(p_recargo, 2), plan = nullif(p_plan, ''), facturacion = 'pendiente' where id = v_id;
    update caja_movimientos set monto = monto + round(p_recargo, 2), concepto = concepto || coalesce(' · ' || nullif(p_plan, ''), '')
     where cc_movimiento_id = v_id and tipo = 'ingreso';
  end if;
  return v_id;
end $$;

revoke execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text, uuid) from public, anon;
grant  execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text, uuid) to authenticated;
notify pgrst, 'reload schema';

-- Los cobros con recargo que ya se hicieron quedan pendientes de facturar
with marcados as (
  update cc_movimientos set facturacion = 'pendiente'
   where tipo = 'pago' and recargo > 0 and not anulado and facturacion = 'no'
  returning recargo
)
select count(*) as cobros_pendientes_de_facturar, coalesce(sum(recargo), 0) as recargos_a_facturar from marcados;
