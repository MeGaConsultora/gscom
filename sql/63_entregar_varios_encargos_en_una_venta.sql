-- =====================================================================
-- GScom — Entregar varios encargos/reservas en una sola venta
-- Un pedido de varios productos se sigue guardando como un encargo por producto
-- (cada uno con su estado, por si llegan en distintos momentos). Si se entregan
-- juntos, ahora se puede hacer una sola venta: cada encargo queda vinculado a ella
-- (encargos.venta_id) y se le aplica su anticipo.
-- Al anular esa venta, TODOS los encargos que entregó vuelven a estar para retirar
-- y se libera su anticipo (antes solo volvía el que tenía anticipo).
-- No cambia ningún encargo ya entregado.
-- =====================================================================
alter table encargos add column if not exists venta_id bigint references ventas(id) on delete set null;
create index if not exists idx_encargos_venta on encargos(venta_id) where venta_id is not null;

-- Marca entregados los encargos de una venta y aplica el anticipo de cada uno.
-- Si se reintenta, los que ya quedaron entregados con esa venta no se tocan de nuevo.
create or replace function entregar_encargos_con_venta(p_venta_id bigint, p_encargos bigint[]) returns void
language plpgsql as $$
declare e encargos;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from ventas where id = p_venta_id and not anulada) then raise exception 'Venta no encontrada'; end if;
  for e in select * from encargos where id = any(p_encargos) order by id for update loop
    if e.estado = 'entregado' and e.venta_id = p_venta_id then continue; end if;
    if e.estado in ('entregado', 'cancelado') then
      raise exception 'El % N° % ya está %', case when e.tipo = 'reserva' then 'reserva' else 'encargo' end, e.numero, e.estado;
    end if;
    update encargos set estado = 'entregado', fecha_entrega = now(), venta_id = p_venta_id where id = e.id;
    perform aplicar_anticipo_encargo(e.id, p_venta_id);
  end loop;
end $$;

-- Anular la venta que entregó encargos: libera el anticipo aplicado de cada uno y todos vuelven a estar para retirar
create or replace function revertir_anticipo_encargo(p_venta_id bigint) returns void
language plpgsql as $$
declare r record; v_cliente bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  -- lo aplicado de cada encargo con esta venta que todavía no se liberó (si se llama dos veces, no libera de más)
  for r in select encargo_id, sum(monto) as neto from cc_movimientos
            where venta_id = p_venta_id and encargo_id is not null and tipo in ('cargo', 'ajuste')
            group by encargo_id having sum(monto) > 0.009 loop
    select cliente_id into v_cliente from cc_movimientos where venta_id = p_venta_id and encargo_id = r.encargo_id and tipo = 'cargo' order by id desc limit 1;
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, encargo_id, venta_id)
    values (v_cliente, 'ajuste', -r.neto, 'Anulación de venta: se libera el anticipo aplicado', r.encargo_id, p_venta_id);
  end loop;
  -- vuelven a estar para entregar: los vinculados a la venta y los que tenían anticipo aplicado en ella
  update encargos set estado = case when tipo = 'reserva' then 'reservado' else 'recibido' end, fecha_entrega = null, venta_id = null
   where estado = 'entregado'
     and (venta_id = p_venta_id
          or id in (select encargo_id from cc_movimientos where venta_id = p_venta_id and encargo_id is not null and tipo = 'cargo'));
end $$;

revoke execute on function entregar_encargos_con_venta(bigint, bigint[]) from public, anon;
revoke execute on function revertir_anticipo_encargo(bigint) from public, anon;
grant  execute on function entregar_encargos_con_venta(bigint, bigint[]) to authenticated;
grant  execute on function revertir_anticipo_encargo(bigint) to authenticated;
notify pgrst, 'reload schema';
