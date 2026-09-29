-- =====================================================================
-- GScom — Entregar un service pagando una parte y dejando saldo
-- · entregar_orden(): nuevo parámetro p_pagado = cuánto paga ahora el
--   cliente (con la forma de pago elegida). Lo que falta del total, después
--   de descontar los anticipos, queda como deuda en su cuenta corriente.
--   Si no se indica, paga todo (como hasta ahora). "Cuenta corriente" como
--   forma de pago equivale a pagar 0 ahora.
-- · ordenes_servicio.pagado_entrega: cuánto se cobró al entregar, para que
--   anular_entrega_orden() revierta exactamente caja y cuenta corriente.
-- =====================================================================

alter table ordenes_servicio add column if not exists pagado_entrega numeric(14,2);

drop function if exists entregar_orden(bigint, numeric, text, text, text);

create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '',
                                          p_nota_interna text default '', p_pagado numeric default null)
returns void language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric; v_pagado numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada'; end if;
  if p_pagado is not null and p_pagado < 0 then raise exception 'El monto pagado no puede ser negativo'; end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, -cantidad, 'service', p_orden_id, 'Orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(p_total, 0) - v_anticipos, 0);
  v_pagado := case when p_forma_pago = 'Cuenta corriente' then 0 else least(coalesce(p_pagado, v_restante), v_restante) end;

  -- Cancela contablemente los anticipos ya cobrados (quedan "aplicados" a esta orden)
  if v_anticipos > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_anticipos, 'Service orden #' || o.numero || ' (aplica anticipo)', p_orden_id);
  end if;
  -- Lo que paga ahora entra a caja
  if v_pagado > 0 then
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
    values ('ingreso', 'Service orden #' || o.numero, v_pagado, p_forma_pago, p_orden_id);
  end if;
  -- Lo que no paga queda como deuda en su cuenta corriente
  if v_restante - v_pagado > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_restante - v_pagado,
            'Service orden #' || o.numero || case when v_pagado > 0 then ' (saldo)' else '' end, p_orden_id);
  end if;

  update ordenes_servicio set total_cobrado = p_total, forma_pago_entrega = coalesce(p_forma_pago, ''), pagado_entrega = v_pagado,
    notas_internas = case when nullif(p_nota_interna, '') is null then notas_internas
      else coalesce(nullif(notas_internas, '') || E'\n', '') || p_nota_interna end
   where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- Anular entrega: revierte lo que entregar_orden generó (también las entregas viejas, sin pagado_entrega)
create or replace function anular_entrega_orden(p_orden_id bigint) returns void
language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric; v_pagado numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado <> 'entregado' then raise exception 'La orden no está entregada'; end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, cantidad, 'anulacion', p_orden_id, 'Anulación entrega orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(o.total_cobrado, 0) - v_anticipos, 0);
  v_pagado := coalesce(o.pagado_entrega, case when o.forma_pago_entrega = 'Cuenta corriente' then 0 else v_restante end);

  if coalesce(o.total_cobrado, 0) > 0 then
    if v_anticipos > 0 then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'ajuste', -v_anticipos, 'Anulación entrega orden #' || o.numero, p_orden_id);
    end if;
    if v_pagado > 0 then
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('egreso', 'Anulación cobro service orden #' || o.numero, v_pagado,
              coalesce(nullif(o.forma_pago_entrega, ''), 'Efectivo'), p_orden_id);
    end if;
    if v_restante - v_pagado > 0 then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'ajuste', -(v_restante - v_pagado), 'Anulación entrega orden #' || o.numero, p_orden_id);
    end if;
  end if;

  update ordenes_servicio set total_cobrado = null, fecha_entrega = null, forma_pago_entrega = '', pagado_entrega = null where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'listo', 'Se anuló la entrega registrada por error.');
end $$;

revoke execute on function entregar_orden(bigint, numeric, text, text, text, numeric) from public, anon;
grant  execute on function entregar_orden(bigint, numeric, text, text, text, numeric) to authenticated;
revoke execute on function anular_entrega_orden(bigint) from public, anon;
grant  execute on function anular_entrega_orden(bigint) to authenticated;
