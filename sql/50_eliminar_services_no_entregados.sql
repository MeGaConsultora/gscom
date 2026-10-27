-- =====================================================================
-- GScom — Borrar las órdenes de service NO entregadas, con sus pagos a cuenta
-- Se conservan las entregadas (y todos sus movimientos), los clientes y sus equipos.
-- De cada orden borrada se eliminan:
--   · ítems, historial de estados y presupuestos guardados (en cascada)
--   · anticipos / pagos a cuenta y sus movimientos de caja, incluidas sus anulaciones
--   · los movimientos de una entrega que después se anuló (caja, Fichero, stock),
--     que ya se compensaban entre sí
--   · imputaciones de cobros que apuntaban a la orden
-- El stock no cambia: las órdenes sin entregar no lo movieron (y las entregas
-- anuladas ya lo habían devuelto).
-- El SQL Editor ejecuta todo el script como una sola transacción: si algo falla, no se borra nada.
-- Al final muestra el resultado y el saldo de los clientes afectados (antes / después).
-- =====================================================================

drop table if exists _ord, _cc, _saldos, _res;
create temp table _ord as
  select id, numero, cliente_id from ordenes_servicio where estado <> 'entregado';

-- movimientos del Fichero de esas órdenes
create temp table _cc (id bigint primary key);
insert into _cc select id from cc_movimientos where orden_id in (select id from _ord);
-- las anulaciones de anticipos se registraron sin orden_id: se buscan por cliente,
-- monto opuesto y concepto, posteriores al anticipo anulado
insert into _cc
  select distinct on (p.id) a.id
    from cc_movimientos p
    join cc_movimientos a on a.cliente_id = p.cliente_id and a.tipo = 'ajuste' and a.orden_id is null
                         and a.monto = -p.monto and a.concepto like 'Anulación de cobro del %' and a.fecha >= p.fecha
   where p.id in (select id from _cc) and p.tipo = 'pago' and p.anulado
   order by p.id, a.fecha
  on conflict do nothing;

-- saldo de los clientes afectados, antes
create temp table _saldos as
  select c.id as cliente_id, c.nombre, coalesce((select sum(monto) from cc_movimientos m where m.cliente_id = c.id), 0) as saldo_antes
    from clientes c
   where c.id in (select cliente_id from _ord) or c.id in (select cliente_id from cc_movimientos where id in (select id from _cc));

create temp table _res (paso text, cantidad bigint);

with d as (delete from cc_imputaciones where pago_id in (select id from _cc) or grupo in (select 'orden:' || id from _ord) returning 1)
insert into _res select 'Imputaciones de cobros', count(*) from d;

with d as (delete from caja_movimientos where orden_id in (select id from _ord) or cc_movimiento_id in (select id from _cc) returning monto)
insert into _res select 'Movimientos de caja', count(*) from d;

with d as (delete from cc_movimientos where id in (select id from _cc) returning 1)
insert into _res select 'Movimientos del Fichero', count(*) from d;

with d as (delete from stock_movimientos where orden_id in (select id from _ord) returning 1)
insert into _res select 'Movimientos de stock (ya compensados)', count(*) from d;

with d as (delete from ordenes_servicio where id in (select id from _ord) returning 1)
insert into _res select 'Órdenes de service borradas', count(*) from d;

insert into _res select 'Órdenes entregadas que quedan', count(*) from ordenes_servicio;

-- Resultado: lo borrado y el saldo de cada cliente afectado (debería quedar igual)
select paso as detalle, cantidad::text as valor from _res
union all
select 'Saldo ' || s.nombre, to_char(s.saldo_antes, 'FM999G999G990D00') || ' → ' ||
       to_char(coalesce((select sum(monto) from cc_movimientos m where m.cliente_id = s.cliente_id), 0), 'FM999G999G990D00')
  from _saldos s;

