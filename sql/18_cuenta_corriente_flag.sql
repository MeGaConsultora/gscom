-- =====================================================================
-- GScom — Marca "cliente de cuenta corriente": permite que el Fichero
-- muestre a un cliente aunque su saldo esté en $0 (por ejemplo, un
-- organismo que compra siempre a cuenta pero por ahora está al día).
-- =====================================================================

alter table clientes add column if not exists cuenta_corriente boolean not null default false;

-- El Fichero ahora incluye: clientes marcados como "cuenta_corriente" (aunque
-- nunca hayan tenido movimientos) + cualquier cliente que SÍ tenga movimientos
-- (aunque no esté marcado, por compatibilidad con cuentas ya usadas antes de este cambio).
create or replace view cc_saldos with (security_invoker = true) as
select c.id as cliente_id, c.nombre, c.telefono,
       coalesce(sum(m.monto), 0) as saldo,
       min(m.fecha) filter (where m.tipo = 'cargo' and not m.anulado) as deuda_desde,
       max(m.fecha) as ultimo_movimiento
  from clientes c
  left join cc_movimientos m on m.cliente_id = c.id
 where c.cuenta_corriente or exists (select 1 from cc_movimientos x where x.cliente_id = c.id)
 group by c.id, c.nombre, c.telefono;
