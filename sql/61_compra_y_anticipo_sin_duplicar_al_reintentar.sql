-- =====================================================================
-- GScom — Compras y anticipos reintentados no se registran dos veces
-- Si se corta la conexión justo al guardar, la operación puede quedar registrada sin
-- que la pantalla se entere; al volver a tocar el botón se duplicaba (en una compra,
-- también el stock). Ahora cada intento lleva una clave: con la misma clave, la base
-- devuelve lo que ya existe en lugar de crearlo de nuevo. Lo viejo queda sin clave.
-- =====================================================================
alter table compras add column if not exists clave uuid;
create unique index if not exists idx_compras_clave on compras(clave) where clave is not null;
alter table cc_movimientos add column if not exists clave uuid;
create unique index if not exists idx_cc_movimientos_clave on cc_movimientos(clave) where clave is not null;

-- ---------------------------------------------------------------------
drop function if exists registrar_compra(bigint, text, jsonb, text);
create or replace function registrar_compra(
  p_proveedor_id bigint, p_nro_comprobante text, p_items jsonb, p_notas text default '', p_clave uuid default null
) returns bigint language plpgsql as $$
declare v_id bigint; it jsonb;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- La misma compra reintentada (misma clave): no se registra de nuevo, se devuelve la que ya está
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
    select id into v_id from compras where clave = p_clave;
    if found then return v_id; end if;
  end if;
  insert into compras (clave, proveedor_id, nro_comprobante, notas, total)
  values (p_clave, p_proveedor_id, coalesce(p_nro_comprobante,''), coalesce(p_notas,''),
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

-- ---------------------------------------------------------------------
drop function if exists registrar_anticipo_orden(bigint, numeric, text, text);
create or replace function registrar_anticipo_orden(p_orden_id bigint, p_monto numeric, p_forma_pago text, p_nota text default '', p_clave uuid default null)
returns bigint language plpgsql as $$
declare o ordenes_servicio; v_cc bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- El mismo anticipo reintentado (misma clave): no se registra de nuevo
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
    select id into v_cc from cc_movimientos where clave = p_clave;
    if found then return v_cc; end if;
  end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto del anticipo tiene que ser mayor a cero'; end if;
  if p_forma_pago = 'Cuenta corriente' then raise exception 'Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada: registrá el pago desde el Fichero del cliente'; end if;

  insert into cc_movimientos (clave, cliente_id, tipo, monto, concepto, forma_pago, orden_id)
  values (p_clave, o.cliente_id, 'pago', -p_monto, coalesce(nullif(p_nota,''), 'Anticipo orden #' || o.numero), p_forma_pago, p_orden_id)
  returning id into v_cc;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id, cc_movimiento_id)
  values ('ingreso', 'Anticipo orden #' || o.numero, p_monto, p_forma_pago, p_orden_id, v_cc);
  return v_cc;
end $$;

-- ---------------------------------------------------------------------
drop function if exists registrar_anticipo_encargo(bigint, numeric, text, text);
create or replace function registrar_anticipo_encargo(p_encargo_id bigint, p_monto numeric, p_forma_pago text, p_nota text default '', p_clave uuid default null)
returns bigint language plpgsql as $$
declare enc encargos; v_cc bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- El mismo anticipo reintentado (misma clave): no se registra de nuevo
  if p_clave is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_clave::text, 0));
    select id into v_cc from cc_movimientos where clave = p_clave;
    if found then return v_cc; end if;
  end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto del anticipo tiene que ser mayor a cero'; end if;
  if p_forma_pago = 'Cuenta corriente' then raise exception 'Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)'; end if;
  select * into enc from encargos where id = p_encargo_id for update;
  if not found then raise exception 'Encargo no encontrado'; end if;
  if enc.estado in ('entregado', 'cancelado') then raise exception 'Ese % ya está %', case when enc.tipo = 'reserva' then 'reserva' else 'encargo' end, enc.estado; end if;
  if enc.cliente_id is null then raise exception 'Este % no tiene un cliente cargado (es a nombre de alguien que todavía no es cliente): no se le puede registrar un anticipo', case when enc.tipo = 'reserva' then 'reserva' else 'encargo' end; end if;

  insert into cc_movimientos (clave, cliente_id, tipo, monto, concepto, forma_pago, encargo_id)
  values (p_clave, enc.cliente_id, 'pago', -p_monto, coalesce(nullif(p_nota,''), (case when enc.tipo = 'reserva' then 'Anticipo reserva N° ' else 'Anticipo encargo N° ' end) || enc.numero), p_forma_pago, p_encargo_id)
  returning id into v_cc;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, encargo_id, cc_movimiento_id)
  values ('ingreso', (case when enc.tipo = 'reserva' then 'Anticipo reserva N° ' else 'Anticipo encargo N° ' end) || enc.numero, p_monto, p_forma_pago, p_encargo_id, v_cc);
  return v_cc;
end $$;

revoke execute on function registrar_compra(bigint, text, jsonb, text, uuid) from public, anon;
revoke execute on function registrar_anticipo_orden(bigint, numeric, text, text, uuid) from public, anon;
revoke execute on function registrar_anticipo_encargo(bigint, numeric, text, text, uuid) from public, anon;
grant  execute on function registrar_compra(bigint, text, jsonb, text, uuid) to authenticated;
grant  execute on function registrar_anticipo_orden(bigint, numeric, text, text, uuid) to authenticated;
grant  execute on function registrar_anticipo_encargo(bigint, numeric, text, text, uuid) to authenticated;
notify pgrst, 'reload schema';
