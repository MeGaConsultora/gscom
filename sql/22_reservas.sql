-- =====================================================================
-- GScom — Reservas de stock (dentro de Encargos)
-- Un encargo puede ser:
--   · tipo 'encargo': hay que pedirlo al proveedor (flujo de siempre)
--   · tipo 'reserva': lo tenemos en stock y se aparta para el cliente
-- La reserva NO toca el stock físico: la app descuenta lo reservado del
-- stock DISPONIBLE. Al venderlo (entregar) baja el stock con la venta.
-- Si se pide más de lo que hay, se crean una reserva y un encargo con el
-- mismo "solicitud" para mostrarlos vinculados.
-- =====================================================================

alter table encargos add column if not exists tipo text not null default 'encargo';
alter table encargos add column if not exists reservado_hasta date;
alter table encargos add column if not exists solicitud uuid;

alter table encargos drop constraint if exists encargos_tipo_check;
alter table encargos add constraint encargos_tipo_check check (tipo in ('encargo', 'reserva'));

alter table encargos drop constraint if exists encargos_estado_check;
alter table encargos add constraint encargos_estado_check
  check (estado in ('pendiente', 'pedido', 'recibido', 'reservado', 'entregado', 'cancelado'));

create index if not exists idx_encargos_solicitud on encargos(solicitud);
create index if not exists idx_encargos_producto_reservado on encargos(producto_id) where estado = 'reservado';

-- Una reserva no puede ir a un pedido
create or replace function encargar(p_encargo_id bigint, p_proveedor_id bigint) returns bigint
language plpgsql as $$
declare e encargos; v_pedido bigint; v_codigo text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into e from encargos where id = p_encargo_id for update;
  if not found then raise exception 'Encargo no encontrado'; end if;
  if e.tipo = 'reserva' then raise exception 'Una reserva de stock no se pide al proveedor'; end if;
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

revoke execute on function encargar(bigint, bigint) from public, anon;
grant  execute on function encargar(bigint, bigint) to authenticated;
