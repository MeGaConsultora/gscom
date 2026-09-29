-- =====================================================================
-- GScom — Nota interna al entregar una orden de service.
-- Cuando se entrega un equipo sin cobrar nada (el cliente se arrepintió
-- antes de diagnosticar, no aprobó el presupuesto, etc.) sirve dejar
-- registrado el motivo puertas adentro, sin mezclarlo con el mensaje
-- final que sí ve el cliente. Se agrega a "Notas internas" de la orden.
-- =====================================================================

-- Cambia la cantidad de parámetros: hay que borrar la versión anterior primero,
-- si no create or replace deja las dos funciones (sobrecarga) en vez de reemplazarla.
drop function if exists entregar_orden(bigint, numeric, text, text);

create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '', p_nota_interna text default '')
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

  update ordenes_servicio set total_cobrado = p_total, forma_pago_entrega = coalesce(p_forma_pago,''),
    notas_internas = case when nullif(p_nota_interna, '') is null then notas_internas
      else coalesce(nullif(notas_internas, '') || E'\n', '') || p_nota_interna end
   where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

revoke execute on function entregar_orden(bigint, numeric, text, text, text) from public, anon;
grant  execute on function entregar_orden(bigint, numeric, text, text, text) to authenticated;
