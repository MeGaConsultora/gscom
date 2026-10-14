-- =====================================================================
-- GScom — Ventas con más de un medio de pago (ej: parte efectivo, parte débito,
-- o parte contado y el resto a cuenta corriente)
-- · ventas.pagos: [{forma_pago, monto}] cuando se combinan medios. Si es null,
--   la venta se pagó entera con ventas.forma_pago (como hasta ahora).
--   En las combinadas, forma_pago queda como texto legible: "Efectivo + Débito".
-- · Cada parte genera su propio movimiento: caja con su forma de pago, o
--   cargo en el Fichero si es "Cuenta corriente".
-- · registrar_venta / editar_venta reciben p_pagos (opcional) y anular_venta
--   revierte cada parte.
-- =====================================================================

alter table ventas add column if not exists pagos jsonb;

-- Las partes de una venta (una sola si no se combinaron medios)
create or replace function pagos_de_venta(v ventas) returns table (forma_pago text, monto numeric)
language sql immutable as $$
  select x->>'forma_pago', (x->>'monto')::numeric
    from jsonb_array_elements(coalesce(v.pagos, jsonb_build_array(jsonb_build_object('forma_pago', v.forma_pago, 'monto', v.total)))) x
$$;

-- Genera (p_signo = 1) o revierte (p_signo = -1) los movimientos de caja / cuenta corriente de una venta
create or replace function aplicar_pagos_venta(v ventas, p_signo int, p_concepto text) returns void
language plpgsql as $$
declare p record;
begin
  for p in select * from pagos_de_venta(v) where monto <> 0 loop
    if p.forma_pago = 'Cuenta corriente' then
      insert into cc_movimientos (cliente_id, tipo, monto, concepto, venta_id)
      values (v.cliente_id, case when p_signo > 0 then 'cargo' else 'ajuste' end, p_signo * p.monto, p_concepto, v.id);
    else
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, venta_id)
      values (case when p_signo > 0 then 'ingreso' else 'egreso' end, p_concepto, p.monto, p.forma_pago, v.id);
    end if;
  end loop;
end $$;

-- Valida las partes contra el total y devuelve null si en realidad es un solo medio
create or replace function normalizar_pagos_venta(p_pagos jsonb, p_total numeric, p_cliente_id bigint) returns jsonb
language plpgsql immutable as $$
declare v_suma numeric; v_n int;
begin
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_pagos) x
              where coalesce(x->>'forma_pago', '') = '' or coalesce((x->>'monto')::numeric, 0) <= 0) then
    raise exception 'Cada medio de pago tiene que tener su forma y un monto mayor a 0';
  end if;
  select sum((x->>'monto')::numeric), count(*) into v_suma, v_n from jsonb_array_elements(p_pagos) x;
  if abs(v_suma - p_total) > 0.01 then
    raise exception 'Los medios de pago suman % y el total es %', v_suma, p_total;
  end if;
  if p_cliente_id is null and exists (select 1 from jsonb_array_elements(p_pagos) x where x->>'forma_pago' = 'Cuenta corriente') then
    raise exception 'Para dejar una parte a cuenta corriente hay que elegir el cliente';
  end if;
  if v_n = 1 then return null; end if;
  return (select jsonb_agg(jsonb_build_object('forma_pago', x->>'forma_pago', 'monto', round((x->>'monto')::numeric, 2))) from jsonb_array_elements(p_pagos) x);
end $$;

create or replace function texto_pagos(p_pagos jsonb) returns text
language sql immutable as $$
  select string_agg(x->>'forma_pago', ' + ') from jsonb_array_elements(p_pagos) x
$$;

