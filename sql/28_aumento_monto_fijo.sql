-- =====================================================================
-- GScom — Actualización de precios también por MONTO FIJO
-- ajustar_precios() ahora acepta p_monto: si viene, se suma ese monto
-- (ej: +500 a todos los routers) en lugar de aplicar un porcentaje.
-- Los productos que quedarían en 0 o negativo no se tocan.
-- =====================================================================

drop function if exists ajustar_precios(bigint[], text, numeric, numeric, text);

create or replace function ajustar_precios(p_ids bigint[], p_campo text, p_porcentaje numeric, p_redondeo numeric,
                                           p_detalle text default '', p_monto numeric default null)
returns jsonb language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_n int; v_pct numeric := coalesce(p_porcentaje, 0);
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_campo not in ('venta', 'costo') then raise exception 'Campo no válido'; end if;
  if p_monto is not null then
    if p_monto = 0 or abs(p_monto) > 100000000 then raise exception 'Monto fuera de rango'; end if;
  elsif v_pct = 0 or v_pct < -90 or v_pct > 500 then raise exception 'Porcentaje fuera de rango';
  end if;

  insert into precios_historial (lote, producto_id, costo_antes, venta_antes, detalle)
  select v_lote, id, precio_costo, precio_venta, left(coalesce(p_detalle, ''), 200) from productos
   where id = any (p_ids) and activo
     and (case when p_campo = 'venta'
               then margen is null and precio_venta > 0 and (p_monto is null or precio_venta + p_monto > 0)
               else precio_costo > 0 and (p_monto is null or precio_costo + p_monto > 0) end);
  get diagnostics v_n = row_count;

  if p_campo = 'venta' then
    update productos set precio_venta = redondear_precio(case when p_monto is not null then precio_venta + p_monto
                                                              else precio_venta * (1 + v_pct / 100) end, p_redondeo)
     where id in (select producto_id from precios_historial where lote = v_lote);
  else
    update productos set precio_costo = round(case when p_monto is not null then precio_costo + p_monto
                                                   else precio_costo * (1 + v_pct / 100) end, 2)
     where id in (select producto_id from precios_historial where lote = v_lote);
  end if;

  update precios_historial h set costo_despues = p.precio_costo, venta_despues = p.precio_venta
    from productos p where h.lote = v_lote and p.id = h.producto_id;
  return jsonb_build_object('lote', v_lote, 'cantidad', v_n);
end $$;

revoke execute on function ajustar_precios(bigint[], text, numeric, numeric, text, numeric) from public, anon;
grant  execute on function ajustar_precios(bigint[], text, numeric, numeric, text, numeric) to authenticated;
