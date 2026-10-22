# Prompt — Recuperar contexto en una nueva sesión

Vamos a continuar GastroFlow desde el estado persistente del repositorio, no desde la memoria de la conversación.

1. Lee `CLAUDE.md`, `PROJECT.md`, `project/STATUS.md`, `project/ROADMAP.md` y `project/DECISIONS.md`.
2. Inspecciona Git, los cambios sin guardar y los archivos relevantes.
3. Verifica qué se implementó realmente y qué pruebas existen.
4. Identifica errores abiertos y la siguiente tarea pendiente.
5. Resume el estado en pocas líneas antes de escribir código.
6. Continúa únicamente con una tarea pequeña y segura.
7. No repitas trabajo terminado ni confíes ciegamente en el estado documentado.
8. Al terminar, ejecuta las pruebas y actualiza el estado.

No realices cambios destructivos ni despliegues. No declares éxito sin evidencia.
