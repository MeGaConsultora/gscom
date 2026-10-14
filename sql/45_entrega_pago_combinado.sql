-- =====================================================================
-- GScom — Entrega de service con más de un medio de pago
-- · ordenes_servicio.pagos_entrega: [{forma_pago, monto}] cuando al retirar
--   se paga con más de un medio (ej: parte efectivo, parte transferencia).
--   Lo que no se paga sigue quedando en la cuenta corriente, como antes.
-- · entregar_orden(): nuevo parámetro opcional p_pagos. Cada parte entra a
--   caja con su forma de pago. anular_entrega_orden() revierte cada parte.
-- =====================================================================

alter table ordenes_servicio add column if not exists pagos_entrega jsonb;

drop function if exists entregar_orden(bigint, numeric, text, text, text, numeric);

create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '',
                                          p_nota_interna text default '', p_pagado numeric default null, p_pagos jsonb default null)
returns void language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric; v_pagado numeric; v_pagos jsonb; p record;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada'; end if;
  if p_pagado is not null and p_pagado < 0 then raise exception 'El monto pagado no puede ser negativo'; end if;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(p_total, 0) - v_anticipos, 0);

  -- Pago combinado: varias partes que van a caja; lo que falta queda en cuenta corriente
  if p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0 then
    if exists (select 1 from jsonb_array_elements(p_pagos) x
                where coalesce(x->>'forma_pago', '') in ('', 'Cuenta corriente') or coalesce((x->>'monto')::numeric, 0) <= 0) then
      raise exception 'Cada medio de pago tiene que tener su forma (no cuenta corriente) y un monto mayor a 0';
    end if;
    select jsonb_agg(jsonb_build_object('forma_pago', x->>'forma_pago', 'monto', round((x->>'monto')::numeric, 2))),
           sum(round((x->>'monto')::numeric, 2))
      into v_pagos, v_pagado from jsonb_array_elements(p_pagos) x;
    if v_pagado > v_restante + 0.01 then
      raise exception 'Los medios de pago suman % y el saldo a cobrar es %', v_pagado, v_restante;
    end if;
    v_pagado := least(v_pagado, v_restante);
    if jsonb_array_length(v_pagos) = 1 then p_forma_pago := v_pagos->0->>'forma_pago'; v_pagos := null;
    else p_forma_pago := (select string_agg(x->>'forma_pago', ' + ') from jsonb_array_elements(v_pagos) x); end if;
  else
    v_pagado := case when p_forma_pago = 'Cuenta corriente' then 0 else least(coalesce(p_pagado, v_restante), v_restante) end;
  end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, -cantidad, 'service', p_orden_id, 'Orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  -- Cancela contablemente los anticipos ya cobrados (quedan "aplicados" a esta orden)
  if v_anticipos > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_anticipos, 'Service orden #' || o.numero || ' (aplica anticipo)', p_orden_id);
  end if;
  -- Lo que paga ahora entra a caja (una entrada por cada medio de pago)
  if v_pagos is not null then
    for p in select x->>'forma_pago' as forma, (x->>'monto')::numeric as monto from jsonb_array_elements(v_pagos) x loop
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('ingreso', 'Service orden #' || o.numero, p.monto, p.forma, p_orden_id);
    end loop;
  elsif v_pagado > 0 then
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
    pagos_entrega = v_pagos,
    notas_internas = case when nullif(p_nota_interna, '') is null then notas_internas
      else coalesce(nullif(notas_internas, '') || E'\n', '') || p_nota_interna end
   where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- Anular entrega: revierte lo que entregar_orden generó (también las entregas viejas, sin pagado_entrega)
create or replace function anular_entrega_orden(p_orden_id bigint) returns void
language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric; v_pagado numeric; p record;
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
    if o.pagos_entrega is not null then
      for p in select x->>'forma_pago' as forma, (x->>'monto')::numeric as monto from jsonb_array_elements(o.pagos_entrega) x loop
        insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
        values ('egreso', 'Anulación cobro service orden #' || o.numero, p.monto, p.forma, p_orden_id);
      end loop;
    elsif v_pagado > 0 then
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('egreso', 'Anulación cobro service orden #' || o.numero, v_pagado,
              coalesce(nullif(o.forma_pago_entrega, ''), 'Efectivo'), p_orden_id);
    end if;
    if v_restante - v_pagado > 0 then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
      values (o.cliente_id, 'ajuste', -(v_restante - v_pagado), 'Anulación entrega orden #' || o.numero, p_orden_id);
    end if;
  end if;

  update ordenes_servicio set total_cobrado = null, fecha_entrega = null, forma_pago_entrega = '', pagado_entrega = null, pagos_entrega = null
   where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'listo', 'Se anuló la entrega registrada por error.');
end $$;

revoke execute on function entregar_orden(bigint, numeric, text, text, text, numeric, jsonb) from public, anon;
grant  execute on function entregar_orden(bigint, numeric, text, text, text, numeric, jsonb) to authenticated;
revoke execute on function anular_entrega_orden(bigint) from public, anon;
grant  execute on function anular_entrega_orden(bigint) to authenticated;
