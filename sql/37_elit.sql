-- =====================================================================
-- GScom — Integración con el mayorista ELIT (etapa 1: catálogo)
-- · elit_productos: copia del catálogo de Elit (la llena la función
--   "elit" de Supabase, que es la única que conoce las credenciales).
-- · elit_categorias: margen % y categoría de GScom para cada categoría de Elit.
-- · elit_config: última sincronización, margen por defecto, proveedor "ELIT".
-- · productos.elit_id: el producto de GScom que corresponde a uno de Elit.
-- · elit_agregar(): pasa productos de Elit a "Productos" (o vincula los que
--   ya existen con el mismo código de barras / EAN).
-- · elit_aplicar_costos(): después de cada sincronización, el costo de los
--   productos vinculados se actualiza (y su precio, si va por margen).
-- Todo es solo para administradores: ni la tienda ni el rol Tienda lo ven.
-- =====================================================================

create table if not exists elit_productos (
  id                bigint primary key,          -- código del producto en Elit
  codigo_alfa       text,
  codigo_producto   text,
  nombre            text not null default '',
  categoria         text not null default '',
  sub_categoria     text not null default '',
  marca             text not null default '',
  precio_usd        numeric(14,4),               -- precio base de Elit, sin IVA
  iva               numeric(6,2),
  impuesto_interno  numeric(8,2),
  moneda            int,
  markup            numeric(8,2),
  cotizacion        numeric(14,4),
  costo_ars         numeric(14,2),               -- lo que le pagás a Elit, en pesos y con IVA
  stock_total       numeric(14,2) not null default 0,
  stock_cd          numeric(14,2) not null default 0,
  stock_cliente     numeric(14,2) not null default 0,
  nivel_stock       text not null default '',
  ean               text,
  garantia          text not null default '',
  peso              numeric(10,3),
  link              text not null default '',
  imagen            text not null default '',
  miniatura         text not null default '',
  atributos         jsonb,
  actualizado_elit  text,
  sincronizado_at   timestamptz not null default now(),
  activo            boolean not null default true   -- false: dejó de estar en el catálogo de Elit
);
create index if not exists idx_elit_productos_categoria on elit_productos(categoria);
create index if not exists idx_elit_productos_ean on elit_productos(ean);

create table if not exists elit_categorias (
  categoria     text primary key,                 -- nombre de la categoría en Elit
  margen        numeric(8,2),                     -- % de ganancia sobre el costo
  categoria_id  bigint references categorias(id) on delete set null   -- en qué categoría de GScom entran
);

create table if not exists elit_config (
  id               int primary key default 1 check (id = 1),
  margen_defecto   numeric(8,2) not null default 30,
  proveedor_id     bigint references proveedores(id) on delete set null,
  ultima_sync      timestamptz,
  ultimo_resultado jsonb
);
insert into elit_config (id) values (1) on conflict (id) do nothing;

alter table productos add column if not exists elit_id bigint unique references elit_productos(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['elit_productos', 'elit_categorias', 'elit_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "usuarios activos" on %I', t);
    execute format('create policy "usuarios activos" on %I for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo())', t);
  end loop;
end $$;

-- ---------- Pasar productos de Elit a "Productos" ----------
-- Si ya existe un producto con el mismo código de barras (EAN), se vincula (no se duplica):
-- solo se le carga el costo de Elit; su precio sigue como estaba.
-- Los nuevos entran con el margen y la categoría configurados para su categoría de Elit.
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
      update productos set elit_id = e.id, proveedor_id = coalesce(proveedor_id, v_prov),
             precio_costo = coalesce(e.costo_ars, precio_costo),
             foto_url = case when coalesce(foto_url, '') = '' then e.imagen else foto_url end
       where id = v_pid;
      v_vinc := v_vinc + 1;
    else
      insert into productos (nombre, marca, codigo_barras, categoria_id, proveedor_id, precio_costo, precio_venta, margen,
                             foto_url, elit_id, stock_minimo, publicado)
      values (e.nombre, e.marca, nullif(btrim(coalesce(e.ean, '')), ''), c.categoria_id, v_prov, coalesce(e.costo_ars, 0), 0,
              coalesce(c.margen, v_def), e.imagen, e.id, 0, true);
      v_creados := v_creados + 1;
    end if;
  end loop;
  return jsonb_build_object('creados', v_creados, 'vinculados', v_vinc, 'ya_estaban', v_ya);
end $$;

-- ---------- Después de sincronizar: el costo de los vinculados sigue al de Elit ----------
-- (la llama la función "elit" de Supabase con la clave de servicio, o un administrador)
create or replace function elit_aplicar_costos() returns int
language plpgsql as $$
declare v_n int;
begin
  if not (es_usuario_activo() or coalesce(auth.role(), '') = 'service_role') then raise exception 'Sin permiso'; end if;
  update productos p set precio_costo = e.costo_ars
    from elit_productos e
   where p.elit_id = e.id and e.activo and e.costo_ars is not null and e.costo_ars > 0
     and p.precio_costo is distinct from e.costo_ars;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function elit_agregar(bigint[]) from public, anon;
revoke execute on function elit_aplicar_costos() from public, anon;
grant  execute on function elit_agregar(bigint[]) to authenticated;
grant  execute on function elit_aplicar_costos() to authenticated, service_role;
grant  all on elit_productos, elit_categorias, elit_config to service_role;
