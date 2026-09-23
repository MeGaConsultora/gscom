-- =====================================================================
-- GScom — Esquema de base de datos (Supabase / PostgreSQL)
-- Correr completo en: Supabase > SQL Editor > New query > Run
-- Es idempotente en lo posible (se puede volver a correr sin romper).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- USUARIOS
-- Todos los usuarios activos tienen acceso total. Un usuario nuevo de
-- Supabase Auth NO tiene acceso hasta que se lo marca activo = true.
-- (Así, aunque alguien lograra registrarse solo, no ve nada.)
-- ---------------------------------------------------------------------
create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null default '',
  activo      boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function es_usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo);
$$;

-- Crea el perfil automáticamente al crear un usuario en Auth
create or replace function crear_perfil_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre) values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_crear_perfil on auth.users;
create trigger trg_crear_perfil after insert on auth.users
  for each row execute function crear_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- DATOS DEL NEGOCIO (una sola fila; se usa en comprobantes y seguimiento)
-- ---------------------------------------------------------------------
create table if not exists negocio (
  id                 int primary key default 1 check (id = 1),
  nombre             text not null default 'GScom',
  direccion          text default '',
  telefono           text default '',
  whatsapp           text default '',
  email              text default '',
  horario            text default '',
  pie_comprobante    text default 'Los equipos no retirados dentro de los 90 días se consideran abandonados.',
  garantia_dias      int  not null default 30
);
insert into negocio (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- PRODUCTOS Y STOCK
-- ---------------------------------------------------------------------
create table if not exists categorias (
  id      bigint generated always as identity primary key,
  nombre  text not null unique
);

-- Códigos de barras internos: EAN-13 con prefijo "20" (rango reservado
-- para uso interno, nunca choca con códigos de fábrica).
create sequence if not exists codigo_interno_seq;

create or replace function generar_ean13_interno() returns text
language plpgsql as $$
declare
  base text := '20' || lpad(nextval('codigo_interno_seq')::text, 10, '0');
  suma int := 0;
  i int;
begin
  for i in 1..12 loop
    suma := suma + substr(base, i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return base || ((10 - suma % 10) % 10)::text;
end $$;

create table if not exists productos (
  id              bigint generated always as identity primary key,
  codigo_barras   text unique,
  codigo_interno  boolean not null default false,   -- true = generado por GScom
  nombre          text not null,
  descripcion     text default '',
  categoria_id    bigint references categorias(id) on delete set null,
  marca           text default '',
  precio_costo    numeric(14,2) not null default 0,
  precio_venta    numeric(14,2) not null default 0,
  stock           numeric(14,2) not null default 0,  -- lo mantiene stock_movimientos
  stock_minimo    numeric(14,2) not null default 0,
  es_servicio     boolean not null default false,    -- mano de obra, etc.: no maneja stock
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create or replace function asignar_codigo_interno() returns trigger
language plpgsql as $$
begin
  if new.codigo_barras is null or btrim(new.codigo_barras) = '' then
    new.codigo_barras := generar_ean13_interno();
    new.codigo_interno := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_codigo_interno on productos;
create trigger trg_codigo_interno before insert on productos
  for each row execute function asignar_codigo_interno();

-- Todo cambio de stock pasa por acá (venta, compra, ajuste, repuesto de service...)
create table if not exists stock_movimientos (
  id             bigint generated always as identity primary key,
  producto_id    bigint not null references productos(id),
  cantidad       numeric(14,2) not null,       -- positivo entra, negativo sale
  tipo           text not null check (tipo in ('venta','compra','ajuste','service','anulacion')),
  venta_id       bigint,
  compra_id      bigint,
  orden_id       bigint,
  nota           text default '',
  usuario_id     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);

create or replace function aplicar_stock_movimiento() returns trigger
language plpgsql as $$
begin
  update productos set stock = stock + new.cantidad
   where id = new.producto_id and not es_servicio;
  return new;
end $$;

drop trigger if exists trg_aplicar_stock on stock_movimientos;
create trigger trg_aplicar_stock after insert on stock_movimientos
  for each row execute function aplicar_stock_movimiento();

-- ---------------------------------------------------------------------
-- CLIENTES Y EQUIPOS
-- ---------------------------------------------------------------------
create table if not exists clientes (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  dni_cuit    text default '',
  telefono    text default '',
  email       text default '',
  direccion   text default '',
  notas       text default '',
  created_at  timestamptz not null default now()
);

create table if not exists equipos (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references clientes(id) on delete cascade,
  tipo        text not null default 'Notebook',
  marca       text default '',
  modelo      text default '',
  nro_serie   text default '',
  notas       text default '',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- VENTAS Y CAJA
-- ---------------------------------------------------------------------
create sequence if not exists ventas_numero_seq;
create table if not exists ventas (
  id           bigint generated always as identity primary key,
  numero       bigint not null default nextval('ventas_numero_seq'),
  fecha        timestamptz not null default now(),
  cliente_id   bigint references clientes(id) on delete set null,
  subtotal     numeric(14,2) not null default 0,
  descuento    numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  forma_pago   text not null default 'Efectivo',
  notas        text default '',
  anulada      boolean not null default false,
  usuario_id   uuid default auth.uid()
);

create table if not exists venta_items (
  id               bigint generated always as identity primary key,
  venta_id         bigint not null references ventas(id) on delete cascade,
  producto_id      bigint references productos(id),
  descripcion      text not null,
  cantidad         numeric(14,2) not null,
  precio_unitario  numeric(14,2) not null,
  subtotal         numeric(14,2) not null
);

create table if not exists caja_movimientos (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  tipo        text not null check (tipo in ('ingreso','egreso')),
  concepto    text not null,
  monto       numeric(14,2) not null check (monto >= 0),
  forma_pago  text not null default 'Efectivo',
  venta_id    bigint references ventas(id) on delete set null,
  orden_id    bigint,
  usuario_id  uuid default auth.uid()
);

create table if not exists caja_cierres (
  id                 bigint generated always as identity primary key,
  fecha              timestamptz not null default now(),
  efectivo_esperado  numeric(14,2) not null,
  efectivo_contado   numeric(14,2) not null,
  diferencia         numeric(14,2) not null,
  notas              text default '',
  usuario_id         uuid default auth.uid()
);

-- ---------------------------------------------------------------------
-- PROVEEDORES Y COMPRAS (ingreso de mercadería)
-- ---------------------------------------------------------------------
create table if not exists proveedores (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  cuit        text default '',
  telefono    text default '',
  email       text default '',
  notas       text default ''
);

create table if not exists compras (
  id                bigint generated always as identity primary key,
  fecha             timestamptz not null default now(),
  proveedor_id      bigint references proveedores(id) on delete set null,
  nro_comprobante   text default '',
  total             numeric(14,2) not null default 0,
  notas             text default '',
  usuario_id        uuid default auth.uid()
);

create table if not exists compra_items (
  id               bigint generated always as identity primary key,
  compra_id        bigint not null references compras(id) on delete cascade,
  producto_id      bigint not null references productos(id),
  cantidad         numeric(14,2) not null,
  costo_unitario   numeric(14,2) not null
);

-- ---------------------------------------------------------------------
-- SERVICE TÉCNICO
-- ---------------------------------------------------------------------
create sequence if not exists ordenes_numero_seq;
create table if not exists ordenes_servicio (
  id                   bigint generated always as identity primary key,
  numero               bigint not null default nextval('ordenes_numero_seq'),
  token                uuid not null unique default gen_random_uuid(),  -- link de seguimiento
  cliente_id           bigint not null references clientes(id),
  equipo_id            bigint references equipos(id) on delete set null,
  falla_reportada      text not null,
  accesorios           text default '',
  contrasena_equipo    text default '',
  diagnostico          text default '',
  trabajo_realizado    text default '',
  presupuesto          numeric(14,2),
  presupuesto_aprobado boolean,
  estado               text not null default 'recibido'
                         check (estado in ('recibido','diagnostico','presupuesto','reparacion','repuesto','listo','entregado','sin_reparacion')),
  tecnico              text default '',
  fecha_ingreso        timestamptz not null default now(),
  fecha_estimada       date,
  fecha_entrega        timestamptz,
  total_cobrado        numeric(14,2),
  notas_internas       text default '',
  usuario_id           uuid default auth.uid()
);

-- Repuestos y mano de obra de cada orden
create table if not exists orden_items (
  id               bigint generated always as identity primary key,
  orden_id         bigint not null references ordenes_servicio(id) on delete cascade,
  producto_id      bigint references productos(id),
  descripcion      text not null,
  cantidad         numeric(14,2) not null default 1,
  precio_unitario  numeric(14,2) not null default 0
);

-- Historial de estados: es lo que ve el cliente en la página de seguimiento
create table if not exists orden_estados (
  id          bigint generated always as identity primary key,
  orden_id    bigint not null references ordenes_servicio(id) on delete cascade,
  estado      text not null,
  comentario  text default '',          -- visible para el cliente
  created_at  timestamptz not null default now(),
  usuario_id  uuid default auth.uid()
);

create or replace function registrar_cambio_estado() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into orden_estados (orden_id, estado, comentario)
    values (new.id, new.estado, coalesce(current_setting('gscom.comentario_estado', true), ''));
    if new.estado = 'entregado' and new.fecha_entrega is null then
      update ordenes_servicio set fecha_entrega = now() where id = new.id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_cambio_estado on ordenes_servicio;
create trigger trg_cambio_estado after insert or update of estado on ordenes_servicio
  for each row execute function registrar_cambio_estado();

-- Cambiar estado con comentario para el cliente, en una sola llamada
create or replace function cambiar_estado_orden(p_orden_id bigint, p_estado text, p_comentario text default '')
returns void language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if exists (select 1 from ordenes_servicio where id = p_orden_id and estado = p_estado) then
    -- mismo estado: solo se agrega la novedad (si hay mensaje) al historial
    if coalesce(p_comentario, '') <> '' then
      insert into orden_estados (orden_id, estado, comentario) values (p_orden_id, p_estado, p_comentario);
    end if;
    return;
  end if;
  perform set_config('gscom.comentario_estado', coalesce(p_comentario, ''), true);
  update ordenes_servicio set estado = p_estado where id = p_orden_id;
  perform set_config('gscom.comentario_estado', '', true);
end $$;

-- ---------------------------------------------------------------------
-- OPERACIONES ATÓMICAS (todo o nada)
-- ---------------------------------------------------------------------

-- Registrar venta: venta + ítems + descuento de stock + ingreso en caja
-- p_items: [{"producto_id": 1, "descripcion": "...", "cantidad": 1, "precio_unitario": 100}]
create or replace function registrar_venta(
  p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default ''
) returns bigint language plpgsql as $$
declare
  v_id bigint; v_subtotal numeric := 0; it jsonb;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;

  insert into ventas (cliente_id, subtotal, descuento, total, forma_pago, notas)
  values (p_cliente_id, v_subtotal, coalesce(p_descuento,0), v_subtotal - coalesce(p_descuento,0), p_forma_pago, coalesce(p_notas,''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_id, nullif(it->>'producto_id','')::bigint, it->>'descripcion', (it->>'cantidad')::numeric,
            (it->>'precio_unitario')::numeric, (it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric);
    if nullif(it->>'producto_id','') is not null then
      insert into stock_movimientos (producto_id, cantidad, tipo, venta_id)
      values ((it->>'producto_id')::bigint, -(it->>'cantidad')::numeric, 'venta', v_id);
    end if;
  end loop;

  insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
  select 'ingreso', 'Venta #' || numero, total, forma_pago, id from ventas where id = v_id;

  return v_id;
end $$;

-- Anular venta: devuelve stock y registra egreso en caja
create or replace function anular_venta(p_venta_id bigint) returns void
language plpgsql as $$
declare v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if v.anulada then raise exception 'La venta ya estaba anulada'; end if;
  update ventas set anulada = true where id = p_venta_id;
  insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
  select producto_id, cantidad, 'anulacion', p_venta_id, 'Anulación venta #' || v.numero
    from venta_items where venta_id = p_venta_id and producto_id is not null;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
  values ('egreso', 'Anulación venta #' || v.numero, v.total, v.forma_pago, p_venta_id);
end $$;

-- Registrar compra: compra + ítems + suma de stock + actualiza costo
create or replace function registrar_compra(
  p_proveedor_id bigint, p_nro_comprobante text, p_items jsonb, p_notas text default ''
) returns bigint language plpgsql as $$
declare v_id bigint; it jsonb;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  insert into compras (proveedor_id, nro_comprobante, notas, total)
  values (p_proveedor_id, coalesce(p_nro_comprobante,''), coalesce(p_notas,''),
          (select coalesce(sum((x->>'cantidad')::numeric * (x->>'costo_unitario')::numeric),0) from jsonb_array_elements(p_items) x))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into compra_items (compra_id, producto_id, cantidad, costo_unitario)
    values (v_id, (it->>'producto_id')::bigint, (it->>'cantidad')::numeric, (it->>'costo_unitario')::numeric);
    insert into stock_movimientos (producto_id, cantidad, tipo, compra_id)
    values ((it->>'producto_id')::bigint, (it->>'cantidad')::numeric, 'compra', v_id);
    update productos set precio_costo = (it->>'costo_unitario')::numeric where id = (it->>'producto_id')::bigint;
  end loop;
  return v_id;
end $$;

-- Entregar orden de service: cobra, descuenta repuestos del stock y pasa a "entregado"
create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '')
returns void language plpgsql as $$
declare o ordenes_servicio;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada'; end if;
  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, -cantidad, 'service', p_orden_id, 'Orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;
  if coalesce(p_total,0) > 0 then
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
    values ('ingreso', 'Service orden #' || o.numero, p_total, p_forma_pago, p_orden_id);
  end if;
  update ordenes_servicio set total_cobrado = p_total where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- ---------------------------------------------------------------------
-- SEGUIMIENTO PÚBLICO (lo único accesible sin login)
-- Devuelve solo lo necesario de UNA orden, buscada por su token secreto.
-- ---------------------------------------------------------------------
create or replace function seguimiento_orden(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero',          o.numero,
    'cliente',         split_part(c.nombre, ' ', 1),
    'equipo',          btrim(coalesce(e.tipo,'') || ' ' || coalesce(e.marca,'') || ' ' || coalesce(e.modelo,'')),
    'falla',           o.falla_reportada,
    'estado',          o.estado,
    'fecha_ingreso',   o.fecha_ingreso,
    'fecha_estimada',  o.fecha_estimada,
    'fecha_entrega',   o.fecha_entrega,
    'presupuesto',     o.presupuesto,
    'historial',       (select coalesce(jsonb_agg(jsonb_build_object('estado', h.estado, 'comentario', h.comentario, 'fecha', h.created_at) order by h.created_at), '[]'::jsonb)
                          from orden_estados h where h.orden_id = o.id),
    'negocio',         (select jsonb_build_object('nombre', n.nombre, 'telefono', n.telefono, 'whatsapp', n.whatsapp, 'direccion', n.direccion, 'horario', n.horario) from negocio n where n.id = 1)
  )
  from ordenes_servicio o
  join clientes c on c.id = o.cliente_id
  left join equipos e on e.id = o.equipo_id
  where o.token = p_token;
$$;

revoke all on function seguimiento_orden(uuid) from public;
grant execute on function seguimiento_orden(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- SEGURIDAD (RLS): solo usuarios activos acceden a las tablas.
-- El público (anon) no puede leer ni escribir NINGUNA tabla directo.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['negocio','categorias','productos','stock_movimientos','clientes','equipos',
                           'ventas','venta_items','caja_movimientos','caja_cierres','proveedores',
                           'compras','compra_items','ordenes_servicio','orden_items','orden_estados']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "usuarios activos" on %I', t);
    execute format('create policy "usuarios activos" on %I for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo())', t);
  end loop;
end $$;

alter table perfiles enable row level security;
drop policy if exists "ver perfiles" on perfiles;
create policy "ver perfiles" on perfiles for select to authenticated using (es_usuario_activo() or id = auth.uid());
-- (activar/desactivar usuarios se hace desde el SQL Editor o el Table Editor de Supabase)

-- Índices útiles
create index if not exists idx_productos_nombre on productos using gin (to_tsvector('spanish', nombre));
create index if not exists idx_equipos_cliente on equipos(cliente_id);
create index if not exists idx_ventas_cliente on ventas(cliente_id);
create index if not exists idx_ventas_fecha on ventas(fecha);
create index if not exists idx_ordenes_cliente on ordenes_servicio(cliente_id);
create index if not exists idx_ordenes_estado on ordenes_servicio(estado);
create index if not exists idx_caja_fecha on caja_movimientos(fecha);
create index if not exists idx_stock_mov_producto on stock_movimientos(producto_id);
