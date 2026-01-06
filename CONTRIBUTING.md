# Contributing

Gracias por querer contribuir. Pautas mínimas para PRs e issues.

1. Abrí un issue antes de implementar cambios grandes para discutir la propuesta.
2. Fork + branch con nombre descriptivo (`feat/xxx`, `fix/yyy`).
3. Ejecutá linters y tests antes de enviar PR:

```bash
# backend
cd backend
python -m venv .venv && .venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest

# frontend
cd frontend
npm install
npm test
```

4. Formato de código: sigue la convención existente; usamos `black`/`flake8` en Python.
5. Incluí tests para cambios de comportamiento y actualizá documentación si corresponde.
6. PR pequeño y enfocado: una funcionalidad por PR, con descripción y pasos para reproducir.

Si no estás seguro, preguntá en un issue y te orientamos.
