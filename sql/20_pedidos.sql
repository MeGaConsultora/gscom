-- =====================================================================
-- GScom — Pedidos de mercadería a proveedores
-- Ciclo: pendiente → recibido (o cancelado). NO toca el stock: la
-- mercadería se sigue ingresando por Compras → Ingresar mercadería.
-- =====================================================================

create sequence if not exists pedidos_numero_seq;

create table if not exists pedidos (
  id              bigint generated always as identity primary key,
  numero          bigint not null default nextval('pedidos_numero_seq'),
  proveedor_id    bigint references proveedores(id) on delete set null,
  fecha           timestamptz not null default now(),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'recibido', 'cancelado')),
  fecha_recibido  timestamptz,
  notas           text not null default '',
  usuario_id      uuid default auth.uid()
);

create table if not exists pedido_items (
  id           bigint generated always as identity primary key,
  pedido_id    bigint not null references pedidos(id) on delete cascade,
  producto_id  bigint references productos(id) on delete set null,   -- si el producto se borra, el pedido conserva la descripción
  descripcion  text not null,
  codigo       text not null default '',
  cantidad     numeric(14,2) not null check (cantidad > 0)
);
create index if not exists idx_pedido_items_pedido on pedido_items(pedido_id);
create index if not exists idx_pedidos_estado on pedidos(estado);

alter table pedidos enable row level security;
alter table pedido_items enable row level security;
drop policy if exists "usuarios activos" on pedidos;
drop policy if exists "usuarios activos" on pedido_items;
create policy "usuarios activos" on pedidos      for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());
create policy "usuarios activos" on pedido_items for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- Crear un pedido con sus ítems en una sola operación
-- p_items: [{"producto_id": 1, "descripcion": "...", "codigo": "...", "cantidad": 2}]
create or replace function crear_pedido(p_proveedor_id bigint, p_items jsonb, p_notas text default '')
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'El pedido no tiene productos'; end if;
  insert into pedidos (proveedor_id, notas) values (p_proveedor_id, coalesce(p_notas, '')) returning id into v_id;
  insert into pedido_items (pedido_id, producto_id, descripcion, codigo, cantidad)
  select v_id, nullif(x->>'producto_id', '')::bigint, x->>'descripcion', coalesce(x->>'codigo', ''), (x->>'cantidad')::numeric
    from jsonb_array_elements(p_items) x where (x->>'cantidad')::numeric > 0;
  return v_id;
end $$;

-- Reemplazar los ítems de un pedido pendiente
create or replace function actualizar_items_pedido(p_pedido_id bigint, p_items jsonb)
returns void language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if (select estado from pedidos where id = p_pedido_id) <> 'pendiente' then raise exception 'Solo se puede modificar un pedido pendiente'; end if;
  delete from pedido_items where pedido_id = p_pedido_id;
  insert into pedido_items (pedido_id, producto_id, descripcion, codigo, cantidad)
  select p_pedido_id, nullif(x->>'producto_id', '')::bigint, x->>'descripcion', coalesce(x->>'codigo', ''), (x->>'cantidad')::numeric
    from jsonb_array_elements(p_items) x where (x->>'cantidad')::numeric > 0;
end $$;

revoke execute on function crear_pedido(bigint, jsonb, text) from public, anon;
revoke execute on function actualizar_items_pedido(bigint, jsonb) from public, anon;
grant  execute on function crear_pedido(bigint, jsonb, text) to authenticated;
grant  execute on function actualizar_items_pedido(bigint, jsonb) to authenticated;
