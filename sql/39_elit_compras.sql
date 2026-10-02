-- =====================================================================
-- GScom — Elit, etapa 2: comprar desde Pedidos
-- · pedidos: cuándo se envió al carrito de Elit y cuándo se confirmó la
--   compra (con las notas de venta que devolvió Elit).
-- · elit_compras: registro de cada compra confirmada en Elit (quién, cuándo,
--   qué respondió Elit). Lo escribe la función "elit"; solo lo ven administradores.
-- =====================================================================

alter table pedidos add column if not exists elit_enviado_at    timestamptz;
alter table pedidos add column if not exists elit_confirmado_at timestamptz;
alter table pedidos add column if not exists elit_notas         jsonb;

create table if not exists elit_compras (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  usuario_id  uuid,
  pedido_id   bigint references pedidos(id) on delete set null,
  respuesta   jsonb
);
alter table elit_compras enable row level security;
drop policy if exists "usuarios activos" on elit_compras;
create policy "usuarios activos" on elit_compras for select to authenticated using (es_usuario_activo());
grant all on elit_compras to service_role;
grant update on pedidos to service_role;
