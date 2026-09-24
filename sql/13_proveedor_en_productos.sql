-- =====================================================================
-- GScom — "Proveedor habitual" de cada producto
-- (el script de importación de la planilla ya lo incluye; este archivo
-- queda para instalaciones nuevas)
-- =====================================================================
alter table productos add column if not exists proveedor_id bigint references proveedores(id) on delete set null;
create index if not exists idx_productos_proveedor on productos(proveedor_id);
