-- =====================================================================
-- GScom — Una venta reintentada no se registra dos veces
-- Si se corta la conexión justo al guardar, la venta puede quedar registrada sin que
-- la pantalla se entere; al volver a tocar Cobrar se duplicaba. Ahora cada intento
-- lleva una clave (ventas.clave): con la misma clave, la base devuelve la venta que
-- ya existe en lugar de crear otra. Las ventas viejas quedan sin clave.
-- =====================================================================
alter table ventas add column if not exists clave uuid;
create unique index if not exists idx_ventas_clave on ventas(clave) where clave is not null;

drop function if exists registrar_venta(bigint, jsonb, numeric, text, text, jsonb);
create or replace function registrar_venta(
  p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default '', p_pagos jsonb default null, p_clave uuid default null
) returns bigint language plpgsql as $$
declare
  v_id bigint; v_subtotal numeric := 0; v_total numeric; v_recargo numeric; v_pagos jsonb; it jsonb; v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- La misma venta reintentada (misma clave): no se registra de nuevo, se devuelve la que ya está
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
    select id into v_id from ventas where clave = p_clave;
    if found then return v_id; end if;
  end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_recargo := recargo_de_pagos(p_pagos);
  v_total := v_subtotal - coalesce(p_descuento, 0) + v_recargo;

  v_pagos := normalizar_pagos_venta(p_pagos, v_total, p_cliente_id);
  if v_pagos is null and p_pagos is not null and jsonb_array_length(p_pagos) = 1 then p_forma_pago := p_pagos->0->>'forma_pago'; end if;
  if v_pagos is null and p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then
    raise exception 'Para vender a cuenta corriente hay que elegir el cliente';
  end if;

  insert into ventas (clave, cliente_id, subtotal, descuento, recargo, total, forma_pago, pagos, notas)
  values (p_clave, p_cliente_id, v_subtotal, coalesce(p_descuento, 0), v_recargo, v_total,
          coalesce(texto_pagos(v_pagos), p_forma_pago), v_pagos, coalesce(p_notas, ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_id, nullif(it->>'producto_id','')::bigint, it->>'descripcion', (it->>'cantidad')::numeric,
            (it->>'precio_unitario')::numeric, (it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric);
    if nullif(it->>'producto_id','') is not null then
      insert into stock_movimientos (producto_id, cantidad, tipo, venta_id)
      values ((it->>'producto_id')::bigint, -(it->>'cantidad')::numeric, 'venta', v_id);
    end if;
  end loop;

  select * into v from ventas where id = v_id;
  perform aplicar_pagos_venta(v, 1, 'Venta #' || v.numero);
  return v_id;
end $$;
revoke execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb, uuid) from public, anon;
grant  execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb, uuid) to authenticated;
notify pgrst, 'reload schema';
