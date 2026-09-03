# Acceso por usuario: reemplaza la configuración por correo

Solo las capacidades se comparten. Agenda, importaciones e historial siguen locales. GitHub Pages contiene únicamente código público.

## Antes de publicar

Ejecutar `002_username_access.sql` después de 001, como **postgres** en SQL Editor. Reemplaza la autorización por correo sin borrar capacidades. Coordinar con el despliegue del frontend nuevo.

Incluye personalizaciones de Auth (trigger y activación SQL): compilar el frontend no valida su seguridad. Probar también después de actualizaciones de Supabase Auth.

Deshabilitar nuevos registros, login anónimo y vinculación manual de identidades. Mantener Email/password y límites de intentos; no habilitar otros proveedores. Los alias `usuario@fbf.invalid` son internos, no buzones: no usar recuperación por correo.

## Alta privada

Crear los tres usuarios en Authentication > Users con sus alias internos, contraseña temporal aleatoria y Auto Confirm User. El administrador introduce las credenciales allí, nunca en el repositorio.

En SQL Editor, sustituir únicamente el alias en esta consulta. El código se genera en la base y se devuelve una sola vez, sin guardarse en texto plano:

```sql
select private.issue_fbf_activation(id, split_part(email, '@', 1)) as codigo_privado
from auth.users where email = 'usuario@fbf.invalid';
```

El administrador entrega cada resultado directamente a su destinatario por un canal privado. No exportar códigos a GitHub, tickets, commits o logs. Caducan a los siete días. La función permite como máximo tres cuentas; la lista real está en el esquema privado, no en las migraciones.

Cada integrante entra con usuario y código, crea contraseña (12 caracteres como mínimo, 72 bytes UTF-8 como máximo) y vuelve a ingresar con ella. La sesión de activación nunca puede leer ni guardar capacidades.

## Restablecimiento administrativo

Ejecutar la misma consulta de emisión: invalida el acceso anterior y permite elegir otra contraseña mediante un código nuevo. El cambio directo del Dashboard también puede quedar bloqueado por el trigger; usar la función de SQL Editor. No quitar la protección ni entregar service-role al navegador.

Para suspender una cuenta, modificar `active` a false en `private.fbf_accounts` desde SQL Editor.

## Pruebas obligatorias

- Anónimo, no registrado y pendiente: sin lectura ni escritura de capacidades.
- Código vencido: sin activación.
- Activación válida: nuevo login funciona y el código anterior no.
- Activación repetida/concurrente: solo una operación tiene éxito.
- JWT obtenido con código: sin capacidades después de activar o refrescar.
- Cambios de password, email o teléfono mediante Auth API: rechazados.
- Restablecimiento administrativo: acceso previo revocado, nuevo código válido.
- Dos integrantes ven los cambios; fallo de red no aparece como guardado.

## GitHub

Solo las variables públicas `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` van al frontend. Nunca secret/service-role, usuarios reales, contraseñas, códigos ni resultados SQL. No guardar secretos en el repo aunque estén ignorados. El código y los commits de implementación sí serán públicos.

`.gitignore` no elimina secretos ya publicados: si ocurre, revocarlos y revisar también el historial.

Si el trigger afecta al login normal, no publicar hasta resolver permisos y roles. No quitarlo con cuentas habilitadas: suspender primero el acceso y realizar una recuperación coordinada.

Referencias: [contraseñas](https://supabase.com/docs/guides/auth/password-security), [sesiones](https://supabase.com/docs/guides/auth/sessions), [triggers de Auth](https://supabase.com/docs/guides/troubleshooting/dashboard-errors-when-managing-users-N1ls4A).
