-- =====================================================================
-- GScom — Precio por margen y actualización masiva de precios
-- · productos.margen: si tiene valor, el precio de venta se calcula solo
--   (costo × (1 + margen%)) cada vez que cambia el costo o el margen.
--   Si es NULL, el precio de venta es fijo (como siempre).
-- · negocio.redondeo_precios: los precios calculados se redondean hacia
--   arriba a ese múltiplo ($1, $10, $50, $100…).
-- · ajustar_precios(): aumenta (o baja) un % el precio de venta o el costo
--   de un grupo de productos, y deja registro para poder deshacerlo.
-- =====================================================================

alter table productos add column if not exists margen numeric(8,2);
alter table negocio add column if not exists redondeo_precios numeric(10,2) not null default 1;

create or replace function redondear_precio(p_valor numeric, p_multiplo numeric) returns numeric
language sql immutable as $$
  select case when coalesce(p_multiplo, 0) <= 0 then round(p_valor, 2)
              else ceil(round(p_valor, 2) / p_multiplo) * p_multiplo end;
$$;

-- Precio por margen: se recalcula al guardar el producto o cuando cambia el costo (compras incluidas)
create or replace function calcular_precio_por_margen() returns trigger
language plpgsql as $$
begin
  if new.margen is not null and coalesce(new.precio_costo, 0) > 0 then
    new.precio_venta := redondear_precio(new.precio_costo * (1 + new.margen / 100),
                                         (select redondeo_precios from negocio where id = 1));
  end if;
  return new;
end $$;

drop trigger if exists trg_precio_por_margen on productos;
create trigger trg_precio_por_margen before insert or update of precio_costo, margen, precio_venta on productos
  for each row execute function calcular_precio_por_margen();

-- ---------- Historial de ajustes (para deshacer) ----------
create table if not exists precios_historial (
  id             bigint generated always as identity primary key,
  lote           uuid not null,
  fecha          timestamptz not null default now(),
  producto_id    bigint not null references productos(id) on delete cascade,
  costo_antes    numeric(14,2), venta_antes numeric(14,2),
  costo_despues  numeric(14,2), venta_despues numeric(14,2),
  detalle        text not null default '',
  usuario_id     uuid default auth.uid()
);
create index if not exists idx_precios_historial_lote on precios_historial(lote);
alter table precios_historial enable row level security;
drop policy if exists "usuarios activos" on precios_historial;
create policy "usuarios activos" on precios_historial for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- p_campo: 'venta' (solo productos con precio fijo) | 'costo' (los de margen recalculan su precio solos)
create or replace function ajustar_precios(p_ids bigint[], p_campo text, p_porcentaje numeric, p_redondeo numeric, p_detalle text default '')
returns jsonb language plpgsql as $$
declare v_lote uuid := gen_random_uuid(); v_n int;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_campo not in ('venta', 'costo') then raise exception 'Campo no válido'; end if;
  if p_porcentaje is null or p_porcentaje = 0 or p_porcentaje < -90 or p_porcentaje > 500 then raise exception 'Porcentaje fuera de rango'; end if;

  insert into precios_historial (lote, producto_id, costo_antes, venta_antes, detalle)
  select v_lote, id, precio_costo, precio_venta, left(coalesce(p_detalle, ''), 200) from productos
   where id = any (p_ids) and activo
     and (case when p_campo = 'venta' then margen is null and precio_venta > 0 else precio_costo > 0 end);
  get diagnostics v_n = row_count;

  if p_campo = 'venta' then
    update productos set precio_venta = redondear_precio(precio_venta * (1 + p_porcentaje / 100), p_redondeo)
     where id in (select producto_id from precios_historial where lote = v_lote);
  else
    update productos set precio_costo = round(precio_costo * (1 + p_porcentaje / 100), 2)
     where id in (select producto_id from precios_historial where lote = v_lote);
  end if;

  update precios_historial h set costo_despues = p.precio_costo, venta_despues = p.precio_venta
    from productos p where h.lote = v_lote and p.id = h.producto_id;
  return jsonb_build_object('lote', v_lote, 'cantidad', v_n);
end $$;

-- Deshacer un ajuste: vuelve cada producto a como estaba, salvo que se haya modificado después
create or replace function deshacer_ajuste_precios(p_lote uuid) returns int
language plpgsql as $$
declare v_n int;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  update productos p set precio_costo = h.costo_antes, precio_venta = h.venta_antes
    from precios_historial h
   where h.lote = p_lote and p.id = h.producto_id
     and p.precio_costo = h.costo_despues and p.precio_venta = h.venta_despues;
  get diagnostics v_n = row_count;
  delete from precios_historial where lote = p_lote;
  return v_n;
end $$;

-- Último ajuste (para ofrecer deshacerlo)
create or replace function ultimo_ajuste_precios() returns jsonb
language sql stable as $$
  select jsonb_build_object('lote', lote, 'fecha', max(fecha), 'cantidad', count(*), 'detalle', max(detalle))
    from precios_historial
   where lote = (select lote from precios_historial order by fecha desc, id desc limit 1)
   group by lote;
$$;

revoke execute on function ajustar_precios(bigint[], text, numeric, numeric, text) from public, anon;
revoke execute on function deshacer_ajuste_precios(uuid) from public, anon;
revoke execute on function ultimo_ajuste_precios() from public, anon;
revoke execute on function calcular_precio_por_margen() from public, anon;
grant  execute on function ajustar_precios(bigint[], text, numeric, numeric, text) to authenticated;
grant  execute on function deshacer_ajuste_precios(uuid) to authenticated;
grant  execute on function ultimo_ajuste_precios() to authenticated;
