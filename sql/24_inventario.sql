-- =====================================================================
-- GScom — Carga rápida de stock (inventario)
-- · productos.ultimo_conteo: cuándo se contó por última vez (marca "contado")
-- · contar_stock(): fija el stock contado, deja el ajuste en el historial
--   ("Conteo de inventario") y marca el producto como contado.
-- · reiniciar_conteo(): borra las marcas para empezar un inventario nuevo.
-- =====================================================================

alter table productos add column if not exists ultimo_conteo timestamptz;

create or replace function contar_stock(p_producto_id bigint, p_cantidad numeric) returns numeric
language plpgsql as $$
declare v_actual numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_cantidad is null or p_cantidad < 0 then raise exception 'La cantidad contada no puede ser negativa'; end if;
  select stock into v_actual from productos where id = p_producto_id for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_cantidad <> v_actual then
    insert into stock_movimientos (producto_id, cantidad, tipo, nota)
    values (p_producto_id, p_cantidad - v_actual, 'ajuste', 'Conteo de inventario (había ' || v_actual || ', se contaron ' || p_cantidad || ')');
  end if;
  update productos set ultimo_conteo = now() where id = p_producto_id;
  return p_cantidad;
end $$;

create or replace function reiniciar_conteo() returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  update productos set ultimo_conteo = null where ultimo_conteo is not null;
end $$;

revoke execute on function contar_stock(bigint, numeric) from public, anon;
revoke execute on function reiniciar_conteo() from public, anon;
grant  execute on function contar_stock(bigint, numeric) to authenticated;
grant  execute on function reiniciar_conteo() to authenticated;
