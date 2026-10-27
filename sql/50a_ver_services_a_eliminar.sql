-- =====================================================================
-- GScom — VISTA PREVIA (no borra nada)
-- Órdenes de service que NO están entregadas, con sus pagos a cuenta y
-- movimientos. Son las que borraría 50_eliminar_services_no_entregados.sql.
-- La primera fila es el resumen.
-- =====================================================================
with a_borrar as (
  select o.* from ordenes_servicio o where o.estado <> 'entregado'
),
detalle as (
  select o.numero, case when o.tipo = 'armado' then 'Equipo nuevo' else 'Reparación' end as tipo, o.estado,
         c.nombre as cliente, (o.fecha_ingreso at time zone 'America/Argentina/Buenos_Aires')::date as ingreso,
         coalesce((select -sum(m.monto) from cc_movimientos m where m.orden_id = o.id and m.tipo = 'pago' and not m.anulado), 0) as pagos_a_cuenta,
         (select count(*) from caja_movimientos k where k.orden_id = o.id) as movs_caja,
         (select count(*) from cc_movimientos m where m.orden_id = o.id) as movs_fichero
    from a_borrar o join clientes c on c.id = o.cliente_id
)
select 0 as orden, 'RESUMEN' as numero, '' as tipo, '' as estado,
       count(*) || ' órdenes a borrar · se conservan ' || (select count(*) from ordenes_servicio where estado = 'entregado') || ' entregadas' as cliente,
       null::date as ingreso, sum(pagos_a_cuenta) as pagos_a_cuenta, sum(movs_caja)::bigint as movs_caja, sum(movs_fichero)::bigint as movs_fichero
  from detalle
union all
select 1, numero::text, tipo, estado, cliente, ingreso, pagos_a_cuenta, movs_caja, movs_fichero from detalle
order by 1, 2;
