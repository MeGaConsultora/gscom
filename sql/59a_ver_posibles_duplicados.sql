-- =====================================================================
-- GScom — VISTA PREVIA (no cambia nada)
-- Posibles duplicados por doble clic: ventas no anuladas iguales (mismo cliente,
-- total, forma de pago e ítems) y cobros de cuenta corriente no anulados iguales
-- (mismo cliente, monto y forma de pago), registrados con menos de 2 minutos de diferencia.
-- =====================================================================
with ventas_con_items as (
  select v.id, v.numero, v.fecha, v.cliente_id, v.total, v.forma_pago, v.facturacion, v.factura_nro,
         (select string_agg(i.cantidad || ' x ' || i.descripcion || ' @ ' || i.precio_unitario, ' | ' order by i.descripcion, i.cantidad, i.precio_unitario)
            from venta_items i where i.venta_id = v.id) as items
    from ventas v where not v.anulada
)
select 'Venta' as tipo, a.numero as original, b.numero as posible_copia,
       to_char(a.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') as fecha_original,
       round(extract(epoch from b.fecha - a.fecha)::numeric, 1) as segundos_despues,
       coalesce(c.nombre, 'Consumidor final') as cliente, a.total as monto, a.forma_pago,
       a.facturacion || ' / ' || b.facturacion as factura_original_y_copia, a.items as detalle
  from ventas_con_items a
  join ventas_con_items b on b.id > a.id and b.fecha >= a.fecha and b.fecha - a.fecha < interval '2 minutes'
   and b.cliente_id is not distinct from a.cliente_id and b.total = a.total and b.forma_pago = a.forma_pago and b.items is not distinct from a.items
  left join clientes c on c.id = a.cliente_id
union all
select 'Cobro cta. cte.', a.id, b.id,
       to_char(a.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS'),
       round(extract(epoch from b.fecha - a.fecha)::numeric, 1),
       c.nombre, -a.monto, a.forma_pago, '', a.concepto
  from cc_movimientos a
  join cc_movimientos b on b.id > a.id and b.fecha >= a.fecha and b.fecha - a.fecha < interval '2 minutes'
   and b.cliente_id = a.cliente_id and b.monto = a.monto and b.forma_pago = a.forma_pago and b.tipo = 'pago' and not b.anulado
  join clientes c on c.id = a.cliente_id
 where a.tipo = 'pago' and not a.anulado
 order by fecha_original desc;
