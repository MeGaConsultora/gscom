-- =====================================================================
-- GScom — Reorganización de categorías de productos.
-- Categorías finales: Impresión, Periféricos, Accesorios, Cables y
-- adaptadores, Almacenamiento, TV y Audio, Energía, Redes, Componentes,
-- Servicios, Otros.
-- Se renombran categorías existentes cuando hay una equivalencia clara
-- (mantiene el mismo id, no rompe nada que ya filtre por categoria_id).
-- Las que se dividen, se dividen por palabra clave en nombre/descripción;
-- lo que no matchea ninguna regla queda en "Otros" para revisar a mano.
-- =====================================================================

-- 1) Categoría nueva que no existía
insert into categorias (nombre) values ('Otros') on conflict (nombre) do nothing;

-- 2) Renombrar las que sobreviven como "ancla" de la categoría nueva
update categorias set nombre = 'Impresión' where nombre = 'Cartuchos y tintas';
update categorias set nombre = 'Cables y adaptadores' where nombre = 'Cables';
update categorias set nombre = 'Periféricos' where nombre = 'Mouse y teclados';
update categorias set nombre = 'TV y Audio' where nombre = 'Audio';
-- Redes, Energía, Almacenamiento, Accesorios, Componentes y Servicios ya tienen el nombre correcto: no se tocan

-- 3) Fusiones completas (todo el contenido de la categoría vieja pasa a la nueva)
-- Tóner + Papel -> Impresión
update productos set categoria_id = (select id from categorias where nombre = 'Impresión')
 where categoria_id in (select id from categorias where nombre in ('Tóner', 'Papel'));
delete from categorias where nombre in ('Tóner', 'Papel');

-- TV y streaming -> TV y Audio
update productos set categoria_id = (select id from categorias where nombre = 'TV y Audio')
 where categoria_id = (select id from categorias where nombre = 'TV y streaming');
delete from categorias where nombre = 'TV y streaming';

-- 4) Adaptadores y hubs: "hub" -> Accesorios, el resto -> Cables y adaptadores
update productos set categoria_id = (select id from categorias where nombre = 'Accesorios')
 where categoria_id = (select id from categorias where nombre = 'Adaptadores y hubs')
   and (nombre ilike '%hub%' or descripcion ilike '%hub%');
update productos set categoria_id = (select id from categorias where nombre = 'Cables y adaptadores')
 where categoria_id = (select id from categorias where nombre = 'Adaptadores y hubs');
delete from categorias where nombre = 'Adaptadores y hubs';

-- 5) Almacenamiento: SSD/M.2/NVMe -> Componentes, el resto se queda en Almacenamiento
update productos set categoria_id = (select id from categorias where nombre = 'Componentes')
 where categoria_id = (select id from categorias where nombre = 'Almacenamiento')
   and (nombre ilike '%ssd%' or nombre ilike '%m.2%' or nombre ilike '%m2%' or nombre ilike '%nvme%'
     or descripcion ilike '%ssd%' or descripcion ilike '%m.2%' or descripcion ilike '%nvme%');

-- 6) Gaming: auriculares/parlantes -> TV y Audio, mouse/teclado/joystick -> Periféricos, el resto -> Otros
update productos set categoria_id = (select id from categorias where nombre = 'TV y Audio')
 where categoria_id = (select id from categorias where nombre = 'Gaming')
   and (nombre ilike '%auricular%' or nombre ilike '%headset%' or nombre ilike '%parlante%'
     or descripcion ilike '%auricular%' or descripcion ilike '%headset%' or descripcion ilike '%parlante%');
update productos set categoria_id = (select id from categorias where nombre = 'Periféricos')
 where categoria_id = (select id from categorias where nombre = 'Gaming')
   and (nombre ilike '%mouse%' or nombre ilike '%teclado%' or nombre ilike '%joystick%' or nombre ilike '%gamepad%' or nombre ilike '%volante%'
     or descripcion ilike '%mouse%' or descripcion ilike '%teclado%' or descripcion ilike '%joystick%');
update productos set categoria_id = (select id from categorias where nombre = 'Otros')
 where categoria_id = (select id from categorias where nombre = 'Gaming');  -- lo que sobra, sin matchear ninguna regla
delete from categorias where nombre = 'Gaming';

-- 7) Red de seguridad: cualquier producto sin categoría o en una categoría
-- que no sea una de las finales, va a "Otros" (para revisar a mano)
update productos set categoria_id = (select id from categorias where nombre = 'Otros')
 where categoria_id is null
    or categoria_id not in (
      select id from categorias where nombre in
      ('Impresión','Periféricos','Accesorios','Cables y adaptadores','Almacenamiento','TV y Audio','Energía','Redes','Componentes','Servicios','Otros')
    );

-- Borra cualquier categoría sobrante que no sea una de las finales y haya quedado vacía
delete from categorias
 where nombre not in ('Impresión','Periféricos','Accesorios','Cables y adaptadores','Almacenamiento','TV y Audio','Energía','Redes','Componentes','Servicios','Otros')
   and id not in (select distinct categoria_id from productos where categoria_id is not null);

-- ---------- Verificación: correr después para revisar el resultado ----------
-- select coalesce(c.nombre, '(sin categoría)') as categoria, count(*) as productos
-- from productos p left join categorias c on c.id = p.categoria_id
-- group by 1 order by 2 desc;
