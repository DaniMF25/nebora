# Revisión de seguridad interna — 2026-11-01

Revisión hecha por el equipo de desarrollo (no independiente), orientada a OWASP ASVS 4.0 nivel 2 en las áreas que
aplican a Nébora hoy. **No es una auditoría ni demuestra que el producto sea seguro**: documenta qué se miró, qué se
encontró, qué se corrigió y qué queda abierto. Decisiones asociadas: D-044.

## Alcance y método

| Área (ASVS) | Qué se hizo |
| --- | --- |
| V14 Dependencias | `pnpm audit` (todas y solo producción). |
| V6/V14 Secretos | Búsqueda de claves, tokens y contraseñas en el árbol y en todo el historial de Git; revisión de `docker-compose.yml` y `.env.example`. |
| V4 Control de acceso | Funciones `SECURITY DEFINER` (search_path, permiso EXECUTE de PUBLIC) y tablas sin RLS, consultando el catálogo de PostgreSQL. |
| V5 Inyección | Búsqueda de SQL construido con interpolación en `src/`. |
| V5/V14 XSS y CSP | Sumideros (`dangerouslySetInnerHTML`, URL construidas con datos del local), cabeceras HTTP y CSP. |
| V13/V4 CSRF | Server Actions (protección de origen de Next) y Route Handlers propios. |
| V2/V3 Autenticación y sesiones | Hash de contraseñas, límites de intentos, creación, renovación, revocación y cookie de sesión. |
| V7 Errores y registros | Mensajes al usuario y `console.error` del servidor. |
| V12 Archivos | Subida y servicio de imágenes. |
| V5 Redirecciones | `safeRedirectPath` y sus usos. |

## Hallazgos

| # | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| 1 | Alta (dependencia de producción) | `zod` 4.1.12: GHSA-mrhx-c7xc-m3w5, agotamiento de memoria al validar colecciones enormes con restricciones. | Corregido: `zod` 4.6.7. |
| 2 | Media | CSP sin `script-src`: un fallo de escape habría permitido ejecutar scripts en línea. | Corregido: CSP con nonce por petición y `'strict-dynamic'` (`src/proxy.ts`). |
| 3 | Media | La exportación de privacidad comparaba `Origin` con `request.url`; tras un proxy que termina TLS, la URL interna es `http://` y habría rechazado peticiones legítimas (y la tentación de quitar la comprobación). | Corregido: `isSameOrigin` compara con `Host`/`X-Forwarded-Host`. |
| 4 | Baja | Iniciar sesión (o registrarse, o aceptar una invitación) en un navegador con otra sesión sustituía la cookie sin revocar la anterior en el servidor, que seguía siendo válida hasta caducar. | Corregido: `setSessionCookie` revoca la sesión previa. |
| 5 | Baja | Sin HSTS ni `Cross-Origin-Opener-Policy`. | Corregido: HSTS (solo si se sirve por HTTPS) y COOP `same-origin`. |
| 6 | Informativa | Dos funciones de disparador `SECURITY DEFINER` conservaban EXECUTE para PUBLIC (no invocables directamente: riesgo nulo). | Corregido: migración 0029 y prueba que lo exige para todas. |
| 7 | Baja (solo desarrollo) | `vitest` 4.1.11: dos avisos moderados en `@vitest/mocker`. | Corregido: `vitest` 4.1.12. |
| 8 | Baja (solo desarrollo) | `minimatch` (vía ESLint 9): 2 avisos moderados de expresiones regulares lentas. ESLint 9 exige minimatch 3. | Aceptado: no llega a producción (`pnpm audit --prod` sin avisos); revisar al actualizar ESLint. |

Sin hallazgos en:

- **Secretos:** ninguno en el árbol ni en el historial (solo marcadores y variables). Las contraseñas por defecto de
  `docker-compose.yml` son solo locales: la BD no se expone y la web escucha en 127.0.0.1.
- **SQL:** solo se interpolan constantes, nombres de tabla literales o claves de esquemas estrictos en lista blanca;
  los valores van siempre parametrizados.
