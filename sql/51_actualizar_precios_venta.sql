-- =====================================================================
-- GScom — Sugerencia de actualizar precios en las ventas a cuenta corriente
-- Cuando un producto sube de precio después de una venta que el cliente todavía
-- debe, el Fichero lo sugiere y la persona decide si lo aplica (nada es automático).
-- · venta_items.precio_revisado: precio de lista contra el que ya se decidió
--   (se aplicó o se dejó como estaba): la sugerencia vuelve a aparecer solo si
--   el producto sube de nuevo por encima de eso.
-- · actualizar_precios_venta(): cambia el precio de los ítems elegidos y suma la
--   diferencia a lo que el cliente debe por esa venta (cargo en el Fichero).
--   No toca la caja ni lo ya cobrado, y no usa registrar_venta / editar_venta.
-- =====================================================================

alter table venta_items add column if not exists precio_revisado numeric(14,2);

-- p_cambios: [{ "id": <venta_items.id>, "lista": <precio de lista actual>, "aplicar": true|false, "precio": <nuevo precio> }]
-- Devuelve la diferencia total que se sumó a la deuda (0 si solo se marcó como revisado).
create or replace function actualizar_precios_venta(p_venta_id bigint, p_cambios jsonb) returns numeric
language plpgsql as $$
declare
  v ventas; c jsonb; it venta_items; v_dif numeric := 0; v_precio numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.anulada then raise exception 'La venta está anulada'; end if;

  for c in select * from jsonb_array_elements(p_cambios) loop
    select * into it from venta_items where id = (c->>'id')::bigint and venta_id = p_venta_id for update;
    if not found then continue; end if;
    if coalesce((c->>'aplicar')::boolean, false) then
      v_precio := round((c->>'precio')::numeric, 2);
      if v_precio is null or v_precio < 0 then raise exception 'Precio no válido'; end if;
      v_dif := v_dif + it.cantidad * (v_precio - it.precio_unitario);
      update venta_items set precio_unitario = v_precio, subtotal = cantidad * v_precio,
             precio_revisado = coalesce((c->>'lista')::numeric, v_precio) where id = it.id;
    else
      update venta_items set precio_revisado = (c->>'lista')::numeric where id = it.id;
    end if;
  end loop;

  if v_dif <> 0 then
    -- la diferencia va a la parte que quedó a cuenta corriente
    if v.pagos is null then
      if v.forma_pago <> 'Cuenta corriente' then raise exception 'Esta venta no quedó a cuenta corriente'; end if;
    else
      if not exists (select 1 from jsonb_array_elements(v.pagos) x where x->>'forma_pago' = 'Cuenta corriente') then
        raise exception 'Esta venta no quedó a cuenta corriente';
      end if;
      update ventas set pagos = (
        select jsonb_agg(case when x->>'forma_pago' = 'Cuenta corriente'
                              then jsonb_build_object('forma_pago', x->>'forma_pago', 'monto', round((x->>'monto')::numeric + v_dif, 2))
                              else x end order by ord)
          from jsonb_array_elements(v.pagos) with ordinality as t(x, ord)) where id = p_venta_id;
    end if;
    update ventas set subtotal = subtotal + v_dif, total = total + v_dif where id = p_venta_id;
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
    values (v.cliente_id, case when v_dif > 0 then 'cargo' else 'ajuste' end, v_dif,
            'Actualización de precios — venta #' || v.numero, p_venta_id);
  end if;
  return v_dif;
end $$;

revoke execute on function actualizar_precios_venta(bigint, jsonb) from public, anon;
grant  execute on function actualizar_precios_venta(bigint, jsonb) to authenticated;
