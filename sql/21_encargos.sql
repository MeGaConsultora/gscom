-- =====================================================================
-- GScom — Encargos de clientes
-- Algo que un cliente (o alguien que todavía no es cliente) nos pide y hay
-- que conseguir. Cada encargo se agrega a un pedido pendiente al proveedor.
-- Ciclo: pendiente (a pedir) → pedido → recibido (llegó) → entregado | cancelado
-- El estado se sincroniza solo con el del pedido.
-- =====================================================================

create sequence if not exists encargos_numero_seq;

create table if not exists encargos (
  id            bigint generated always as identity primary key,
  numero        bigint not null default nextval('encargos_numero_seq'),
  fecha         timestamptz not null default now(),
  cliente_id    bigint references clientes(id) on delete set null,
  contacto      text not null default '',       -- nombre si no es cliente
  telefono      text not null default '',
  producto_id   bigint references productos(id) on delete set null,
  descripcion   text not null,
  cantidad      numeric(14,2) not null default 1 check (cantidad > 0),
  precio        numeric(14,2),                  -- precio acordado con el cliente (opcional)
  proveedor_id  bigint references proveedores(id) on delete set null,
  pedido_id     bigint references pedidos(id) on delete set null,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'pedido', 'recibido', 'entregado', 'cancelado')),
  fecha_aviso   timestamptz,                    -- cuándo se avisó al cliente que llegó
  fecha_entrega timestamptz,
  notas         text not null default '',
  usuario_id    uuid default auth.uid()
);
create index if not exists idx_encargos_estado on encargos(estado);
create index if not exists idx_encargos_pedido on encargos(pedido_id);

alter table pedido_items add column if not exists encargo_id bigint references encargos(id) on delete set null;

alter table encargos enable row level security;
drop policy if exists "usuarios activos" on encargos;
create policy "usuarios activos" on encargos for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- Agregar un encargo al pedido pendiente de su proveedor (o crear uno nuevo). Devuelve el id del pedido.
create or replace function encargar(p_encargo_id bigint, p_proveedor_id bigint) returns bigint
language plpgsql as $$
declare e encargos; v_pedido bigint; v_codigo text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into e from encargos where id = p_encargo_id for update;
  if not found then raise exception 'Encargo no encontrado'; end if;
  if e.estado not in ('pendiente') then raise exception 'El encargo ya fue pedido'; end if;

  select id into v_pedido from pedidos
   where estado = 'pendiente' and proveedor_id is not distinct from p_proveedor_id
   order by fecha desc limit 1;
  if v_pedido is null then
    insert into pedidos (proveedor_id) values (p_proveedor_id) returning id into v_pedido;
  end if;

  select coalesce(codigo_barras, '') into v_codigo from productos where id = e.producto_id;
  insert into pedido_items (pedido_id, producto_id, descripcion, codigo, cantidad, encargo_id)
  values (v_pedido, e.producto_id, e.descripcion, coalesce(v_codigo, ''), e.cantidad, e.id);
  update encargos set estado = 'pedido', pedido_id = v_pedido, proveedor_id = p_proveedor_id where id = e.id;
  return v_pedido;
end $$;

-- Cuando cambia el estado de un pedido, sus encargos acompañan
create or replace function sincronizar_encargos_pedido() returns trigger
language plpgsql as $$
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'recibido' then
      update encargos set estado = 'recibido' where pedido_id = new.id and estado = 'pedido';
    elsif new.estado = 'cancelado' then
      update encargos set estado = 'pendiente', pedido_id = null where pedido_id = new.id and estado = 'pedido';
      update pedido_items set encargo_id = null where pedido_id = new.id;
    elsif new.estado = 'pendiente' then
      update encargos set estado = 'pedido' where pedido_id = new.id and estado = 'recibido';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_encargos_pedido on pedidos;
create trigger trg_encargos_pedido after update of estado on pedidos
  for each row execute function sincronizar_encargos_pedido();

-- Editar ítems de un pedido pendiente: ahora conserva a qué encargo pertenece cada ítem,
-- y si un encargo se quitó del pedido, vuelve a "a pedir".
create or replace function actualizar_items_pedido(p_pedido_id bigint, p_items jsonb)
returns void language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if (select estado from pedidos where id = p_pedido_id) <> 'pendiente' then raise exception 'Solo se puede modificar un pedido pendiente'; end if;
  delete from pedido_items where pedido_id = p_pedido_id;
  insert into pedido_items (pedido_id, producto_id, descripcion, codigo, cantidad, encargo_id)
  select p_pedido_id, nullif(x->>'producto_id', '')::bigint, x->>'descripcion', coalesce(x->>'codigo', ''), (x->>'cantidad')::numeric,
         nullif(x->>'encargo_id', '')::bigint
    from jsonb_array_elements(p_items) x where (x->>'cantidad')::numeric > 0;
  update encargos set estado = 'pendiente', pedido_id = null
   where pedido_id = p_pedido_id and estado = 'pedido'
     and id not in (select encargo_id from pedido_items where pedido_id = p_pedido_id and encargo_id is not null);
end $$;

revoke execute on function encargar(bigint, bigint) from public, anon;
grant  execute on function encargar(bigint, bigint) to authenticated;
revoke execute on function actualizar_items_pedido(bigint, jsonb) from public, anon;
grant  execute on function actualizar_items_pedido(bigint, jsonb) to authenticated;
revoke execute on function sincronizar_encargos_pedido() from public, anon;

-- Cancelar un encargo: si está en un pedido todavía pendiente, se lo quita de ese pedido
create or replace function cancelar_encargo(p_encargo_id bigint) returns void
language plpgsql as $$
declare e encargos;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into e from encargos where id = p_encargo_id for update;
  if e.estado in ('entregado', 'cancelado') then raise exception 'El encargo ya está %', e.estado; end if;
  if e.pedido_id is not null and (select estado from pedidos where id = e.pedido_id) = 'pendiente' then
    delete from pedido_items where encargo_id = e.id and pedido_id = e.pedido_id;
  end if;
  update encargos set estado = 'cancelado' where id = e.id;
end $$;

revoke execute on function cancelar_encargo(bigint) from public, anon;
grant  execute on function cancelar_encargo(bigint) to authenticated;
