-- =====================================================================
-- GScom — Fotos desde los catálogos de proveedores
-- A los productos SIN foto se les pone la de algún catálogo de proveedor
-- conectado (por vínculo o por código de barras). Nunca reemplaza una foto
-- que ya tengan.
-- Hoy el único catálogo conectado es Elit; cuando se sume otro proveedor,
-- se agrega su "union all" en fotos_de_proveedores() y todo lo demás
-- (botón en Tienda, actualización nocturna) sigue igual.
-- =====================================================================

-- Una foto candidata por producto sin foto. "prioridad": menor = mejor
-- (primero el producto vinculado, después la coincidencia por código).
create or replace function fotos_de_proveedores()
returns table (producto_id bigint, imagen text, origen text)
language sql stable as $$
  select distinct on (s.producto_id) s.producto_id, s.imagen, s.origen
    from (
      -- Elit
      select p.id as producto_id, e.imagen, 'Elit'::text as origen, case when e.id = p.elit_id then 0 else 1 end as prioridad
        from productos p
        join elit_productos e
          on e.id = p.elit_id
          or (coalesce(btrim(p.codigo_barras), '') <> '' and btrim(e.ean) = btrim(p.codigo_barras))
       where p.activo and coalesce(p.foto_url, '') = '' and e.activo and coalesce(btrim(e.imagen), '') <> ''
      -- (acá se suman los catálogos de otros proveedores con "union all")
    ) s
   order by s.producto_id, s.prioridad
$$;

-- p_aplicar = false: solo cuenta cuántas fotos hay para completar. true: las completa.
create or replace function completar_fotos_proveedores(p_aplicar boolean default false) returns jsonb
language plpgsql as $$
declare v_n int; v_origen jsonb;
begin
  if not (es_usuario_activo() or coalesce(auth.role(), '') = 'service_role') then raise exception 'Sin permiso'; end if;
  select coalesce(jsonb_object_agg(origen, n), '{}'::jsonb) into v_origen
    from (select origen, count(*) as n from fotos_de_proveedores() group by origen) t;
  if not coalesce(p_aplicar, false) then
    select count(*) into v_n from fotos_de_proveedores();
    return jsonb_build_object('encontradas', v_n, 'por_origen', v_origen);
  end if;
  update productos p set foto_url = f.imagen
    from fotos_de_proveedores() f
   where p.id = f.producto_id and coalesce(p.foto_url, '') = '';
  get diagnostics v_n = row_count;
  return jsonb_build_object('completadas', v_n, 'por_origen', v_origen);
end $$;

-- Actualización nocturna del catálogo de Elit: después de los costos, completa las fotos que falten
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
  perform completar_fotos_proveedores(true);
  return v_n;
end $$;

revoke execute on function fotos_de_proveedores() from public, anon;
revoke execute on function completar_fotos_proveedores(boolean) from public, anon;
grant  execute on function fotos_de_proveedores() to authenticated, service_role;
grant  execute on function completar_fotos_proveedores(boolean) to authenticated, service_role;
