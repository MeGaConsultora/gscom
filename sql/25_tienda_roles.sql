-- =====================================================================
-- GScom — Administración de la tienda y usuarios "Tienda"
-- · perfiles.rol: 'admin' (acceso total, incluida la tienda) | 'tienda'
--   (solo la pestaña Tienda). Los usuarios actuales quedan como 'admin'.
-- · es_usuario_activo() pasa a significar "admin activo": así TODAS las
--   políticas y funciones existentes quedan cerradas para el rol tienda.
-- · es_usuario_tienda(): admin o tienda activo. El rol tienda trabaja solo
--   con las funciones tienda_*, que nunca devuelven costos, proveedores,
--   stock exacto ni datos de clientes.
-- · tienda_config: aviso, textos, redes y categorías ocultas.
-- · productos.destacado y productos.descripcion_web.
-- =====================================================================

-- ---------- Roles ----------
alter table perfiles add column if not exists rol text not null default 'admin';
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check check (rol in ('admin', 'tienda'));

create or replace function es_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol = 'admin');
$$;

create or replace function es_usuario_tienda() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo and rol in ('admin', 'tienda'));
$$;

-- ---------- Datos nuevos ----------
alter table productos add column if not exists destacado boolean not null default false;
alter table productos add column if not exists descripcion_web text not null default '';

create table if not exists tienda_config (
  id                  int primary key default 1 check (id = 1),
  aviso               text not null default '',
  aviso_color         text not null default 'info' check (aviso_color in ('info', 'ok', 'warn')),
  bienvenida          text not null default '',
  pagos               text not null default '',
  envios              text not null default '',
  instagram           text not null default '',
  facebook            text not null default '',
  tiktok              text not null default '',
  categorias_ocultas  bigint[] not null default '{}',
  updated_at          timestamptz not null default now()
);
insert into tienda_config (id) values (1) on conflict (id) do nothing;
-- Sin políticas: nadie la toca directo; solo a través de las funciones de abajo
alter table tienda_config enable row level security;

-- ---------- Fotos: también las puede subir/cambiar el rol tienda ----------
drop policy if exists "gscom fotos subir"  on storage.objects;
drop policy if exists "gscom fotos cambiar" on storage.objects;
drop policy if exists "gscom fotos borrar" on storage.objects;
create policy "gscom fotos subir"  on storage.objects for insert to authenticated with check (bucket_id = 'productos' and es_usuario_tienda());
create policy "gscom fotos cambiar" on storage.objects for update to authenticated using (bucket_id = 'productos' and es_usuario_tienda());
create policy "gscom fotos borrar" on storage.objects for delete to authenticated using (bucket_id = 'productos' and es_usuario_tienda());

-- ---------- Estado público de un producto (mismo criterio que la tienda) ----------
create or replace function estado_tienda(p_disponible numeric, p_minimo numeric) returns text
language sql immutable as $$
  select case when p_disponible <= 0 then 'encargo'
              when p_disponible <= greatest(p_minimo, 1) then 'ultimas'
              else 'disponible' end;
$$;

-- Descripción pública: la de la web; si no hay, la interna salvo avisos de revisión
create or replace function descripcion_publica(p_web text, p_interna text) returns text
language sql immutable as $$
  select case when coalesce(p_web, '') <> '' then p_web
              when p_interna like '⚠%' or p_interna like '%[dado de baja%' then ''
              else coalesce(p_interna, '') end;
$$;

-- ---------- Catálogo público (reemplaza al de 23_tienda.sql) ----------
create or replace function catalogo_tienda() returns jsonb
language sql stable security definer set search_path = public as $$
  with cfg as (select * from tienda_config where id = 1),
  reservas as (
    select producto_id, sum(cantidad) as reservado from encargos
     where estado = 'reservado' and producto_id is not null group by producto_id
  ),
  prods as (
    select p.id, p.nombre, p.marca, p.foto_url, p.precio_venta, p.stock_minimo, p.destacado, c.nombre as categoria,
           descripcion_publica(p.descripcion_web, p.descripcion) as descripcion,
           greatest(p.stock - coalesce(r.reservado, 0), 0) as disponible
      from productos p
      left join categorias c on c.id = p.categoria_id
      left join reservas r on r.producto_id = p.id
     where p.activo and p.publicado and not p.es_servicio and p.precio_venta > 0
       and (p.categoria_id is null or not p.categoria_id = any ((select categorias_ocultas from cfg)))
  )
  select jsonb_build_object(
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'direccion', n.direccion, 'telefono', n.telefono,
                                          'whatsapp', n.whatsapp, 'email', n.email, 'horario', n.horario) from negocio n where n.id = 1),
    'tienda', (select jsonb_build_object('aviso', aviso, 'aviso_color', aviso_color, 'bienvenida', bienvenida, 'pagos', pagos,
                                         'envios', envios, 'instagram', instagram, 'facebook', facebook, 'tiktok', tiktok) from cfg),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'marca', marca, 'descripcion', descripcion, 'categoria', categoria,
        'precio', precio_venta, 'foto', foto_url, 'destacado', destacado,
        'estado', estado_tienda(disponible, stock_minimo))
        order by nombre) from prods), '[]'::jsonb)
  );
$$;

