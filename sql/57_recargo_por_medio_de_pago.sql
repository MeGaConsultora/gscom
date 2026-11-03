-- =====================================================================
-- GScom — Recargo por medio de pago (planes de tarjeta / Mercado Pago)
-- · planes_pago: cada plan es medio (Débito, Crédito, Mercado Pago) + nombre
--   (marca/banco) + cuotas + % de recargo. Se cargan en Ajustes.
-- · El recargo va sobre la parte que se paga con ese medio y se suma al total.
--   Cada parte de pago guarda: monto (con recargo), recargo, plan, cuotas, pct.
-- · Ventas: ventas.recargo; total = subtotal − descuento + recargo.
-- · Entrega de service: total_cobrado incluye el recargo (recargo_entrega aparte).
-- · Cobro de cuenta corriente: baja la deuda en el monto cobrado; a caja entra
--   ese monto más el recargo (cc_movimientos.recargo / plan).
-- =====================================================================

create table if not exists planes_pago (
  id       bigint generated always as identity primary key,
  medio    text not null check (medio in ('Débito', 'Crédito', 'Mercado Pago')),
  nombre   text not null,
  cuotas   int not null default 1 check (cuotas between 1 and 60),
  recargo  numeric(6,2) not null default 0 check (recargo >= 0 and recargo < 100),
  activo   boolean not null default true,
  creado   timestamptz not null default now()
);
alter table planes_pago enable row level security;
drop policy if exists "usuarios activos" on planes_pago;
create policy "usuarios activos" on planes_pago for all to authenticated
  using (es_usuario_activo()) with check (es_usuario_activo());

alter table ventas add column if not exists recargo numeric(14,2) not null default 0;
alter table ordenes_servicio add column if not exists recargo_entrega numeric(14,2) not null default 0;
alter table cc_movimientos add column if not exists recargo numeric(14,2) not null default 0;
alter table cc_movimientos add column if not exists plan text;

-- Suma de los recargos de las partes de pago
create or replace function recargo_de_pagos(p_pagos jsonb) returns numeric
language sql immutable as $$
  select coalesce(round(sum(coalesce((x->>'recargo')::numeric, 0)), 2), 0)
    from jsonb_array_elements(case when jsonb_typeof(p_pagos) = 'array' then p_pagos else '[]'::jsonb end) x
$$;

-- Una parte de pago, limpia (sin campos vacíos)
create or replace function parte_de_pago(x jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'forma_pago', x->>'forma_pago', 'monto', round((x->>'monto')::numeric, 2),
    'recargo', nullif(round(coalesce((x->>'recargo')::numeric, 0), 2), 0),
    'plan', nullif(x->>'plan', ''), 'cuotas', (x->>'cuotas')::int, 'pct', (x->>'pct')::numeric, 'plan_id', (x->>'plan_id')::bigint))
$$;

-- Valida las partes contra el total y devuelve null si es un solo medio sin recargo
create or replace function normalizar_pagos_venta(p_pagos jsonb, p_total numeric, p_cliente_id bigint) returns jsonb
language plpgsql immutable as $$
declare v_suma numeric; v_n int;
begin
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_pagos) x
              where coalesce(x->>'forma_pago', '') = '' or coalesce((x->>'monto')::numeric, 0) <= 0) then
    raise exception 'Cada medio de pago tiene que tener su forma y un monto mayor a 0';
  end if;
  if exists (select 1 from jsonb_array_elements(p_pagos) x
              where coalesce((x->>'recargo')::numeric, 0) < 0 or coalesce((x->>'recargo')::numeric, 0) >= (x->>'monto')::numeric
                 or (coalesce((x->>'recargo')::numeric, 0) > 0 and x->>'forma_pago' not in ('Débito', 'Crédito', 'Mercado Pago'))) then
    raise exception 'El recargo no es válido (solo va con débito, crédito o Mercado Pago)';
  end if;
  select sum((x->>'monto')::numeric), count(*) into v_suma, v_n from jsonb_array_elements(p_pagos) x;
  if abs(v_suma - p_total) > 0.01 then
    raise exception 'Los medios de pago suman % y el total es %', v_suma, p_total;
  end if;
  if p_cliente_id is null and exists (select 1 from jsonb_array_elements(p_pagos) x where x->>'forma_pago' = 'Cuenta corriente') then
    raise exception 'Para dejar una parte a cuenta corriente hay que elegir el cliente';
  end if;
  if v_n = 1 and recargo_de_pagos(p_pagos) = 0 then return null; end if;
  return (select jsonb_agg(parte_de_pago(x)) from jsonb_array_elements(p_pagos) x);
