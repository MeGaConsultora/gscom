-- =====================================================================
-- GScom — Avisos en tiempo real
-- Publica los cambios de orden_estados por Realtime, para que la app avise
-- al instante cuando un cliente responde un presupuesto desde su link.
-- Realtime respeta RLS: solo los usuarios activos reciben estos eventos.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orden_estados') then
    alter publication supabase_realtime add table orden_estados;
  end if;
end $$;