-- ---------- Pantalla "Tienda" de GScom (admin y rol tienda) ----------
create or replace function tienda_admin_datos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_usuario_tienda() then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(t) - 'id' - 'updated_at' from tienda_config t where id = 1),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre) from categorias), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'codigo_barras', p.codigo_barras, 'nombre', p.nombre, 'marca', p.marca, 'categoria_id', p.categoria_id,
        'precio_venta', p.precio_venta, 'publicado', p.publicado, 'destacado', p.destacado, 'foto_url', p.foto_url,
        'descripcion_web', p.descripcion_web, 'descripcion_publica', descripcion_publica('', p.descripcion),
        'estado', estado_tienda(greatest(p.stock - coalesce(r.reservado, 0), 0), p.stock_minimo))
        order by p.nombre, p.id)
      from productos p
      left join (select producto_id, sum(cantidad) as reservado from encargos
                  where estado = 'reservado' and producto_id is not null group by producto_id) r on r.producto_id = p.id
     where p.activo and not p.es_servicio), '[]'::jsonb)
  );
end $$;

-- Solo cambia lo que es de la tienda: publicado, destacado, descripción web y foto
create or replace function tienda_actualizar_producto(p_id bigint, p_datos jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_usuario_tienda() then raise exception 'Sin permiso'; end if;
  if p_datos ? 'foto_url' and coalesce(p_datos->>'foto_url', '') <> ''
     and p_datos->>'foto_url' not like '%/storage/v1/object/public/productos/%' then
    raise exception 'Foto no válida';
  end if;
  update productos set
    publicado       = case when p_datos ? 'publicado' then (p_datos->>'publicado')::boolean else publicado end,
    destacado       = case when p_datos ? 'destacado' then (p_datos->>'destacado')::boolean else destacado end,
    descripcion_web = case when p_datos ? 'descripcion_web' then left(trim(coalesce(p_datos->>'descripcion_web', '')), 2000) else descripcion_web end,
    foto_url        = case when p_datos ? 'foto_url' then coalesce(p_datos->>'foto_url', '') else foto_url end
  where id = p_id and activo;
  if not found then raise exception 'Producto no encontrado'; end if;
end $$;

create or replace function tienda_publicar(p_ids bigint[], p_publicado boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_usuario_tienda() then raise exception 'Sin permiso'; end if;
  update productos set publicado = p_publicado where id = any (p_ids);
end $$;

create or replace function tienda_guardar_config(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_usuario_tienda() then raise exception 'Sin permiso'; end if;
  update tienda_config set
    aviso       = left(trim(coalesce(p->>'aviso', '')), 300),
    aviso_color = case when p->>'aviso_color' in ('info', 'ok', 'warn') then p->>'aviso_color' else 'info' end,
    bienvenida  = left(trim(coalesce(p->>'bienvenida', '')), 500),
    pagos       = left(trim(coalesce(p->>'pagos', '')), 1000),
    envios      = left(trim(coalesce(p->>'envios', '')), 1000),
    instagram   = left(trim(coalesce(p->>'instagram', '')), 200),
    facebook    = left(trim(coalesce(p->>'facebook', '')), 200),
    tiktok      = left(trim(coalesce(p->>'tiktok', '')), 200),
    categorias_ocultas = coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(coalesce(p->'categorias_ocultas', '[]'::jsonb)) x), '{}'),
    updated_at  = now()
  where id = 1;
end $$;

-- ---------- Usuarios (solo admin): activar/desactivar y elegir rol ----------
create or replace function usuarios_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', u.email, 'nombre', p.nombre, 'activo', p.activo, 'rol', p.rol,
                                                       'yo', p.id = auth.uid()) order by p.activo desc, u.email)
                     from perfiles p join auth.users u on u.id = p.id), '[]'::jsonb);
end $$;

create or replace function usuario_actualizar(p_id uuid, p_activo boolean, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_id = auth.uid() then raise exception 'No podés cambiar tu propio usuario (pedíselo a otro administrador)'; end if;
  if p_rol not in ('admin', 'tienda') then raise exception 'Rol no válido'; end if;
  update perfiles set activo = p_activo, rol = p_rol where id = p_id;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function es_usuario_tienda() from public, anon;
revoke execute on function estado_tienda(numeric, numeric) from public, anon;
revoke execute on function descripcion_publica(text, text) from public, anon;
revoke execute on function tienda_admin_datos() from public, anon;
revoke execute on function tienda_actualizar_producto(bigint, jsonb) from public, anon;
revoke execute on function tienda_publicar(bigint[], boolean) from public, anon;
revoke execute on function tienda_guardar_config(jsonb) from public, anon;
revoke execute on function usuarios_listar() from public, anon;
revoke execute on function usuario_actualizar(uuid, boolean, text) from public, anon;
grant  execute on function es_usuario_tienda() to authenticated;
grant  execute on function estado_tienda(numeric, numeric) to authenticated;
grant  execute on function descripcion_publica(text, text) to authenticated;
grant  execute on function tienda_admin_datos() to authenticated;
grant  execute on function tienda_actualizar_producto(bigint, jsonb) to authenticated;
grant  execute on function tienda_publicar(bigint[], boolean) to authenticated;
grant  execute on function tienda_guardar_config(jsonb) to authenticated;
grant  execute on function usuarios_listar() to authenticated;
grant  execute on function usuario_actualizar(uuid, boolean, text) to authenticated;
-- el catálogo público sigue igual: lo ve cualquiera
revoke execute on function catalogo_tienda() from public;
grant  execute on function catalogo_tienda() to anon, authenticated;
