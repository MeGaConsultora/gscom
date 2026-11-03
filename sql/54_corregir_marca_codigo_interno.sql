-- =====================================================================
-- GScom — Corregir la marca "código interno" (los "int")
-- Los códigos que genera GScom tienen siempre 13 dígitos y empiezan con 20
-- (ej: 2000000000497). Algunos productos con código de FÁBRICA (ej: 6971690794194)
-- quedaron marcados como internos, seguramente desde la importación inicial:
-- se les saca la marca. No se cambia ningún código, solo la marca.
-- Al final muestra cuántos se corrigieron y cuántos quedan con código interno.
-- =====================================================================
with corregidos as (
  update productos set codigo_interno = false
   where codigo_interno and coalesce(codigo_barras, '') !~ '^20[0-9]{11}$'
  returning id
)
select (select count(*) from corregidos) as corregidos,
       (select count(*) from productos where codigo_interno and codigo_barras ~ '^20[0-9]{11}$') as siguen_con_codigo_interno;
