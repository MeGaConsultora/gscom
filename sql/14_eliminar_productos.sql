-- =====================================================================
-- GScom — Eliminar productos
-- Sin historial (nunca vendido, comprado ni usado en service): se borra.
-- Con historial: se da de baja (activo = false) para no romper ventas,
-- compras y órdenes viejas, y se libera su código de barras para poder
-- reutilizarlo en otro producto.
-- Devuelve 'eliminado' o 'baja'.
-- =====================================================================
create or replace function eliminar_producto(p_id bigint) returns text
language plpgsql as $$
declare p productos;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into p from productos where id = p_id for update;
  if not found then raise exception 'El producto no existe'; end if;

  if not exists (select 1 from venta_items where producto_id = p_id)
     and not exists (select 1 from compra_items where producto_id = p_id)
     and not exists (select 1 from orden_items where producto_id = p_id) then
    delete from stock_movimientos where producto_id = p_id;   -- solo ajustes / stock inicial
    delete from productos where id = p_id;
    return 'eliminado';
  end if;

  update productos
     set activo = false,
         codigo_barras = null,
         descripcion = btrim(coalesce(descripcion, '') || ' [dado de baja; código ' || coalesce(p.codigo_barras, '—') || ']')
   where id = p_id;
  return 'baja';
end $$;

revoke execute on function eliminar_producto(bigint) from public, anon;
grant  execute on function eliminar_producto(bigint) to authenticated;
