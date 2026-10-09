-- =====================================================================
-- GScom — Presupuestos del armador guardados "tal cual se generan" + foto del equipo
-- · ordenes_servicio.foto_url: foto del equipo (se sube al bucket "productos", carpeta ordenes/).
--   Sale en el encabezado del presupuesto en PDF.
-- · orden_presupuestos: cada vez que se genera un presupuesto (PDF, WhatsApp o "Usar como
--   presupuesto") se guarda una copia congelada: componentes con sus precios de ese momento,
--   total, fecha y foto. Así se puede volver a imprimir/mandar exactamente lo que se le pasó
--   al cliente aunque después cambien los precios o los componentes de la orden.
--   No guarda costos ni proveedores.
-- =====================================================================

alter table ordenes_servicio add column if not exists foto_url text not null default '';

create table if not exists orden_presupuestos (
  id          bigint generated always as identity primary key,
  orden_id    bigint not null references ordenes_servicio(id) on delete cascade,
  version     int not null,
  fecha       timestamptz not null default now(),
  items       jsonb not null,            -- [{componente, descripcion, cantidad, precio_unitario}]
  total       numeric(14,2) not null,
  foto_url    text not null default '',
  usuario_id  uuid default auth.uid(),
  unique (orden_id, version)
);

alter table orden_presupuestos enable row level security;
drop policy if exists "usuarios activos" on orden_presupuestos;
create policy "usuarios activos" on orden_presupuestos for all to authenticated
  using (es_usuario_activo()) with check (es_usuario_activo());
