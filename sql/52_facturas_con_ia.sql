-- =====================================================================
-- GScom — Cargar compras desde la factura (PDF o fotos) leída con IA
-- · Bucket PRIVADO "facturas" (Storage): los archivos de cada factura. Solo los
--   usuarios administradores activos los suben, ven y borran (nunca el público).
-- · compras.archivos: rutas de los archivos de esa compra en el bucket.
-- · uso_ia: cada lectura con IA (modelo, tokens y costo estimado en US$), para
--   saber cuánto se consume. Lo escribe solo la función "leer-factura".
-- =====================================================================

alter table compras add column if not exists archivos jsonb not null default '[]'::jsonb;

create table if not exists uso_ia (
  id              bigint generated always as identity primary key,
  fecha           timestamptz not null default now(),
  usuario_id      uuid,
  tarea           text not null,
  modelo          text,
  tokens_entrada  int not null default 0,
  tokens_salida   int not null default 0,
  costo_usd       numeric(12,4) not null default 0,
  archivos        jsonb not null default '[]'::jsonb,
  resultado       text not null default ''
);
alter table uso_ia enable row level security;
drop policy if exists "usuarios activos leen" on uso_ia;
create policy "usuarios activos leen" on uso_ia for select to authenticated using (es_usuario_activo());
-- (sin política de escritura: solo la función, con la clave de servicio, agrega filas)

-- Storage: bucket privado para las facturas
insert into storage.buckets (id, name, public) values ('facturas', 'facturas', false) on conflict (id) do nothing;
drop policy if exists "gscom facturas ver" on storage.objects;
drop policy if exists "gscom facturas subir" on storage.objects;
drop policy if exists "gscom facturas borrar" on storage.objects;
create policy "gscom facturas ver"    on storage.objects for select to authenticated using (bucket_id = 'facturas' and es_usuario_activo());
create policy "gscom facturas subir"  on storage.objects for insert to authenticated with check (bucket_id = 'facturas' and es_usuario_activo());
create policy "gscom facturas borrar" on storage.objects for delete to authenticated using (bucket_id = 'facturas' and es_usuario_activo());
