-- =====================================================================
-- GScom — A qué se aplica cada cobro de cuenta corriente
-- Permite cobrar un concepto en particular (una venta, un service o un
-- cargo manual) y que el recibo detalle qué se pagó.
-- "grupo" identifica el concepto: 'venta:ID', 'orden:ID' o 'cargo:ID'.
-- Los cobros sin imputación se aplican a lo más viejo primero (en la app).
-- =====================================================================

create table if not exists cc_imputaciones (
  id        bigint generated always as identity primary key,
  pago_id   bigint not null references cc_movimientos(id) on delete cascade,
  grupo     text   not null check (grupo ~ '^(venta|orden|cargo):[0-9]+$'),
  monto     numeric(14,2) not null check (monto > 0)
);
create index if not exists idx_cc_imputaciones_pago on cc_imputaciones(pago_id);

alter table cc_imputaciones enable row level security;
drop policy if exists "usuarios activos" on cc_imputaciones;
create policy "usuarios activos" on cc_imputaciones for all to authenticated using (es_usuario_activo()) with check (es_usuario_activo());

-- Cobro con imputación, todo en una sola operación
-- p_imputaciones: [{"grupo": "venta:5", "monto": 24900}, ...]
create or replace function cobrar_cuenta_imputado(
  p_cliente_id bigint, p_monto numeric, p_forma_pago text, p_nota text, p_imputaciones jsonb
) returns bigint language plpgsql as $$
declare v_id bigint; v_suma numeric;
begin
  select coalesce(sum((x->>'monto')::numeric), 0) into v_suma from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) x;
  if v_suma > p_monto + 0.009 then raise exception 'Lo imputado supera el monto cobrado'; end if;
  v_id := cobrar_cuenta(p_cliente_id, p_monto, p_forma_pago, p_nota);   -- valida permisos, registra pago y caja
  insert into cc_imputaciones (pago_id, grupo, monto)
  select v_id, x->>'grupo', (x->>'monto')::numeric
    from jsonb_array_elements(coalesce(p_imputaciones, '[]'::jsonb)) x
   where (x->>'monto')::numeric > 0;
  return v_id;
end $$;

revoke execute on function cobrar_cuenta_imputado(bigint, numeric, text, text, jsonb) from public, anon;
grant  execute on function cobrar_cuenta_imputado(bigint, numeric, text, text, jsonb) to authenticated;
