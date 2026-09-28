-- =====================================================================
-- GScom — Cartel/etiqueta de texto libre por producto para la tienda
-- (ej: "¡¡OFERTA!!", "ÚLTIMO INGRESO", "10 unid. x $45.000"). Se suma
-- a lo que ya existía (destacado, descripción web).
-- =====================================================================

alter table productos add column if not exists etiqueta_web text not null default '';

-- ---------- Catálogo público: ahora incluye la etiqueta ----------
create or replace function catalogo_tienda() returns jsonb
language sql stable security definer set search_path = public as $$
  with cfg as (select * from tienda_config where id = 1),
  reservas as (
    select producto_id, sum(cantidad) as reservado from encargos
     where estado = 'reservado' and producto_id is not null group by producto_id
  ),
  prods as (
    select p.id, p.nombre, p.marca, p.foto_url, p.precio_venta, p.stock_minimo, p.destacado, p.etiqueta_web, c.nombre as categoria,
           descripcion_publica(p.descripcion_web, p.descripcion) as descripcion,
           greatest(p.stock - coalesce(r.reservado, 0), 0) as disponible
      from productos p
      left join categorias c on c.id = p.categoria_id
      left join reservas r on r.producto_id = p.id
     where p.activo and p.publicado and not p.es_servicio and p.precio_venta > 0
       and (p.categoria_id is null or not exists (select 1 from cfg where p.categoria_id = any (cfg.categorias_ocultas)))
  )
  select jsonb_build_object(
    'negocio', (select jsonb_build_object('nombre', n.nombre, 'direccion', n.direccion, 'telefono', n.telefono,
                                          'whatsapp', n.whatsapp, 'email', n.email, 'horario', n.horario) from negocio n where n.id = 1),
    'tienda', (select jsonb_build_object('aviso', aviso, 'aviso_color', aviso_color, 'bienvenida', bienvenida, 'pagos', pagos,
                                         'envios', envios, 'instagram', instagram, 'facebook', facebook, 'tiktok', tiktok) from cfg),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'marca', marca, 'descripcion', descripcion, 'categoria', categoria,
        'precio', precio_venta, 'foto', foto_url, 'destacado', destacado, 'etiqueta', nullif(etiqueta_web, ''),
        'estado', estado_tienda(disponible, stock_minimo))
        order by nombre) from prods), '[]'::jsonb)
  );
$$;

-- ---------- Pantalla "Tienda" de GScom: ahora incluye la etiqueta ----------
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
        'descripcion_web', p.descripcion_web, 'descripcion_publica', descripcion_publica('', p.descripcion), 'etiqueta_web', p.etiqueta_web,
        'estado', estado_tienda(greatest(p.stock - coalesce(r.reservado, 0), 0), p.stock_minimo))
        order by p.nombre, p.id)
      from productos p
      left join (select producto_id, sum(cantidad) as reservado from encargos
                  where estado = 'reservado' and producto_id is not null group by producto_id) r on r.producto_id = p.id
     where p.activo and not p.es_servicio), '[]'::jsonb)
  );
end $$;

-- ---------- Guardar cambios de un producto desde la tienda: ahora acepta etiqueta_web ----------
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
    etiqueta_web    = case when p_datos ? 'etiqueta_web' then left(trim(coalesce(p_datos->>'etiqueta_web', '')), 40) else etiqueta_web end,
    foto_url        = case when p_datos ? 'foto_url' then coalesce(p_datos->>'foto_url', '') else foto_url end
  where id = p_id and activo;
  if not found then raise exception 'Producto no encontrado'; end if;
end $$;
