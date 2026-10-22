# Prompt 00 — Bootstrap del proyecto

Lee primero `CLAUDE.md`, `PROJECT.md`, `project/STATUS.md`, `project/ROADMAP.md` y todos los documentos técnicos pertinentes.

Trabaja en la Fase 0. Antes de escribir código, inspecciona el repositorio y las capacidades reales del entorno. No asumas que hay servicios, credenciales o infraestructura disponibles.

Entrega una propuesta breve de:
1. Stack viable para el entorno.
2. Arquitectura y estructura de carpetas.
3. Modelo de datos inicial.
4. Aislamiento multiempresa y autorización.
5. Estrategia de reservas concurrentes.
6. Estrategia de movimientos de inventario.
7. Riesgos principales y pruebas.

Después, si el entorno permite modificar y ejecutar el proyecto, inicializa una aplicación mínima con scripts reales de lint, typecheck, test y build, configuración segura y una primera migración cuando proceda.

No construyas todavía todos los módulos. No generes funciones ficticias. No guardes secretos en el repositorio. No ejecutes operaciones destructivas ni despliegues.

Al cerrar, actualiza `project/STATUS.md`, `project/ROADMAP.md` y `project/DECISIONS.md`. Informa de lo que se implementó realmente, comandos ejecutados, resultados y siguiente tarea.
