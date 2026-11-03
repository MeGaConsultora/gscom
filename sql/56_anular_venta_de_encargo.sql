-- =====================================================================
-- GScom — Anular la venta que entregó un encargo/reserva
-- Hasta ahora, al anular esa venta se liberaba el anticipo pero el encargo
-- seguía "entregado", y así no se podía volver a entregar ni cancelar.
-- Ahora vuelve a "recibido" (o "reservado" si es una reserva).
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

-- No se corrige ningún encargo ya existente: puede haberse entregado igual con otra venta
-- (como el N° 4, vendido con la venta #66). Esos quedan "entregado" y su anticipo, si no quedó
-- aplicado a ninguna venta, la app lo toma como un cobro más en la cuenta del cliente.