-- ---------------------------------------------------------------------
drop function if exists registrar_venta(bigint, jsonb, numeric, text, text);
create or replace function registrar_venta(
  p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default '', p_pagos jsonb default null
) returns bigint language plpgsql as $$
declare
  v_id bigint; v_subtotal numeric := 0; v_total numeric; v_pagos jsonb; it jsonb; v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_total := v_subtotal - coalesce(p_descuento, 0);

  v_pagos := normalizar_pagos_venta(p_pagos, v_total, p_cliente_id);
  if v_pagos is null and p_pagos is not null and jsonb_array_length(p_pagos) = 1 then p_forma_pago := p_pagos->0->>'forma_pago'; end if;
  if v_pagos is null and p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then
    raise exception 'Para vender a cuenta corriente hay que elegir el cliente';
  end if;

  insert into ventas (cliente_id, subtotal, descuento, total, forma_pago, pagos, notas)
  values (p_cliente_id, v_subtotal, coalesce(p_descuento, 0), v_total,
          coalesce(texto_pagos(v_pagos), p_forma_pago), v_pagos, coalesce(p_notas, ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    insert into venta_items (venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
    values (v_id, nullif(it->>'producto_id','')::bigint, it->>'descripcion', (it->>'cantidad')::numeric,
            (it->>'precio_unitario')::numeric, (it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric);
    if nullif(it->>'producto_id','') is not null then
      insert into stock_movimientos (producto_id, cantidad, tipo, venta_id)
      values ((it->>'producto_id')::bigint, -(it->>'cantidad')::numeric, 'venta', v_id);
    end if;
  end loop;

  select * into v from ventas where id = v_id;
  perform aplicar_pagos_venta(v, 1, 'Venta #' || v.numero);
  return v_id;
end $$;

-- ---------------------------------------------------------------------
create or replace function anular_venta(p_venta_id bigint) returns void
language plpgsql as $$
declare v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if v.anulada then raise exception 'La venta ya estaba anulada'; end if;
  update ventas set anulada = true where id = p_venta_id;
  insert into stock_movimientos (producto_id, cantidad, tipo, venta_id, nota)
  select producto_id, cantidad, 'anulacion', p_venta_id, 'Anulación venta #' || v.numero
    from venta_items where venta_id = p_venta_id and producto_id is not null;
  perform aplicar_pagos_venta(v, -1, 'Anulación venta #' || v.numero);
end $$;

-- ---------------------------------------------------------------------
drop function if exists editar_venta(bigint, bigint, jsonb, numeric, text, text);
create or replace function editar_venta(
  p_venta_id bigint, p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default '', p_pagos jsonb default null
) returns void language plpgsql as $$
declare
  v ventas; v_nueva ventas; v_subtotal numeric := 0; v_total numeric; v_pagos jsonb; it jsonb;
  v_items_iguales boolean; v_plata_igual boolean;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.anulada then raise exception 'La venta está anulada: no se puede editar'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_total := v_subtotal - coalesce(p_descuento, 0);

  v_pagos := normalizar_pagos_venta(p_pagos, v_total, p_cliente_id);
  if v_pagos is null and p_pagos is not null and jsonb_array_length(p_pagos) = 1 then p_forma_pago := p_pagos->0->>'forma_pago'; end if;
  if v_pagos is null and p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then
    raise exception 'Para vender a cuenta corriente hay que elegir el cliente';
  end if;
  p_forma_pago := coalesce(texto_pagos(v_pagos), p_forma_pago);

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

  -- ¿Cambió algo que mueva plata? (total, cliente, forma de pago o reparto entre medios)
  v_plata_igual := v_total = v.total and p_forma_pago = v.forma_pago and p_cliente_id is not distinct from v.cliente_id
                   and v_pagos is not distinct from v.pagos;

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

  update ventas set cliente_id = p_cliente_id, subtotal = v_subtotal, descuento = coalesce(p_descuento, 0),
    total = v_total, forma_pago = p_forma_pago, pagos = v_pagos, notas = coalesce(p_notas, v.notas)
   where id = p_venta_id returning * into v_nueva;

  if not v_plata_igual then
    perform aplicar_pagos_venta(v, -1, 'Corrección de venta #' || v.numero);   -- revierte lo que se había cobrado
    perform aplicar_pagos_venta(v_nueva, 1, 'Venta #' || v.numero);              -- y carga lo nuevo
  end if;
end $$;

revoke execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb) from public, anon;
revoke execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text, jsonb) from public, anon;
revoke execute on function anular_venta(bigint) from public, anon;
revoke execute on function aplicar_pagos_venta(ventas, int, text) from public, anon;
revoke execute on function normalizar_pagos_venta(jsonb, numeric, bigint) from public, anon;
revoke execute on function pagos_de_venta(ventas) from public, anon;
revoke execute on function texto_pagos(jsonb) from public, anon;
grant  execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb) to authenticated;
grant  execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text, jsonb) to authenticated;
grant  execute on function anular_venta(bigint) to authenticated;
