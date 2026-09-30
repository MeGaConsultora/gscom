-- =====================================================================
-- GScom — Armado de PC, como un tipo de orden de service más.
-- Comparte toda la mecánica ya armada (anticipos, repuestos/ítems libres,
-- entrega con saldo, recibos), pero con su propio circuito de estados:
-- Encargado → En proceso de armado → Lista para retirar → Entregado.
-- No usa equipo_id (no hay un equipo existente del cliente que ingresa)
-- ni presupuesto/diagnóstico/contraseña: eso queda para reparación.
-- El campo falla_reportada se reutiliza como "especificaciones" del armado.
-- =====================================================================

alter table ordenes_servicio add column if not exists tipo text not null default 'reparacion';

alter table ordenes_servicio drop constraint if exists ordenes_servicio_tipo_check;
alter table ordenes_servicio add constraint ordenes_servicio_tipo_check
  check (tipo in ('reparacion', 'armado'));

alter table ordenes_servicio drop constraint if exists ordenes_servicio_estado_check;
alter table ordenes_servicio add constraint ordenes_servicio_estado_check
  check ((tipo = 'armado' and estado in ('encargado', 'en_armado', 'listo', 'entregado'))
      or (tipo = 'reparacion' and estado in ('recibido', 'diagnostico', 'presupuesto', 'reparacion', 'derivado', 'repuesto', 'listo', 'entregado', 'sin_reparacion')));

-- Seguimiento público: el cliente necesita saber si es un armado (otro circuito de estados/mensajes)
create or replace function seguimiento_orden(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero',               o.numero,
    'tipo',                 o.tipo,
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
