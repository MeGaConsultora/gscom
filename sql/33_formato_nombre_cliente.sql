-- =====================================================================
-- GScom — Formato del nombre de los clientes
-- · Apellido / razón social: todo en MAYÚSCULAS   (pérez → PÉREZ)
-- · Nombres: primera letra de cada nombre en mayúscula (maría josé → María José)
-- · Se sacan los espacios de más.
-- Se aplica solo al guardar (cualquier pantalla) y a los clientes ya cargados.
-- =====================================================================

create or replace function armar_nombre_cliente() returns trigger
language plpgsql as $$
begin
  new.apellido := upper(regexp_replace(btrim(coalesce(new.apellido, '')), '\s+', ' ', 'g'));
  new.nombres  := initcap(lower(regexp_replace(btrim(coalesce(new.nombres, '')), '\s+', ' ', 'g')));
  new.nombre := case
    when new.apellido <> '' and new.nombres <> '' then new.apellido || ', ' || new.nombres
    when new.apellido <> '' then new.apellido
    when new.nombres  <> '' then new.nombres
    else coalesce(new.nombre, '') end;
  return new;
end $$;

-- Clientes ya cargados: al "tocarlos", el trigger los deja con el formato nuevo
update clientes set apellido = apellido
 where apellido is distinct from upper(regexp_replace(btrim(apellido), '\s+', ' ', 'g'))
    or nombres  is distinct from initcap(lower(regexp_replace(btrim(nombres), '\s+', ' ', 'g')));
