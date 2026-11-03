-- =====================================================================
-- GScom — Códigos de barras de fábrica y códigos de cada proveedor
-- · productos.codigos_extra: códigos que también identifican al producto. Cuando a un
--   producto con código interno (los "int" que genera GScom) se le carga el código de
--   fábrica, el interno pasa acá: así las etiquetas ya impresas se siguen leyendo.
-- · asignar_codigo_barras(): carga el código de fábrica de un producto (controla que
--   ningún otro producto lo tenga, ni como principal ni como extra).
-- · producto_codigos_proveedor: el código que usa cada proveedor para cada producto
--   (lo que figura en sus facturas). Con eso, la próxima factura del mismo proveedor
--   reconoce el renglón exacto, sin depender del nombre.
-- =====================================================================

alter table productos add column if not exists codigos_extra text[] not null default '{}';

create or replace function asignar_codigo_barras(p_producto_id bigint, p_codigo text) returns void
language plpgsql as $$
declare v text := btrim(coalesce(p_codigo, '')); p productos; otro text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if v !~ '^[0-9A-Za-z.\-]{4,40}$' then raise exception 'El código "%" no es válido', v; end if;
  select * into p from productos where id = p_producto_id for update;
  if not found then raise exception 'El producto no existe'; end if;
  if lower(coalesce(p.codigo_barras, '')) = lower(v) then return; end if;
  select nombre into otro from productos
   where id <> p_producto_id and (lower(codigo_barras) = lower(v) or lower(v) = any (select lower(x) from unnest(codigos_extra) x))
   limit 1;
  if otro is not null then raise exception 'Ese código ya lo tiene otro producto: %', otro; end if;
  update productos set
    codigos_extra = case when coalesce(p.codigo_barras, '') <> '' and not (p.codigo_barras = any (codigos_extra))
                         then array_append(array_remove(codigos_extra, v), p.codigo_barras) else array_remove(codigos_extra, v) end,
    codigo_barras = v,
    codigo_interno = false
   where id = p_producto_id;
end $$;

create table if not exists producto_codigos_proveedor (
  proveedor_id  bigint not null references proveedores(id) on delete cascade,
  codigo        text not null,
  producto_id   bigint not null references productos(id) on delete cascade,
  descripcion   text not null default '',
  actualizado   timestamptz not null default now(),
  primary key (proveedor_id, codigo)
);
alter table producto_codigos_proveedor enable row level security;
drop policy if exists "usuarios activos" on producto_codigos_proveedor;
create policy "usuarios activos" on producto_codigos_proveedor for all to authenticated
  using (es_usuario_activo()) with check (es_usuario_activo());

revoke execute on function asignar_codigo_barras(bigint, text) from public, anon;
grant  execute on function asignar_codigo_barras(bigint, text) to authenticated;
