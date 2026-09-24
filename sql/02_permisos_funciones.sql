-- =====================================================================
-- GScom — Permisos de funciones
-- El público (anon) solo puede ejecutar seguimiento_orden. Todas las demás
-- funciones quedan reservadas a usuarios logueados.
-- =====================================================================

revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function seguimiento_orden(uuid) to anon;

-- Lo mismo para funciones que se creen en el futuro
alter default privileges in schema public revoke execute on functions from public, anon;
