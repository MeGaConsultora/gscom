-- =====================================================================
-- GScom — Editar una venta ya registrada (ítems, descuento, forma de
-- pago, cliente). Mismo criterio que editar una compra: se revierte el
-- efecto original (stock + caja/cta. cte.) con movimientos de ajuste
-- y se vuelve a aplicar con los datos nuevos, sin borrar el historial.
-- =====================================================================

create or replace function editar_venta(
  p_venta_id bigint, p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default ''
) returns void language plpgsql as $$
declare
  v ventas; v_subtotal numeric := 0; v_total numeric; it jsonb;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.anulada then raise exception 'La venta está anulada: no se puede editar'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;
  if p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then raise exception 'Para vender a cuenta corriente hay que elegir el cliente'; end if;

  -- Revertir el stock de los ítems originales
  insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
  select producto_id, cantidad, 'ajuste', p_venta_id, 'Corrección de venta #' || v.numero
    from venta_items where venta_id = p_venta_id and producto_id is not null;

  -- Revertir el cobro/cargo original
  if v.forma_pago = 'Cuenta corriente' then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
    values (v.cliente_id, 'ajuste', -v.total, 'Corrección de venta #' || v.numero, p_venta_id);
  else
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
    values ('egreso', 'Corrección de venta #' || v.numero, v.total, v.forma_pago, p_venta_id);
  end if;

  -- Reemplazar ítems
  delete from venta_items where venta_id = p_venta_id;
  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_total := v_subtotal - coalesce(p_descuento,0);

  for it in select * from jsonb_array_elements(p_items) loop
    insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (p_venta_id, nullif(it->>'producto_id','')::bigint, it->>'descripcion', (it->>'cantidad')::numeric,
            (it->>'precio_unitario')::numeric, (it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric);
    if nullif(it->>'producto_id','') is not null then
      insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
      values ((it->>'producto_id')::bigint, -(it->>'cantidad')::numeric, 'venta', p_venta_id, 'Venta #' || v.numero || ' (editada)');
    end if;
  end loop;

  update ventas set cliente_id = p_cliente_id, subtotal = v_subtotal, descuento = coalesce(p_descuento,0),
    total = v_total, forma_pago = p_forma_pago, notas = coalesce(p_notas, v.notas) where id = p_venta_id;

  if p_forma_pago = 'Cuenta corriente' then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
    values (p_cliente_id, 'cargo', v_total, 'Venta #' || v.numero, p_venta_id);
  else
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
    values ('ingreso', 'Venta #' || v.numero, v_total, p_forma_pago, p_venta_id);
  end if;
end $$;

revoke execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text) from public, anon;
grant  execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text) to authenticated;
