-- =====================================================================
-- GScom — Editar venta sin generar movimientos innecesarios
-- Antes: toda edición revertía y volvía a cargar la venta completa
-- (stock + caja/cta. cte.), aunque solo se cambiara la observación.
-- Ahora: solo se corrige lo que realmente cambió.
--   · ítems distintos           → se corrige el stock
--   · total, cliente o forma de pago distintos → se corrige caja / cta. cte.
--   · solo observaciones        → se actualiza la venta, sin movimientos
-- Al final: limpieza única de los pares "Corrección de venta" que ya
-- se generaron y se anulan exactamente entre sí.
-- =====================================================================

create or replace function editar_venta(
  p_venta_id bigint, p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default ''
) returns void language plpgsql as $$
declare
  v ventas; v_subtotal numeric := 0; v_total numeric; it jsonb;
  v_items_iguales boolean; v_plata_igual boolean;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.anulada then raise exception 'La venta está anulada: no se puede editar'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;
  if p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then raise exception 'Para vender a cuenta corriente hay que elegir el cliente'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_total := v_subtotal - coalesce(p_descuento, 0);

  -- ¿Cambiaron los ítems? (se comparan producto, descripción, cantidad y precio)
  select coalesce((select jsonb_agg(jsonb_build_array(producto_id, descripcion, cantidad, precio_unitario)
                                   order by producto_id nulls first, descripcion, cantidad, precio_unitario)
                     from venta_items where venta_id = p_venta_id), '[]'::jsonb)
       = coalesce((select jsonb_agg(jsonb_build_array(nullif(x->>'producto_id','')::bigint, x->>'descripcion',
                                                      (x->>'cantidad')::numeric, (x->>'precio_unitario')::numeric)
                                   order by nullif(x->>'producto_id','')::bigint nulls first, x->>'descripcion',
                                            (x->>'cantidad')::numeric, (x->>'precio_unitario')::numeric)
                     from jsonb_array_elements(p_items) x), '[]'::jsonb)
    into v_items_iguales;

  -- ¿Cambió algo que mueva plata? (total, cliente o forma de pago)
  v_plata_igual := v_total = v.total and p_forma_pago = v.forma_pago and p_cliente_id is not distinct from v.cliente_id;

  if not v_items_iguales then
    insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
    select producto_id, cantidad, 'ajuste', p_venta_id, 'Corrección de venta #' || v.numero
      from venta_items where venta_id = p_venta_id and producto_id is not null;
    delete from venta_items where venta_id = p_venta_id;
    for it in select * from jsonb_array_elements(p_items) loop
      insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
      values (p_venta_id, nullif(it->>'producto_id','')::bigint, it->>'descripcion', (it->>'cantidad')::numeric,
              (it->>'precio_unitario')::numeric, (it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric);
      if nullif(it->>'producto_id','') is not null then
        insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
        values ((it->>'producto_id')::bigint, -(it->>'cantidad')::numeric, 'venta', p_venta_id, 'Venta #' || v.numero || ' (editada)');
      end if;
    end loop;
  end if;

  if not v_plata_igual then
    if v.forma_pago = 'Cuenta corriente' then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
      values (v.cliente_id, 'ajuste', -v.total, 'Corrección de venta #' || v.numero, p_venta_id);
    else
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
      values ('egreso', 'Corrección de venta #' || v.numero, v.total, v.forma_pago, p_venta_id);
    end if;
    if p_forma_pago = 'Cuenta corriente' then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
      values (p_cliente_id, 'cargo', v_total, 'Venta #' || v.numero, p_venta_id);
    else
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
      values ('ingreso', 'Venta #' || v.numero, v_total, p_forma_pago, p_venta_id);
    end if;
  end if;

  update ventas set cliente_id = p_cliente_id, subtotal = v_subtotal, descuento = coalesce(p_descuento, 0),
    total = v_total, forma_pago = p_forma_pago, notas = coalesce(p_notas, v.notas) where id = p_venta_id;
end $$;

revoke execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text) from public, anon;
grant  execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Limpieza única de lo que ya se generó.
-- Fichero: por cada venta editada, se borran las "Corrección de venta" y
-- los cargos anteriores, dejando solo el último cargo, SOLO si lo borrado
-- suma exactamente cero (el saldo no cambia).
-- ---------------------------------------------------------------------
with por_venta as (
  select venta_id, cliente_id,
         max(id) filter (where tipo = 'cargo' and concepto like 'Venta #%') as ultimo_cargo
    from cc_movimientos
   where venta_id in (select venta_id from cc_movimientos where concepto like 'Corrección de venta #%')
   group by venta_id, cliente_id
),
a_borrar as (
  select m.id, m.venta_id, m.monto
    from cc_movimientos m join por_venta p on p.venta_id = m.venta_id and p.cliente_id = m.cliente_id
   where (m.concepto like 'Corrección de venta #%')
      or (m.tipo = 'cargo' and m.concepto like 'Venta #%' and m.id <> p.ultimo_cargo)
),
ventas_ok as (select venta_id from a_borrar group by venta_id having sum(monto) = 0)
delete from cc_movimientos where id in (select id from a_borrar where venta_id in (select venta_id from ventas_ok));

-- Caja: igual, pero solo si todos los movimientos de esa venta son del mismo
-- día (así no se altera ningún día ya cerrado) y se anulan por forma de pago.
with editadas as (
  select venta_id from caja_movimientos where concepto like 'Corrección de venta #%' group by venta_id
),
por_venta as (
  select m.venta_id, max(m.id) filter (where m.tipo = 'ingreso' and m.concepto like 'Venta #%') as ultimo_ingreso
    from caja_movimientos m where m.venta_id in (select venta_id from editadas)
   group by m.venta_id
  having count(distinct (m.fecha at time zone 'America/Argentina/Buenos_Aires')::date) = 1
),
a_borrar as (
  select m.id, m.venta_id, m.forma_pago, case when m.tipo = 'ingreso' then m.monto else -m.monto end as signo
    from caja_movimientos m join por_venta p on p.venta_id = m.venta_id
   where m.concepto like 'Corrección de venta #%'
      or (m.tipo = 'ingreso' and m.concepto like 'Venta #%' and m.id <> p.ultimo_ingreso)
),
ventas_ok as (
  select venta_id from (select venta_id, forma_pago, sum(signo) s from a_borrar group by venta_id, forma_pago) t
   group by venta_id having bool_and(s = 0)
)
delete from caja_movimientos where id in (select id from a_borrar where venta_id in (select venta_id from ventas_ok));

-- Control: ya no deberían quedar correcciones de ventas editadas (o muy pocas, si no se pudieron limpiar con seguridad)
select 'fichero' as donde, count(*) as correcciones_restantes from cc_movimientos where concepto like 'Corrección de venta #%'
union all
select 'caja', count(*) from caja_movimientos where concepto like 'Corrección de venta #%';
