-- =====================================================================
-- GScom — Anular la venta que entregó un encargo/reserva
-- Hasta ahora, al anular esa venta se liberaba el anticipo pero el encargo
-- seguía "entregado", y así no se podía volver a entregar ni cancelar.
-- Ahora vuelve a "recibido" (o "reservado" si es una reserva).
-- Al final corrige los que ya quedaron así y los muestra.
-- =====================================================================
create or replace function revertir_anticipo_encargo(p_venta_id bigint) returns void
language plpgsql as $$
declare m cc_movimientos;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into m from cc_movimientos
   where venta_id = p_venta_id and encargo_id is not null and tipo = 'cargo'
   order by id desc limit 1;
  if not found then return; end if;
  insert into cc_movimientos (cliente_id, tipo, monto, concepto, encargo_id, venta_id)
  values (m.cliente_id, 'ajuste', -m.monto, 'Anulación de venta: se libera el anticipo aplicado', m.encargo_id, p_venta_id);
  update encargos set estado = case when tipo = 'reserva' then 'reservado' else 'recibido' end, fecha_entrega = null
   where id = m.encargo_id and estado = 'entregado';
end $$;
revoke execute on function revertir_anticipo_encargo(bigint) from public, anon;
grant  execute on function revertir_anticipo_encargo(bigint) to authenticated;

-- Los que ya quedaron "entregados" con la venta anulada: su último movimiento es la liberación del anticipo
with ultimo as (
  select distinct on (encargo_id) encargo_id, concepto from cc_movimientos
   where encargo_id is not null and tipo in ('cargo', 'ajuste')
   order by encargo_id, id desc
), corregidos as (
  update encargos e set estado = case when e.tipo = 'reserva' then 'reservado' else 'recibido' end, fecha_entrega = null
    from ultimo u
   where u.encargo_id = e.id and u.concepto like 'Anulación de venta: se libera%' and e.estado = 'entregado'
  returning e.id, e.tipo, e.numero, e.estado, e.cliente_id
)
select c.tipo, c.numero, c.estado as estado_nuevo, cl.nombre as cliente from corregidos c left join clientes cl on cl.id = c.cliente_id;
