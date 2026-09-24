-- =====================================================================
-- GScom — Editar movimientos manuales de caja + nuevo estado de service
-- "Derivado de laboratorio" (equipos que se mandan a reparar afuera,
-- ej: notebooks derivadas a Santa Fe).
-- =====================================================================

-- ---------- Editar un movimiento manual de caja (concepto, monto, forma de pago) ----------
create or replace function editar_movimiento_caja(p_id bigint, p_concepto text, p_monto numeric, p_forma_pago text)
returns void language plpgsql as $$
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto tiene que ser mayor a cero'; end if;
  if not exists (select 1 from caja_movimientos where id = p_id) then raise exception 'Movimiento no encontrado'; end if;
  if exists (select 1 from caja_movimientos where id = p_id and (venta_id is not null or orden_id is not null or cc_movimiento_id is not null)) then
    raise exception 'Este movimiento viene de una venta, un service o un cobro: no se edita directamente';
  end if;
  update caja_movimientos set concepto = p_concepto, monto = p_monto, forma_pago = p_forma_pago where id = p_id;
end $$;

revoke execute on function editar_movimiento_caja(bigint, text, numeric, text) from public, anon;
grant  execute on function editar_movimiento_caja(bigint, text, numeric, text) to authenticated;

-- ---------- Nuevo estado: "derivado" (derivado de laboratorio) ----------
alter table ordenes_servicio drop constraint if exists ordenes_servicio_estado_check;
alter table ordenes_servicio add constraint ordenes_servicio_estado_check
  check (estado in ('recibido','diagnostico','presupuesto','reparacion','derivado','repuesto','listo','entregado','sin_reparacion'));

-- ---------- Seguimiento público: mostrar anticipo pagado y saldo pendiente ----------
create or replace function seguimiento_orden(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero',               o.numero,
    'cliente',              coalesce(nullif(c.nombres, ''), split_part(c.nombre, ' ', 1)),
    'equipo',               btrim(coalesce(e.tipo,'') || ' ' || coalesce(e.marca,'') || ' ' || coalesce(e.modelo,'')),
    'falla',                o.falla_reportada,
    'estado',               o.estado,
    'fecha_ingreso',        o.fecha_ingreso,
    'fecha_estimada',       o.fecha_estimada,
    'fecha_entrega',        o.fecha_entrega,
    'presupuesto',          o.presupuesto,
    'presupuesto_aprobado', o.presupuesto_aprobado,
    'anticipo_pagado',      (select coalesce(-sum(m.monto),0) from cc_movimientos m where m.orden_id = o.id and m.tipo = 'pago' and not m.anulado),
    'saldo_pendiente',      case
                               when o.estado = 'entregado' and coalesce(o.forma_pago_entrega,'') <> 'Cuenta corriente' then 0
                               else greatest(coalesce(o.total_cobrado, o.presupuesto, 0) -
                                 (select coalesce(-sum(m.monto),0) from cc_movimientos m where m.orden_id = o.id and m.tipo = 'pago' and not m.anulado), 0)
                             end,
    'historial',            (select coalesce(jsonb_agg(jsonb_build_object('estado', h.estado, 'comentario', h.comentario, 'fecha', h.created_at) order by h.created_at), '[]'::jsonb)
                               from orden_estados h where h.orden_id = o.id),
    'negocio',              (select jsonb_build_object('nombre', n.nombre, 'telefono', n.telefono, 'whatsapp', n.whatsapp, 'direccion', n.direccion, 'horario', n.horario) from negocio n where n.id = 1)
  )
  from ordenes_servicio o
  join clientes c on c.id = o.cliente_id
  left join equipos e on e.id = o.equipo_id
  where o.token = p_token;
$$;