end $$;

-- ---------------------------------------------------------------------
create or replace function registrar_venta(
  p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default '', p_pagos jsonb default null
) returns bigint language plpgsql as $$
declare
  v_id bigint; v_subtotal numeric := 0; v_total numeric; v_recargo numeric; v_pagos jsonb; it jsonb; v ventas;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_recargo := recargo_de_pagos(p_pagos);
  v_total := v_subtotal - coalesce(p_descuento, 0) + v_recargo;

  v_pagos := normalizar_pagos_venta(p_pagos, v_total, p_cliente_id);
  if v_pagos is null and p_pagos is not null and jsonb_array_length(p_pagos) = 1 then p_forma_pago := p_pagos->0->>'forma_pago'; end if;
  if v_pagos is null and p_forma_pago = 'Cuenta corriente' and p_cliente_id is null then
    raise exception 'Para vender a cuenta corriente hay que elegir el cliente';
  end if;

  insert into ventas (cliente_id, subtotal, descuento, recargo, total, forma_pago, pagos, notas)
  values (p_cliente_id, v_subtotal, coalesce(p_descuento, 0), v_recargo, v_total,
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
create or replace function editar_venta(
  p_venta_id bigint, p_cliente_id bigint, p_items jsonb, p_descuento numeric, p_forma_pago text, p_notas text default '', p_pagos jsonb default null
) returns void language plpgsql as $$
declare
  v ventas; v_nueva ventas; v_subtotal numeric := 0; v_total numeric; v_recargo numeric; v_pagos jsonb; it jsonb;
  v_items_iguales boolean; v_plata_igual boolean;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into v from ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v.anulada then raise exception 'La venta está anulada: no se puede editar'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene ítems'; end if;

  select coalesce(sum((x->>'cantidad')::numeric * (x->>'precio_unitario')::numeric), 0)
    into v_subtotal from jsonb_array_elements(p_items) x;
  v_recargo := recargo_de_pagos(p_pagos);
  v_total := v_subtotal - coalesce(p_descuento, 0) + v_recargo;

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

  update ventas set cliente_id = p_cliente_id, subtotal = v_subtotal, descuento = coalesce(p_descuento, 0), recargo = v_recargo,
    total = v_total, forma_pago = p_forma_pago, pagos = v_pagos, notas = coalesce(p_notas, v.notas)
   where id = p_venta_id returning * into v_nueva;

  if not v_plata_igual then
    perform aplicar_pagos_venta(v, -1, 'Corrección de venta #' || v.numero);   -- revierte lo que se había cobrado
    perform aplicar_pagos_venta(v_nueva, 1, 'Venta #' || v.numero);              -- y carga lo nuevo
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Entrega de service: cada parte puede traer su recargo. "Paga ahora" (lo que baja el saldo)
-- es la suma de las partes SIN recargo; a caja entra cada parte con su recargo.
create or replace function entregar_orden(p_orden_id bigint, p_total numeric, p_forma_pago text, p_comentario text default '',
                                          p_nota_interna text default '', p_pagado numeric default null, p_pagos jsonb default null)
returns void language plpgsql as $$
declare o ordenes_servicio; v_anticipos numeric; v_restante numeric; v_pagado numeric; v_pagos jsonb; v_recargo numeric := 0; p record;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into o from ordenes_servicio where id = p_orden_id for update;
  if o.estado = 'entregado' then raise exception 'La orden ya fue entregada'; end if;
  if p_pagado is not null and p_pagado < 0 then raise exception 'El monto pagado no puede ser negativo'; end if;

  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where orden_id = p_orden_id and tipo = 'pago' and not anulado;
  v_restante := greatest(coalesce(p_total, 0) - v_anticipos, 0);

  -- Pago combinado (o un solo medio con recargo): varias partes que van a caja; lo que falta queda en cuenta corriente
  if p_pagos is not null and jsonb_typeof(p_pagos) = 'array' and jsonb_array_length(p_pagos) > 0 then
    if exists (select 1 from jsonb_array_elements(p_pagos) x
                where coalesce(x->>'forma_pago', '') in ('', 'Cuenta corriente') or coalesce((x->>'monto')::numeric, 0) <= 0) then
      raise exception 'Cada medio de pago tiene que tener su forma (no cuenta corriente) y un monto mayor a 0';
    end if;
    if exists (select 1 from jsonb_array_elements(p_pagos) x
                where coalesce((x->>'recargo')::numeric, 0) < 0 or coalesce((x->>'recargo')::numeric, 0) >= (x->>'monto')::numeric
                   or (coalesce((x->>'recargo')::numeric, 0) > 0 and x->>'forma_pago' not in ('Débito', 'Crédito', 'Mercado Pago'))) then
      raise exception 'El recargo no es válido (solo va con débito, crédito o Mercado Pago)';
    end if;
    v_recargo := recargo_de_pagos(p_pagos);
    select jsonb_agg(parte_de_pago(x)), sum(round((x->>'monto')::numeric, 2)) - v_recargo
      into v_pagos, v_pagado from jsonb_array_elements(p_pagos) x;
    if v_pagado > v_restante + 0.01 then
      raise exception 'Los medios de pago suman % (sin recargo) y el saldo a cobrar es %', v_pagado, v_restante;
    end if;
    v_pagado := least(v_pagado, v_restante);
    if jsonb_array_length(v_pagos) = 1 then
      p_forma_pago := v_pagos->0->>'forma_pago';
      if v_recargo = 0 then v_pagos := null; end if;
    else p_forma_pago := (select string_agg(x->>'forma_pago', ' + ') from jsonb_array_elements(v_pagos) x); end if;
  else
    v_pagado := case when p_forma_pago = 'Cuenta corriente' then 0 else least(coalesce(p_pagado, v_restante), v_restante) end;
  end if;

  insert into stock_movimientos (producto_id, cantidad, tipo, orden_id, nota)
  select producto_id, -cantidad, 'service', p_orden_id, 'Orden #' || o.numero
    from orden_items where orden_id = p_orden_id and producto_id is not null;

  -- Cancela contablemente los anticipos ya cobrados (quedan "aplicados" a esta orden)
  if v_anticipos > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_anticipos, 'Service orden #' || o.numero || ' (aplica anticipo)', p_orden_id);
  end if;
  -- Lo que paga ahora entra a caja (una entrada por cada medio de pago, con su recargo)
  if v_pagos is not null then
    for p in select x->>'forma_pago' as forma, (x->>'monto')::numeric as monto from jsonb_array_elements(v_pagos) x loop
      insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
      values ('ingreso', 'Service orden #' || o.numero, p.monto, p.forma, p_orden_id);
    end loop;
  elsif v_pagado > 0 then
    insert into caja_movimientos (tipo, concepto, monto, forma_pago, orden_id)
    values ('ingreso', 'Service orden #' || o.numero, v_pagado, p_forma_pago, p_orden_id);
  end if;
  -- Lo que no paga queda como deuda en su cuenta corriente
  if v_restante - v_pagado > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, orden_id)
    values (o.cliente_id, 'cargo', v_restante - v_pagado,
            'Service orden #' || o.numero || case when v_pagado > 0 then ' (saldo)' else '' end, p_orden_id);
  end if;

  -- total_cobrado y pagado_entrega incluyen el recargo (así la anulación revierte lo mismo que entró)
  update ordenes_servicio set total_cobrado = p_total + v_recargo, recargo_entrega = v_recargo,
    forma_pago_entrega = coalesce(p_forma_pago, ''), pagado_entrega = v_pagado + v_recargo, pagos_entrega = v_pagos,
    notas_internas = case when nullif(p_nota_interna, '') is null then notas_internas
      else coalesce(nullif(notas_internas, '') || E'\n', '') || p_nota_interna end
   where id = p_orden_id;
  perform cambiar_estado_orden(p_orden_id, 'entregado', p_comentario);
