-- =====================================================================
-- GScom — Tienda online (nivel 1: catálogo público + pedido por WhatsApp)
-- · productos.publicado: se muestra en la tienda (por defecto sí)
-- · productos.foto_url: foto pública (bucket de Storage "productos")
-- · catalogo_tienda(): lo ÚNICO que ve el público. Nunca expone costos,
--   proveedores, notas internas ni cantidades exactas de stock.
-- =====================================================================

alter table productos add column if not exists publicado boolean not null default true;
alter table productos add column if not exists foto_url text not null default '';

-- ---------- Fotos: bucket público de lectura; solo usuarios activos suben/borran ----------
insert into storage.buckets (id, name, public) values ('productos', 'productos', true)
on conflict (id) do update set public = true;

drop policy if exists "gscom fotos subir"  on storage.objects;
drop policy if exists "gscom fotos cambiar" on storage.objects;
drop policy if exists "gscom fotos borrar" on storage.objects;
create policy "gscom fotos subir"  on storage.objects for insert to authenticated with check (bucket_id = 'productos' and es_usuario_activo());
create policy "gscom fotos cambiar" on storage.objects for update to authenticated using (bucket_id = 'productos' and es_usuario_activo());
create policy "gscom fotos borrar" on storage.objects for delete to authenticated using (bucket_id = 'productos' and es_usuario_activo());

-- ---------- Catálogo público ----------
-- estado: 'disponible' | 'ultimas' (queda poco) | 'encargo' (sin stock: se consigue por encargo)
create or replace function catalogo_tienda() returns jsonb
language sql stable security definer set search_path = public as $$
  with reservas as (
    select producto_id, sum(cantidad) as reservado from encargos
     where estado = 'reservado' and producto_id is not null group by producto_id
  ),
  prods as (
    select p.id, p.nombre, p.marca, p.foto_url, p.precio_venta, p.stock_minimo, c.nombre as categoria,
           -- la descripción interna puede tener avisos de revisión: no se publican
           case when p.descripcion like '⚠%' or p.descripcion like '%[dado de baja%' then '' else p.descripcion end as descripcion,
           greatest(p.stock - coalesce(r.reservado, 0), 0) as disponible
      from productos p
      left join categorias c on c.id = p.categoria_id
      left join reservas r on r.producto_id = p.id
     where p.activo and p.publicado and not p.es_servicio and p.precio_venta > 0
  )
  select jsonb_build_object(
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'direccion', n.direccion, 'telefono', n.telefono,
                                          'whatsapp', n.whatsapp, 'email', n.email, 'horario', n.horario) from negocio n where n.id = 1),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'marca', marca, 'descripcion', descripcion, 'categoria', categoria,
        'precio', precio_venta, 'foto', foto_url,
        'estado', case when disponible <= 0 then 'encargo'
                       when disponible <= greatest(stock_minimo, 1) then 'ultimas'
                       else 'disponible' end)
        order by nombre) from prods), '[]'::jsonb)
  );
$$;

revoke execute on function catalogo_tienda() from public;
grant  execute on function catalogo_tienda() to anon, authenticated;
