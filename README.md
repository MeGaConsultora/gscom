# GScom — Gestión de local de informática

Ventas, stock con códigos de barras, clientes con historial, service técnico con seguimiento para el cliente, caja, compras y reportes.

## Estado actual: prototipo (modo DEMO)

La app funciona con **datos de ejemplo guardados en el navegador** (localStorage). Sirve para probar el uso real antes de conectar la base de datos.

Para abrirla en la computadora:

```bash
node tools/servidor.js
```

y entrar a http://localhost:5173 (no funciona abriendo el `index.html` con doble clic).

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` + `js/app.js` | App de gestión (todas las pantallas) |
| `seguimiento.html` + `js/seguimiento.js` | Página pública que ve el cliente (link/QR del comprobante) |
| `js/store.js` | Capa de datos. Hoy: modo demo. Se reemplaza por Supabase sin tocar las pantallas |
| `css/app.css` | Estilos |
| `img/` | Logo e íconos |
| `sql/01_esquema.sql` | Base de datos completa para Supabase (tablas, seguridad RLS, funciones) |

## Próximos pasos

1. Crear organización **GScom** (plan Free) y proyecto en Supabase.
2. Correr `sql/01_esquema.sql` en el SQL Editor.
3. Desactivar el registro público (Authentication → Sign In / Providers → "Allow new users to sign up" apagado) y crear los usuarios a mano. Activarlos con:
   `update perfiles set activo = true where id = (select id from auth.users where email = 'usuario@mail.com');`
4. Conectar `js/store.js` a Supabase y agregar login.
5. Repo en GitHub + GitHub Pages. Backup diario automático a un repo **privado**.

## Seguridad

- Toda tabla tiene RLS: solo usuarios con `perfiles.activo = true` acceden.
- El público solo puede llamar a `seguimiento_orden(token)`, que devuelve una sola orden por su token secreto (UUID imposible de adivinar), con el primer nombre del cliente y sin teléfono, DNI ni notas internas.
- La clave `anon` puede ir en el código; la `service_role` **nunca**.
