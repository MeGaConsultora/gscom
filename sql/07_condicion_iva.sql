-- GScom — Condición frente al IVA en clientes
-- Correr una sola vez en el SQL Editor de Supabase.

alter table clientes add column if not exists condicion_iva text not null default 'Consumidor Final'
  check (condicion_iva in ('Consumidor Final', 'Responsable Inscripto', 'Monotributo', 'Exento', 'No Responsable'));