end $$;

-- ---------------------------------------------------------------------
-- Cobro de cuenta corriente con recargo: la deuda baja en p_monto; a caja entra p_monto + p_recargo
create or replace function cobrar_cuenta_plan(p_cliente_id bigint, p_monto numeric, p_forma_pago text, p_nota text,
                                              p_imputaciones jsonb, p_recargo numeric, p_plan text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if coalesce(p_recargo, 0) < 0 then raise exception 'El recargo no puede ser negativo'; end if;
  if coalesce(p_recargo, 0) > 0 and p_forma_pago not in ('Débito', 'Crédito', 'Mercado Pago') then
    raise exception 'El recargo solo va con débito, crédito o Mercado Pago';
  end if;
  v_id := cobrar_cuenta_imputado(p_cliente_id, p_monto, p_forma_pago, p_nota, coalesce(p_imputaciones, '[]'::jsonb));
  if coalesce(p_recargo, 0) > 0 then
    update cc_movimientos set recargo = round(p_recargo, 2), plan = nullif(p_plan, '') where id = v_id;
    update caja_movimientos set monto = monto + round(p_recargo, 2), concepto = concepto || coalesce(' · ' || nullif(p_plan, ''), '')
     where cc_movimiento_id = v_id and tipo = 'ingreso';
  end if;
  return v_id;
end $$;

-- Anular un cobro: de caja sale lo que entró (con el recargo, si tuvo)
create or replace function anular_cobro_cuenta(p_cc_id bigint) returns void
language plpgsql as $$
declare m cc_movimientos; v_nombre text; v_estado text;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into m from cc_movimientos where id = p_cc_id for update;
  if m.tipo <> 'pago' then raise exception 'Solo se pueden anular cobros'; end if;
  if m.anulado then raise exception 'El cobro ya estaba anulado'; end if;
  if m.orden_id is not null then
    select estado into v_estado from ordenes_servicio where id = m.orden_id;
    if v_estado = 'entregado' then raise exception 'Esa orden ya fue entregada: anulá la entrega primero'; end if;
  end if;
  if m.encargo_id is not null then
    select estado into v_estado from encargos where id = m.encargo_id;
    if v_estado = 'entregado' then raise exception 'Ese encargo ya fue entregado: anulá la venta primero'; end if;
  end if;
  select nombre into v_nombre from clientes where id = m.cliente_id;
  update cc_movimientos set anulado = true where id = p_cc_id;
  insert into cc_movimientos (cliente_id, tipo, monto, concepto)
  values (m.cliente_id, 'ajuste', -m.monto, 'Anulación de cobro del ' || to_char(m.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY'));
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, cc_movimiento_id)
  values ('egreso', 'Anulación cobro cta. cte. — ' || v_nombre, -m.monto + coalesce(m.recargo, 0), m.forma_pago, p_cc_id);
end $$;

revoke execute on function recargo_de_pagos(jsonb) from public, anon;
revoke execute on function parte_de_pago(jsonb) from public, anon;
revoke execute on function normalizar_pagos_venta(jsonb, numeric, bigint) from public, anon;
revoke execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb) from public, anon;
revoke execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text, jsonb) from public, anon;
revoke execute on function entregar_orden(bigint, numeric, text, text, text, numeric, jsonb) from public, anon;
revoke execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text) from public, anon;
revoke execute on function anular_cobro_cuenta(bigint) from public, anon;
grant  execute on function registrar_venta(bigint, jsonb, numeric, text, text, jsonb) to authenticated;
grant  execute on function editar_venta(bigint, bigint, jsonb, numeric, text, text, jsonb) to authenticated;
grant  execute on function entregar_orden(bigint, numeric, text, text, text, numeric, jsonb) to authenticated;
grant  execute on function cobrar_cuenta_plan(bigint, numeric, text, text, jsonb, numeric, text) to authenticated;
grant  execute on function anular_cobro_cuenta(bigint) to authenticated;
