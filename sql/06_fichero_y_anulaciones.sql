-- =====================================================================
-- GScom — Fichero (cuentas corrientes de clientes) y anulación de
-- movimientos de caja.
-- =====================================================================

-- ---------- Cuentas corrientes ----------
-- monto con signo: positivo = el cliente debe más (cargo), negativo = pagó / se le descontó
create table if not exists cc_movimientos (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references clientes(id),
  fecha       timestamptz not null default now(),
  tipo        text not null check (tipo in ('cargo','pago','ajuste')),
  monto       numeric(14,2) not null,
  concepto    text not null default '',
  forma_pago  text default '',
  venta_id    bigint references ventas(id) on delete set null,
  orden_id    bigint references ordenes_servicio(id) on delete set null,
  anulado     boolean not null default false,
  usuario_id  uuid default auth.uid()
);
create index if not exists idx_cc_cliente on cc_movimientos(cliente_id);

alter table caja_movimientos add column if not exists cc_movimiento_id bigint references cc_movimientos(id) on delete set null;

alter table cc_movimientos enable row level security;
drop policy if exists "usuarios activos" on cc_movimientos;
create policy "usuarios activos" on cc_movimientos for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- Saldo por cliente (solo los que tienen movimientos)
create or replace view cc_saldos with (security_invoker = true) as
select c.id as cliente_id, c.nombre, c.telefono,
       sum(m.monto) as saldo,
       min(m.fecha) filter (where m.tipo = 'cargo' and not m.anulado) as deuda_desde,
       max(m.fecha) as ultimo_movimiento
  from cc_movimientos m join clientes c on c.id = m.cliente_id
 group by c.id, c.nombre, c.telefono;

-- ---------- Ventas: forma de pago "Cuenta corriente" ----------
create or replace function registrar_venta(
  p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default ''
) returns bigint language plpgsql as $$
declare
  v_id bigint; v_subtotal numeric := 0; it jsonb; v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;
  if p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then raise exception 'Para vender a cuenta corriente hay que elegir el cliente'; end if;

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

  select * into v from ventas where id = v_id;
  if p_forma_pago = 'Cuenta corriente' then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
    values (p_cliente_id, 'cargo', v.total, 'Venta #' || v.numero, v_id);
  else
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
    values ('ingreso', 'Venta #' || v.numero, v.total, v.forma_pago, v_id);
  end if;
  return v_id;
end $$;

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
  if v.forma_pago = 'Cuenta corriente' then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
    values (v.cliente_id, 'ajuste', -v.total, 'Anulación venta #' || v.numero, p_venta_id);
  else
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
    values ('egreso', 'Anulación venta #' || v.numero, v.total, v.forma_pago, p_venta_id);
  end if;
end $$;

-- ---------- Service: entrega a cuenta corriente y anulación de la entrega ----------
alter table ordenes_servicio add column if not exists forma_pago_entrega text default '';

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
    if p_forma_pago = 'Cuenta corriente' then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'cargo', p_total, 'Service orden #' || o.numero, p_orden_id);
    else
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('ingreso', 'Service orden #' || o.numero, p_total, p_forma_pago, p_orden_id);
    end if;
  end if;
  update ordenes_servicio set total_cobrado = p_total, forma_pago_entrega = coalesce(p_forma_pago,'') where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- Deshace una entrega: devuelve repuestos al stock, revierte el cobro y la orden vuelve a "Listo para retirar"
create or replace function anular_entrega_orden(p_orden_id bigint) returns void
language plpgsql as $$
declare o ordenes_servicio;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado <> 'entregado' then raise exception 'La orden no está entregada'; end if;
  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, cantidad, 'anulacion', p_orden_id, 'Anulación entrega orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;
  if coalesce(o.total_cobrado,0) > 0 then
    if o.forma_pago_entrega = 'Cuenta corriente' then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'ajuste', -o.total_cobrado, 'Anulación entrega orden #' || o.numero, p_orden_id);
    else
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('egreso', 'Anulación cobro service orden #' || o.numero, o.total_cobrado,
              coalesce(nullif(o.forma_pago_entrega,''), (select forma_pago from caja_movimientos where orden_id = p_orden_id and tipo = 'ingreso' order by id desc limit 1), 'Efectivo'),
              p_orden_id);
    end if;
  end if;
  update ordenes_servicio set total_cobrado = null, fecha_entrega = null, forma_pago_entrega = '' where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'listo', 'Se anuló la entrega registrada por error.');
end $$;

-- ---------- Cobros de cuenta corriente ----------
create or replace function cobrar_cuenta(p_cliente_id bigint, p_monto numeric, p_forma_pago text, p_nota text default '')
returns bigint language plpgsql as $$
declare v_cc bigint; v_nombre text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto a cobrar tiene que ser mayor a cero'; end if;
  if p_forma_pago = 'Cuenta corriente' then raise exception 'Elegí cómo paga (efectivo, transferencia, etc.)'; end if;
  select nombre into v_nombre from clientes where id = p_cliente_id;
  insert into cc_movimientos (cliente_id, tipo, monto, concepto, forma_pago)
  values (p_cliente_id, 'pago', -p_monto, coalesce(nullif(p_nota,''), 'Cobro de cuenta corriente'), p_forma_pago)
  returning id into v_cc;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, cc_movimiento_id)
  values ('ingreso', 'Cobro cta. cte. — ' || v_nombre, p_monto, p_forma_pago, v_cc);
  return v_cc;
end $$;

create or replace function anular_cobro_cuenta(p_cc_id bigint) returns void
language plpgsql as $$
declare m cc_movimientos; v_nombre text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into m from cc_movimientos where id = p_cc_id for update;
  if m.tipo <> 'pago' then raise exception 'Solo se pueden anular cobros'; end if;
  if m.anulado then raise exception 'El cobro ya estaba anulado'; end if;
  select nombre into v_nombre from clientes where id = m.cliente_id;
  update cc_movimientos set anulado = true where id = p_cc_id;
  insert into cc_movimientos (cliente_id, tipo, monto, concepto)
  values (m.cliente_id, 'ajuste', -m.monto, 'Anulación de cobro del ' || to_char(m.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY'));
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, cc_movimiento_id)
  values ('egreso', 'Anulación cobro cta. cte. — ' || v_nombre, -m.monto, m.forma_pago, p_cc_id);
end $$;

-- ---------- Movimientos manuales de caja: se pueden eliminar ----------
create or replace function eliminar_movimiento_caja(p_id bigint) returns void
language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if exists (select 1 from caja_movimientos where id = p_id and (venta_id is not null or orden_id is not null or cc_movimiento_id is not null)) then
    raise exception 'Este movimiento viene de una venta, un service o un cobro: anulalo desde su origen';
  end if;
  delete from caja_movimientos where id = p_id;
end $$;

-- ---------- Proveedores: al eliminar, las compras quedan sin proveedor ----------
alter table compras drop constraint if exists compras_proveedor_id_fkey;
alter table compras add constraint compras_proveedor_id_fkey foreign key (proveedor_id) references proveedores(id) on delete set null;

-- Permisos: solo usuarios logueados
do $$
declare f text;
begin
  foreach f in array array['registrar_venta(bigint, jsonb, numeric, text, text)', 'anular_venta(bigint)',
    'entregar_orden(bigint, numeric, text, text)', 'anular_entrega_orden(bigint)',
    'cobrar_cuenta(bigint, numeric, text, text)', 'anular_cobro_cuenta(bigint)', 'eliminar_movimiento_caja(bigint)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on cc_saldos from anon;
