-- =====================================================================
-- GScom — Anticipos (pago a cuenta) en órdenes de service.
-- Se cobra un anticipo mientras el equipo todavía está en el taller
-- (por ejemplo, al confirmar el presupuesto). Impacta caja al momento
-- y la cuenta corriente del cliente (Fichero) como un pago a favor,
-- que se cancela solo contra el total cuando se entrega el equipo.
-- =====================================================================

-- ---------- Registrar un anticipo ----------
create or replace function registrar_anticipo_orden(p_orden_id bigint, p_monto numeric, p_forma_pago text, p_nota text default '')
returns bigint language plpgsql as $$
declare o ordenes_servicio; v_cc bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto del anticipo tiene que ser mayor a cero'; end if;
  if p_forma_pago = 'Cuenta corriente' then raise exception 'Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada: registrá el pago desde el Fichero del cliente'; end if;

  insert into cc_movimientos (cliente_id, tipo, monto, concepto, forma_pago, orden_id)
  values (o.cliente_id, 'pago', -p_monto, coalesce(nullif(p_nota,''), 'Anticipo orden #' || o.numero), p_forma_pago, p_orden_id)
  returning id into v_cc;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id, cc_movimiento_id)
  values ('ingreso', 'Anticipo orden #' || o.numero, p_monto, p_forma_pago, p_orden_id, v_cc);
  return v_cc;
end $$;

-- ---------- Anular un cobro/anticipo de cuenta corriente ----------
-- (agrega el resguardo: si el anticipo es de una orden ya entregada, hay que
-- anular la entrega primero, porque el cobro final ya descontó ese anticipo)
create or replace function anular_cobro_cuenta(p_cc_id bigint) returns void
language plpgsql as $$
declare m cc_movimientos; v_nombre text; v_estado text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into m from cc_movimientos where id = p_cc_id for update;
  if m.tipo <> 'pago' then raise exception 'Solo se pueden anular cobros'; end if;
  if m.anulado then raise exception 'El cobro ya estaba anulado'; end if;
  if m.orden_id is not null then
    select estado into v_estado from ordenes_servicio where id = m.orden_id;
    if v_estado = 'entregado' then raise exception 'Esa orden ya fue entregada: anulá la entrega primero'; end if;
  end if;
  select nombre into v_nombre from clientes where id = m.cliente_id;
  update cc_movimientos set anulado = true where id = p_cc_id;
  insert into cc_movimientos (cliente_id, tipo, monto, concepto)
  values (m.cliente_id, 'ajuste', -m.monto, 'Anulación de cobro del ' || to_char(m.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY'));
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, cc_movimiento_id)
  values ('egreso', 'Anulación cobro cta. cte. — ' || v_nombre, -m.monto, m.forma_pago, p_cc_id);
end $$;

-- ---------- Entregar orden: el cobro final descuenta los anticipos ya pagados ----------
create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '')
returns void language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada'; end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, -cantidad, 'service', p_orden_id, 'Orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(p_total,0) - v_anticipos, 0);

  -- Cancela contablemente los anticipos ya cobrados (quedan "aplicados" a esta orden)
  if v_anticipos > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_anticipos, 'Service orden #' || o.numero || ' (aplica anticipo)', p_orden_id);
  end if;

  if p_forma_pago = 'Cuenta corriente' then
    if v_restante > 0 then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'cargo', v_restante, 'Service orden #' || o.numero, p_orden_id);
    end if;
  else
    if v_restante > 0 then
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('ingreso', 'Service orden #' || o.numero, v_restante, p_forma_pago, p_orden_id);
    end if;
  end if;

  update ordenes_servicio set total_cobrado = p_total, forma_pago_entrega = coalesce(p_forma_pago,'') where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- ---------- Anular entrega: revierte exactamente lo que entregar_orden generó ----------
create or replace function anular_entrega_orden(p_orden_id bigint) returns void
language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado <> 'entregado' then raise exception 'La orden no está entregada'; end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, cantidad, 'anulacion', p_orden_id, 'Anulación entrega orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(o.total_cobrado,0) - v_anticipos, 0);

  if coalesce(o.total_cobrado,0) > 0 then
    if v_anticipos > 0 then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'ajuste', -v_anticipos, 'Anulación entrega orden #' || o.numero, p_orden_id);
    end if;
    if o.forma_pago_entrega = 'Cuenta corriente' then
      if v_restante > 0 then
        insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
        values (o.cliente_id, 'ajuste', -v_restante, 'Anulación entrega orden #' || o.numero, p_orden_id);
      end if;
    else
      if v_restante > 0 then
        insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
        values ('egreso', 'Anulación cobro service orden #' || o.numero, v_restante,
                coalesce(nullif(o.forma_pago_entrega,''), 'Efectivo'), p_orden_id);
      end if;
    end if;
  end if;

  update ordenes_servicio set total_cobrado = null, fecha_entrega = null, forma_pago_entrega = '' where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'listo', 'Se anuló la entrega registrada por error.');
end $$;

revoke execute on function registrar_anticipo_orden(bigint, numeric, text, text) from public, anon;
grant  execute on function registrar_anticipo_orden(bigint, numeric, text, text) to authenticated;