- **XSS:** no hay `dangerouslySetInnerHTML`. Los datos de contacto que acaban en enlaces se validan: WhatsApp solo
  dígitos, Instagram como nombre de usuario, teléfono filtrado y dirección de mapas codificada.
- **Autenticación:**
  - contraseñas con scrypt, sal aleatoria y comparación en tiempo constante, más un hash ficticio para no revelar si
    existe el usuario;
  - límites por correo y por IP;
  - token de sesión de 256 bits del que solo se guarda su sha256;
  - cookie `HttpOnly`, `SameSite=Lax` y `Secure` con prefijo `__Host-` en producción;
  - cada inicio de sesión crea un token nuevo, así que no cabe la fijación de sesión;
  - el cierre de sesión la revoca en la BD.
- **Errores:** al usuario solo le llegan mensajes controlados. Los registros guardan el nombre del error o el mensaje
  de la BD, sin datos de formularios, tokens ni contraseñas.
- **Imágenes:**
  - límite de 8 MB y de píxeles;
  - tipo comprobado por su firma (no por la extensión);
  - recodificación a WebP sin metadatos;
  - cupo por organización;
  - se sirven solo si las usa contenido publicado, con `default-src 'none'`;
  - no se aceptan SVG subidos.
- **Redirecciones:** `safeRedirectPath` solo admite rutas internas (rechaza `//`, `\`, esquemas y caracteres de
  control), con pruebas unitarias.

## Riesgos aceptados o abiertos

- `style-src 'unsafe-inline'`: React y Next aplican estilos en línea (p. ej. el color de marca). El riesgo es menor
  que en scripts, pero permite inyectar CSS si fallara un escape.
- Tablas de identidad (`users`, `sessions`, `auth_login_attempts`) sin RLS: solo las usa el módulo de autenticación, y
  el rol de la aplicación tiene permisos por columna.
- Las páginas públicas (GET) no tienen límite de peticiones; corresponde a la infraestructura (proxy o CDN). Los
  formularios públicos sí lo tienen.
- Las páginas se renderizan por petición (necesario para el nonce): no hay caché estática. Hay que medir el coste con
  carga real.
- El registro revela si un correo existe (desactivado por defecto) y el bloqueo por correo permite bloquear 15
  minutos a un usuario legítimo (ya en `project/STATUS.md`).
- Sin MFA, verificación de correo ni recuperación de contraseña (requieren proveedor de correo).

## No revisado

- Revisión independiente o prueba de intrusión.
- Configuración real del despliegue: TLS, proxy, cabecera de IP del cliente, cortafuegos, copias y su restauración.
- Análisis estático automatizado (SAST) y escaneo de imágenes Docker.
- Navegadores distintos de Chromium para la CSP (Safari y Firefox no se pueden ejecutar en este entorno).
- Accesibilidad, rendimiento y denegación de servicio con carga.

## Evidencias

Pruebas añadidas:

- `tests/e2e/csp.spec.ts`:
  - cabeceras;
  - nonce distinto en cada petición y el mismo en todos los scripts;
  - un control positivo comprueba que un `onclick` inyectado se bloquea y que el detector lo registra;
  - el panel y la web pública funcionan sin violaciones.
- `tests/e2e/layout-spacing.spec.ts`: 27 páginas sin violaciones de CSP.
- `tests/e2e/tenant-isolation.spec.ts`: la sesión anterior se revoca al iniciar otra.
- `tests/unit/proxy-headers.test.ts` y `tests/unit/same-origin.test.ts`.
- `tests/integration/migrations.test.ts`: ninguna función `SECURITY DEFINER` es ejecutable por PUBLIC y todas fijan
  `search_path`.

Mutaciones (cambio temporal, revertido) que hicieron fallar las pruebas:

- `script-src` sin nonce;
- nonce fijo o distinto del de la respuesta;
- sin revocar la sesión anterior (la cookie antigua seguía entrando en `/app`);
- sin el `REVOKE` de `app.menu_specials_product_available()`.
