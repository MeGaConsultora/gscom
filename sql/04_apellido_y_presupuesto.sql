-- =====================================================================
-- GScom — Apellido y nombres por separado + respuesta de presupuesto
-- desde el link de seguimiento.
-- =====================================================================

-- ---------- 1. Clientes: apellido y nombres ----------
alter table clientes add column if not exists apellido text not null default '';
alter table clientes add column if not exists nombres  text not null default '';

-- Separar los clientes ya cargados ("Juan Pérez" → nombres Juan, apellido Pérez)
update clientes set
  nombres  = case when position(' ' in btrim(nombre)) > 0 then split_part(btrim(nombre), ' ', 1) else '' end,
  apellido = case when position(' ' in btrim(nombre)) > 0 then btrim(substr(btrim(nombre), position(' ' in btrim(nombre)) + 1)) else btrim(nombre) end
where apellido = '' and nombres = '';

-- "nombre" se sigue usando para mostrar y buscar: se arma solo como "Apellido, Nombres"
create or replace function armar_nombre_cliente() returns trigger
language plpgsql as $$
begin
  new.apellido := btrim(coalesce(new.apellido, ''));
  new.nombres  := btrim(coalesce(new.nombres, ''));
  new.nombre := case
    when new.apellido <> '' and new.nombres <> '' then new.apellido || ', ' || new.nombres
    when new.apellido <> '' then new.apellido
    when new.nombres  <> '' then new.nombres
    else coalesce(new.nombre, '') end;
  return new;
end $$;

drop trigger if exists trg_nombre_cliente on clientes;
create trigger trg_nombre_cliente before insert or update on clientes
  for each row execute function armar_nombre_cliente();

update clientes set apellido = apellido;  -- recalcula "nombre" con el formato nuevo

-- ---------- 2. Seguimiento: saluda por el nombre e informa la respuesta al presupuesto ----------
create or replace function seguimiento_orden(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero',               o.numero,
    'cliente',              coalesce(nullif(c.nombres, ''), split_part(c.nombre, ' ', 1)),
    'equipo',               btrim(coalesce(e.tipo,'') || ' ' || coalesce(e.marca,'') || ' ' || coalesce(e.modelo,'')),
    'falla',                o.falla_reportada,
    'estado',               o.estado,
    'fecha_ingreso',        o.fecha_ingreso,
    'fecha_estimada',       o.fecha_estimada,
    'fecha_entrega',        o.fecha_entrega,
    'presupuesto',          o.presupuesto,
    'presupuesto_aprobado', o.presupuesto_aprobado,
    'historial',            (select coalesce(jsonb_agg(jsonb_build_object('estado', h.estado, 'comentario', h.comentario, 'fecha', h.created_at) order by h.created_at), '[]'::jsonb)
                               from orden_estados h where h.orden_id = o.id),
    'negocio',              (select jsonb_build_object('nombre', n.nombre, 'telefono', n.telefono, 'whatsapp', n.whatsapp, 'direccion', n.direccion, 'horario', n.horario) from negocio n where n.id = 1)
  )
  from ordenes_servicio o
  join clientes c on c.id = o.cliente_id
  left join equipos e on e.id = o.equipo_id
  where o.token = p_token;
$$;

-- ---------- 3. El cliente acepta o rechaza el presupuesto desde su link ----------
-- Solo funciona con el token secreto de la orden, si está en "presupuesto",
-- tiene monto cargado y todavía no fue respondido.
create or replace function responder_presupuesto(p_token uuid, p_acepta boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o ordenes_servicio;
begin
  select * into o from ordenes_servicio where token = p_token for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if o.estado <> 'presupuesto' or o.presupuesto is null then raise exception 'Esta orden no tiene un presupuesto pendiente de respuesta'; end if;
  if o.presupuesto_aprobado is not null then raise exception 'El presupuesto ya fue respondido'; end if;

  update ordenes_servicio set presupuesto_aprobado = p_acepta where id = o.id;
  insert into orden_estados (orden_id, estado, comentario, usuario_id)
  values (o.id, o.estado,
          case when p_acepta then 'El cliente ACEPTÓ el presupuesto desde el link de seguimiento.'
               else 'El cliente RECHAZÓ el presupuesto desde el link de seguimiento.' end,
          null);
  return seguimiento_orden(p_token);
end $$;

revoke execute on function seguimiento_orden(uuid) from public;
revoke execute on function responder_presupuesto(uuid, boolean) from public;
grant  execute on function seguimiento_orden(uuid) to anon, authenticated;
grant  execute on function responder_presupuesto(uuid, boolean) to anon, authenticated;
revoke execute on function armar_nombre_cliente() from public, anon;
