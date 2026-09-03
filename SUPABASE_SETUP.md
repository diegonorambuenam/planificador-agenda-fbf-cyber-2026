# Activar capacidades compartidas con Supabase

> La nueva configuración por usuario y código de activación está en [supabase/USERNAME_ACCESS.md](supabase/USERNAME_ACCESS.md). Las instrucciones siguientes corresponden al acceso anterior por correo; no aplicarlas al nuevo flujo.

La aplicación ya funciona en modo local. Al completar esta configuración, las capacidades se guardarán en Supabase y se actualizarán en vivo para los tres integrantes autorizados.

## 1. Crear y preparar el proyecto

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard/new).
2. Abre **SQL Editor**, copia el contenido de `supabase/migrations/001_shared_capacities.sql` y ejecútalo.
3. En el mismo editor, registra los tres correos reales en minúsculas:

```sql
insert into public.team_members (email, display_name) values
  ('persona1@empresa.com', 'Persona 1'),
  ('persona2@empresa.com', 'Persona 2'),
  ('persona3@empresa.com', 'Persona 3')
on conflict (email) do update
set display_name = excluded.display_name, active = true;
```

Los demás correos pueden autenticarse, pero las políticas RLS no les permiten leer ni modificar datos.

## 2. Configurar el acceso por correo

En **Authentication > URL Configuration**:

- Site URL: `https://diegonorambuenam.github.io/planificador-agenda-fbf-cyber-2026/`
- Redirect URL: agrega la misma dirección.

El acceso usa un enlace enviado por correo, sin contraseñas compartidas.

### Requisito: proveedor de correo SMTP

Configura un proveedor autorizado en **Authentication > Emails > SMTP Settings** antes de usar el acceso con el equipo. El correo integrado de Supabase solo envía a miembros de la organización administrativa de Supabase; registrar correos en `team_members` no elimina esa restricción. No es necesario dar acceso al panel administrativo a los usuarios de la aplicación.

Se requieren host, puerto, usuario, contraseña SMTP y dirección de remitente verificada. Las credenciales SMTP se guardan únicamente en Supabase, nunca en GitHub Pages ni en el repositorio.

Documentación: https://supabase.com/docs/guides/auth/auth-smtp

## 3. Conectar GitHub Pages

En Supabase abre **Project Settings > API** y copia:

- Project URL
- Publishable key (`sb_publishable_...`)

En GitHub abre **Settings > Secrets and variables > Actions > Variables** y crea:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Luego ejecuta nuevamente el workflow **Publicar en GitHub Pages** o haz un nuevo push a `main`.

La publishable key puede estar en el frontend: la protección real está en las políticas RLS. Nunca uses una secret key o service-role key en GitHub Pages.
