-- =====================================================================
-- GScom — Editar y eliminar compras (operaciones atómicas)
-- El stock nunca se toca directo: se registran movimientos que revierten
-- lo que la compra había sumado, y (al editar) se aplican los ítems nuevos.
-- =====================================================================

-- Eliminar compra: resta del stock lo que había sumado y la borra
create or replace function eliminar_compra(p_compra_id bigint) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from compras where id = p_compra_id) then raise exception 'La compra no existe'; end if;
  insert into stock_movimientos (producto_id, cantidad, tipo, compra_id, nota)
  select producto_id, -cantidad, 'anulacion', p_compra_id, 'Eliminación de compra #' || p_compra_id
    from compra_items where compra_id = p_compra_id;
  delete from compras where id = p_compra_id;   -- compra_items se borran en cascada
end $$;

-- Editar compra: revierte los ítems anteriores y aplica los nuevos (conserva la fecha original)
create or replace function editar_compra(
  p_compra_id bigint, p_proveedor_id bigint, p_nro_comprobante text, p_items jsonb, p_notas text default ''
) returns bigint language plpgsql as $$
declare it jsonb;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from compras where id = p_compra_id) then raise exception 'La compra no existe'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La compra no tiene ítems'; end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, compra_id, nota)
  select producto_id, -cantidad, 'ajuste', p_compra_id, 'Corrección de compra #' || p_compra_id
    from compra_items where compra_id = p_compra_id;
  delete from compra_items where compra_id = p_compra_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into compra_items (compra_id, producto_id, cantidad, costo_unitario)
    values (p_compra_id, (it->>'producto_id')::bigint, (it->>'cantidad')::numeric, (it->>'costo_unitario')::numeric);
    insert into stock_movimientos (producto_id, cantidad, tipo, compra_id, nota)
    values ((it->>'producto_id')::bigint, (it->>'cantidad')::numeric, 'compra', p_compra_id, 'Compra #' || p_compra_id || ' (editada)');
    update productos set precio_costo = (it->>'costo_unitario')::numeric where id = (it->>'producto_id')::bigint;
  end loop;

  update compras set
    proveedor_id = p_proveedor_id,
    nro_comprobante = coalesce(p_nro_comprobante, ''),
    notas = coalesce(p_notas, ''),
    total = (select coalesce(sum((x->>'cantidad')::numeric * (x->>'costo_unitario')::numeric), 0) from jsonb_array_elements(p_items) x)
  where id = p_compra_id;
  return p_compra_id;
end $$;

-- Solo usuarios logueados (el público no puede ejecutarlas)
revoke execute on function eliminar_compra(bigint) from public, anon;
revoke execute on function editar_compra(bigint, bigint, text, jsonb, text) from public, anon;
grant  execute on function eliminar_compra(bigint) to authenticated;
grant  execute on function editar_compra(bigint, bigint, text, jsonb, text) to authenticated;
