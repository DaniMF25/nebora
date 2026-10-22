# GastroFlow — Kit de inicio para Claude

Este paquete contiene la documentación y las instrucciones iniciales para desarrollar GastroFlow, un SaaS multiempresa de gestión de restaurantes.

## Cómo empezar

1. Crea un repositorio **privado** en GitHub.
2. Descomprime este ZIP en la raíz del repositorio y sube los archivos.
3. Abre el repositorio en Claude Code o conecta el repositorio a la herramienta de Claude que vayas a utilizar.
4. Pide a Claude que lea `CLAUDE.md` y los documentos de `docs/` y `project/`.
5. Sigue `prompts/00-BOOTSTRAP.md`. No le pidas que genere toda la aplicación de golpe.
6. Cuando termine cada tarea, revisa los cambios, las pruebas y el estado antes de aceptar un commit.

## Qué incluye

- `CLAUDE.md`: instrucciones persistentes para Claude Code.
- `PROJECT.md`: alcance y objetivos del producto.
- `docs/`: arquitectura, seguridad, datos, pruebas y operaciones.
- `project/ROADMAP.md`: fases de trabajo.
- `project/STATUS.md`: punto de control inicial.
- `project/DECISIONS.md`: registro de decisiones técnicas.
- `prompts/`: prompts de inicio, trabajo por tarea y recuperación de contexto.
- `.gitignore`: evita subir secretos y archivos generados.

## Importante

Este paquete es un **starter de documentación**, no una aplicación implementada ni una certificación de seguridad. No contiene una aplicación funcional, credenciales ni infraestructura ya desplegada. Claude debe construir el producto fase por fase, ejecutar pruebas reales y documentar las limitaciones.

No subas nunca `.env` con secretos reales. Usa `.env.example` como plantilla y un gestor de secretos para entornos desplegados.
