-- =====================================================================
-- GScom — Anticipo (seña / pago a cuenta) en encargos y reservas.
-- Mismo criterio que el anticipo de service: impacta caja al momento
-- y la cuenta corriente del cliente (Fichero) como un pago a favor.
-- A diferencia de service, acá la entrega es una VENTA normal (no una
-- función dedicada), así que el descuento del anticipo se aplica desde
-- la propia venta (campo "descuento") y esto solo cancela contablemente
-- el anticipo ya cobrado contra esa venta.
-- =====================================================================

alter table cc_movimientos add column if not exists encargo_id bigint references encargos(id) on delete set null;
alter table caja_movimientos add column if not exists encargo_id bigint references encargos(id) on delete set null;

-- ---------- Registrar un anticipo ----------
create or replace function registrar_anticipo_encargo(p_encargo_id bigint, p_monto numeric, p_forma_pago text, p_nota text default '')
returns bigint language plpgsql as $$
declare enc encargos; v_cc bigint;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  if coalesce(p_monto,0) <= 0 then raise exception 'El monto del anticipo tiene que ser mayor a cero'; end if;
  if p_forma_pago = 'Cuenta corriente' then raise exception 'Un anticipo es plata ya cobrada: elegí cómo lo pagó (efectivo, transferencia, etc.)'; end if;
  select * into enc from encargos where id = p_encargo_id for update;
  if not found then raise exception 'Encargo no encontrado'; end if;
  if enc.estado in ('entregado', 'cancelado') then raise exception 'Ese % ya está %', case when enc.tipo = 'reserva' then 'reserva' else 'encargo' end, enc.estado; end if;
  if enc.cliente_id is null then raise exception 'Este % no tiene un cliente cargado (es a nombre de alguien que todavía no es cliente): no se le puede registrar un anticipo', case when enc.tipo = 'reserva' then 'reserva' else 'encargo' end; end if;

  insert into cc_movimientos (cliente_id, tipo, monto, concepto, forma_pago, encargo_id)
  values (enc.cliente_id, 'pago', -p_monto, coalesce(nullif(p_nota,''), (case when enc.tipo = 'reserva' then 'Anticipo reserva N° ' else 'Anticipo encargo N° ' end) || enc.numero), p_forma_pago, p_encargo_id)
  returning id into v_cc;
  insert into caja_movimientos (tipo, concepto, monto, forma_pago, encargo_id, cc_movimiento_id)
  values ('ingreso', (case when enc.tipo = 'reserva' then 'Anticipo reserva N° ' else 'Anticipo encargo N° ' end) || enc.numero, p_monto, p_forma_pago, p_encargo_id, v_cc);
  return v_cc;
end $$;

-- ---------- Aplicar el/los anticipo(s) ya cobrados de un encargo contra la venta que lo entrega ----------
-- Se llama después de registrar la venta (con el descuento del anticipo ya restado del total a cobrar):
-- cancela contablemente el anticipo (vuelve el saldo a como estaba antes de cobrarlo) y lo deja vinculado a esa venta.
create or replace function aplicar_anticipo_encargo(p_encargo_id bigint, p_venta_id bigint) returns numeric
language plpgsql as $$
declare enc encargos; v_anticipos numeric;
begin
  if not es_usuario_activo() then raise exception 'Sin permiso'; end if;
  select * into enc from encargos where id = p_encargo_id;
  if not found then return 0; end if;
  select coalesce(-sum(monto), 0) into v_anticipos from cc_movimientos
   where encargo_id = p_encargo_id and tipo = 'pago' and not anulado;
  if v_anticipos > 0 then
    insert into cc_movimientos (cliente_id, tipo, monto, concepto, encargo_id, venta_id)
    values (enc.cliente_id, 'cargo', v_anticipos,
            (case when enc.tipo = 'reserva' then 'Reserva N° ' else 'Encargo N° ' end) || enc.numero || ' (aplica anticipo)', p_encargo_id, p_venta_id);
  end if;
  return v_anticipos;
end $$;

-- ---------- Deshacer lo anterior si se anula la venta que entregó el encargo ----------
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
end $$;

-- ---------- Anular un cobro/anticipo: agregar el mismo resguardo que ya tiene el de service ----------
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
  values ('egreso', 'Anulación cobro cta. cte. — ' || v_nombre, -m.monto, m.forma_pago, p_cc_id);
end $$;

revoke execute on function registrar_anticipo_encargo(bigint, numeric, text, text) from public, anon;
revoke execute on function aplicar_anticipo_encargo(bigint, bigint) from public, anon;
revoke execute on function revertir_anticipo_encargo(bigint) from public, anon;
grant  execute on function registrar_anticipo_encargo(bigint, numeric, text, text) to authenticated;
grant  execute on function aplicar_anticipo_encargo(bigint, bigint) to authenticated;
grant  execute on function revertir_anticipo_encargo(bigint) to authenticated;
