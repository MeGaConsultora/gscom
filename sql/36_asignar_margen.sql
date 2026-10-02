-- =====================================================================
-- GScom — Asignar (o quitar) margen a muchos productos a la vez
-- · asignar_margen(): pone el mismo margen % a un grupo de productos; su precio
--   de venta pasa a calcularse solo desde el costo (y se actualiza cuando cambia
--   el costo). Con p_margen = NULL quita el margen automático: los productos
--   quedan con su precio actual como precio fijo.
-- · El historial guarda también el margen anterior, para poder deshacerlo
--   (mismo botón "Deshacer" que la actualización de precios).
-- =====================================================================

alter table precios_historial add column if not exists cambia_margen  boolean not null default false;
alter table precios_historial add column if not exists margen_antes   numeric(8,2);
alter table precios_historial add column if not exists margen_despues numeric(8,2);

create or replace function asignar_margen(p_ids bigint[], p_margen numeric, p_detalle text default '')
returns jsonb language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_n int;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_margen is not null and (p_margen < 0 or p_margen > 1000) then raise exception 'Margen fuera de rango (0 a 1000%%)'; end if;

  insert into precios_historial (lote, producto_id, costo_antes, venta_antes, margen_antes, cambia_margen, detalle)
  select v_lote, id, precio_costo, precio_venta, margen, true, left(coalesce(p_detalle, ''), 200) from productos
   where id = any (p_ids) and activo
     and (case when p_margen is null then margen is not null else precio_costo > 0 end);
  get diagnostics v_n = row_count;

  -- con margen, el trigger calcular_precio_por_margen recalcula el precio de venta
  update productos set margen = p_margen
   where id in (select producto_id from precios_historial where lote = v_lote);

  update precios_historial h set costo_despues = p.precio_costo, venta_despues = p.precio_venta, margen_despues = p.margen
    from productos p where h.lote = v_lote and p.id = h.producto_id;
  return jsonb_build_object('lote', v_lote, 'cantidad', v_n);
end $$;

-- Deshacer: ahora también vuelve el margen a como estaba (si ese cambio lo tocó)
create or replace function deshacer_ajuste_precios(p_lote uuid) returns int
language plpgsql as $$
declare v_n int;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  update productos p set precio_costo = h.costo_antes, precio_venta = h.venta_antes,
         margen = case when h.cambia_margen then h.margen_antes else p.margen end
    from precios_historial h
   where h.lote = p_lote and p.id = h.producto_id
     and p.precio_costo = h.costo_despues and p.precio_venta = h.venta_despues
     and (not h.cambia_margen or p.margen is not distinct from h.margen_despues);
  get diagnostics v_n = row_count;
  delete from precios_historial where lote = p_lote;
  return v_n;
end $$;

revoke execute on function asignar_margen(bigint[], numeric, text) from public, anon;
grant  execute on function asignar_margen(bigint[], numeric, text) to authenticated;
