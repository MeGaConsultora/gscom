-- =====================================================================
-- GScom — Elit: el costo de Elit solo se aplica cuando corresponde
-- · productos.elit_sigue_costo: si es true, cada sincronización le pone el
--   costo de Elit (y su precio cambia si va por margen). Se puede cambiar
--   producto por producto desde su ficha.
-- · Productos agregados desde Elit (nuevos): siguen el costo de Elit.
-- · Productos que ya existían y coinciden por código de barras: se vinculan
--   SOLO como referencia (para comparar costo y stock con Elit). No se les
--   cambia costo, precio ni foto: se los podés comprar a otro proveedor.
-- =====================================================================

alter table productos add column if not exists elit_sigue_costo boolean not null default false;

create or replace function elit_agregar(p_ids bigint[]) returns jsonb
language plpgsql as $$
declare e elit_productos; c elit_categorias; v_prov bigint; v_def numeric; v_pid bigint; v_creados int := 0; v_vinc int := 0; v_ya int := 0;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select proveedor_id, margen_defecto into v_prov, v_def from elit_config where id = 1;
  if v_prov is null then
    select id into v_prov from proveedores where upper(btrim(nombre)) = 'ELIT' order by id limit 1;
    if v_prov is null then insert into proveedores (nombre) values ('ELIT') returning id into v_prov; end if;
    update elit_config set proveedor_id = v_prov where id = 1;
  end if;

  for e in select * from elit_productos where id = any (p_ids) and activo loop
    if exists (select 1 from productos where elit_id = e.id) then v_ya := v_ya + 1; continue; end if;
    select * into c from elit_categorias where categoria = e.categoria;
    v_pid := null;
    if coalesce(btrim(e.ean), '') <> '' then
      select id into v_pid from productos where codigo_barras = btrim(e.ean) and activo limit 1;
    end if;
    if v_pid is not null then
      -- ya lo tenías: solo queda vinculado como referencia (no se toca nada más)
      update productos set elit_id = e.id, elit_sigue_costo = false where id = v_pid;
      v_vinc := v_vinc + 1;
    else
      insert into productos (nombre, marca, codigo_barras, categoria_id, proveedor_id, precio_costo, precio_venta, margen,
                             foto_url, elit_id, elit_sigue_costo, stock_minimo, publicado)
      values (e.nombre, e.marca, nullif(btrim(coalesce(e.ean, '')), ''), c.categoria_id, v_prov, coalesce(e.costo_ars, 0), 0,
              coalesce(c.margen, v_def), e.imagen, e.id, true, 0, true);
      v_creados := v_creados + 1;
    end if;
  end loop;
  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinc, 'ya_estaban', v_ya);
end $$;

create or replace function elit_aplicar_costos() returns int
language plpgsql as $$
declare v_n int;
begin
  if not (es_usuario_activo() or coalesce(auth.role(), '') = 'service_role') then raise exception 'Sin permiso'; end if;
  update productos p set precio_costo = e.costo_ars
    from elit_productos e
   where p.elit_id = e.id and p.elit_sigue_costo and e.activo and e.costo_ars is not null and e.costo_ars > 0
     and p.precio_costo is distinct from e.costo_ars;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
