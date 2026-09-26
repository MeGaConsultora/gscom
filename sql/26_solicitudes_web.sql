-- =====================================================================
-- GScom — Solicitudes desde la tienda online
-- · El cliente arma su pedido en la tienda y lo envía con nombre y WhatsApp.
--   Entra como "solicitud pendiente": NO reserva stock ni va a Pedidos.
-- · Un administrador la revisa (le escribe por WhatsApp) y la confirma
--   (se convierte en reservas/encargos) o la descarta.
-- · Mientras está pendiente, el cliente puede cancelarla desde su link:
--   se BORRA por completo, como si no hubiera existido.
-- · Límites contra abusos: 3 solicitudes por teléfono por día, 30 por hora
--   en total, cantidades acotadas y una "trampa" para robots.
-- =====================================================================

create table if not exists solicitudes_web (
  id          bigint generated always as identity primary key,
  token       uuid not null unique default gen_random_uuid(),   -- secreto: el link del cliente
  fecha       timestamptz not null default now(),
  nombre      text not null,
  telefono    text not null,
  comentario  text not null default '',
  items       jsonb not null,          -- [{producto_id, nombre, precio, cantidad, estado}] al momento de pedir
  total       numeric(14,2) not null default 0,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'descartada')),
  atendida_at timestamptz,
  usuario_id  uuid
);
create index if not exists idx_solicitudes_web_estado on solicitudes_web(estado);

alter table solicitudes_web enable row level security;
drop policy if exists "usuarios activos" on solicitudes_web;
create policy "usuarios activos" on solicitudes_web for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- Contadores para los límites (el teléfono se guarda cifrado con md5, no en claro)
create table if not exists solicitudes_limite (
  clave     text primary key,
  cantidad  int not null default 0,
  vence     timestamptz not null
);
alter table solicitudes_limite enable row level security;   -- sin políticas: solo lo usan las funciones

-- Aviso en tiempo real a GScom (Realtime respeta RLS: solo administradores)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitudes_web') then
    alter publication supabase_realtime add table solicitudes_web;
  end if;
end $$;

-- ---------- Público: crear ----------
create or replace function crear_solicitud_web(p_nombre text, p_telefono text, p_comentario text, p_items jsonb, p_trampa text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_nombre text := left(trim(coalesce(p_nombre, '')), 80);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; x jsonb; p record; v_cant int;
  v_clave text; v_n int; r solicitudes_web;
begin
  -- robot que completó el campo invisible: se le responde "ok" sin guardar nada
  if coalesce(p_trampa, '') <> '' then return jsonb_build_object('token', gen_random_uuid(), 'numero', 0); end if;
  if length(v_nombre) < 2 then raise exception 'Poné tu nombre'; end if;
  if length(v_tel) < 8 or length(v_tel) > 15 then raise exception 'Revisá el número de WhatsApp'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'El pedido está vacío'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Máximo 30 productos distintos por solicitud'; end if;

  -- límites
  delete from solicitudes_limite where vence < now();
  v_clave := 'tel:' || md5(right(v_tel, 10));
  insert into solicitudes_limite (clave, cantidad, vence) values (v_clave, 1, now() + interval '1 day')
  on conflict (clave) do update set cantidad = solicitudes_limite.cantidad + 1 returning cantidad into v_n;
  if v_n > 3 then raise exception 'Ya enviaste varias solicitudes hoy. Escribinos por WhatsApp y te atendemos.'; end if;
  insert into solicitudes_limite (clave, cantidad, vence) values ('global:' || to_char(now(), 'YYYYMMDDHH24'), 1, now() + interval '2 hours')
  on conflict (clave) do update set cantidad = solicitudes_limite.cantidad + 1 returning cantidad into v_n;
  if v_n > 30 then raise exception 'Estamos recibiendo muchas solicitudes. Probá en un rato o escribinos por WhatsApp.'; end if;

  -- ítems: nombre y precio salen de la base, nunca del navegador
  for x in select * from jsonb_array_elements(p_items) loop
    v_cant := least(greatest(coalesce((x->>'cantidad')::numeric, 0)::int, 0), 20);
    if v_cant < 1 then continue; end if;
    select pr.id, pr.nombre, pr.precio_venta,
           estado_tienda(greatest(pr.stock - coalesce((select sum(cantidad) from encargos e where e.estado = 'reservado' and e.producto_id = pr.id), 0), 0), pr.stock_minimo) as estado
      into p from productos pr
     where pr.id = (x->>'producto_id')::bigint and pr.activo and pr.publicado and not pr.es_servicio and pr.precio_venta > 0;
    if not found then continue; end if;
    v_items := v_items || jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'precio', p.precio_venta, 'cantidad', v_cant, 'estado', p.estado);
    v_total := v_total + p.precio_venta * v_cant;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Los productos elegidos ya no están disponibles en la tienda'; end if;

  insert into solicitudes_web (nombre, telefono, comentario, items, total)
  values (v_nombre, v_tel, left(trim(coalesce(p_comentario, '')), 300), v_items, v_total)
  returning * into r;
  return jsonb_build_object('token', r.token, 'numero', r.id);
end $$;

-- ---------- Público: ver (solo con el token) ----------
create or replace function ver_solicitud_web(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('numero', s.id, 'fecha', s.fecha, 'nombre', split_part(s.nombre, ' ', 1), 'items', s.items,
                            'total', s.total, 'estado', s.estado, 'comentario', s.comentario)
    from solicitudes_web s where s.token = p_token;
$$;

-- ---------- Público: cancelar (solo pendiente; se borra por completo) ----------
create or replace function cancelar_solicitud_web(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from solicitudes_web where token = p_token for update;
  if not found then return 'no_existe'; end if;
  if v_estado <> 'pendiente' then return v_estado; end if;
  delete from solicitudes_web where token = p_token;
  return 'cancelada';
end $$;

-- ---------- GScom: tomar una solicitud (confirmar o descartar) ----------
-- Se marca de forma atómica: si el cliente la canceló un instante antes, falla.
create or replace function atender_solicitud_web(p_id bigint, p_estado text) returns jsonb
language plpgsql as $$
declare r solicitudes_web;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if p_estado not in ('confirmada', 'descartada') then raise exception 'Estado no válido'; end if;
  update solicitudes_web set estado = p_estado, atendida_at = now(), usuario_id = auth.uid()
   where id = p_id and estado = 'pendiente' returning * into r;
  if not found then raise exception 'La solicitud ya no está pendiente (quizás el cliente la canceló)'; end if;
  return to_jsonb(r);
end $$;

revoke execute on function crear_solicitud_web(text, text, text, jsonb, text) from public;
revoke execute on function ver_solicitud_web(uuid) from public;
revoke execute on function cancelar_solicitud_web(uuid) from public;
revoke execute on function atender_solicitud_web(bigint, text) from public, anon;
grant  execute on function crear_solicitud_web(text, text, text, jsonb, text) to anon, authenticated;
grant  execute on function ver_solicitud_web(uuid) to anon, authenticated;
grant  execute on function cancelar_solicitud_web(uuid) to anon, authenticated;
grant  execute on function atender_solicitud_web(bigint, text) to authenticated;
