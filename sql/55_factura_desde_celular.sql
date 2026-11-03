-- =====================================================================
-- GScom — Mandar las fotos de una factura desde el celular a la PC
-- La PC crea un pedido (un token, que va en el QR); el celular, con la sesión de
-- GScom iniciada, sube las fotos y marca el pedido como "subido"; la PC lo ve,
-- lee la factura con IA y sigue con la revisión. Vence a los 15 minutos y sirve una vez.
-- =====================================================================
create table if not exists factura_celular (
  token       uuid primary key default gen_random_uuid(),
  creado      timestamptz not null default now(),
  usuario_id  uuid default auth.uid(),
  estado      text not null default 'esperando' check (estado in ('esperando', 'subido')),
  archivos    jsonb not null default '[]'::jsonb
);
alter table factura_celular enable row level security;
drop policy if exists "usuarios activos" on factura_celular;
create policy "usuarios activos" on factura_celular for all to authenticated
  using (es_usuario_activo()) with check (es_usuario_activo());
-- limpieza: los pedidos de más de un día ya no sirven
delete from factura_celular where creado < now() - interval '1 day';
