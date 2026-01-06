# ERP Integration — Proyecto

Integración full‑stack para trabajar con ERPNext (Flask backend + React + Vite frontend).

## Descripción

Servicio proxy/API gateway en `backend/` que comunica con ERPNext, y una interfaz web en `frontend/`.

## Estado del proyecto

⚠️ **Pre-alpha / Experimental (para pruebas)**

Este proyecto está en desarrollo activo. Puede haber cambios incompatibles y errores.
Por ahora está pensado para:
- pruebas, aprendizaje y adopción temprana
- negocios con **bajo volumen** o uso “tranquilo” (no operación masiva)

Si tenés operación intensa o no podés tolerar interrupciones, usalo con cuidado y con soporte.

### Limitaciones conocidas (shortlist)
- Sin suite de tests completa todavía.
- AFIP/factura electrónica: en progreso (se puede operar emitiendo en AFIP y cargando en el sistema).
- Paginación: pendiente unificar `limit` usando *smart limit* desde `routes/general.py` (evitar hardcodes de `limit_page_length`).

## Quickstart (desarrollo)

Requisitos: Docker & Docker Compose o un entorno Python/Node local.

Usando Docker Compose (recomendado):

```bash
# desde la raíz del repo
docker-compose up --build
```

Ejecutar solo el backend en desarrollo:

```bash
cd backend
python app.py
```

Ejecutar solo el frontend en desarrollo:

```bash
cd frontend
npm install
npm run dev
```

## Configuración de entorno

Copiar los ejemplos de variables de entorno y rellenar con tus valores locales (NO subir credenciales al repo):

- [instrucciones.md](instrucciones.md) — instrucciones de setup detalladas.
- `.env.production.example` — plantilla para despliegue.

## Estructura de alto nivel

- `backend/` — Flask API, rutas y utilidades. Punto de entrada: [backend/app.py](backend/app.py).
- `frontend/` — React + Vite UI. Ver [frontend/package.json](frontend/package.json).
- `postman/` — colecciones de ejemplo (sanitizar antes de publicar).
- `scripts/` — utilidades y templates.

## Seguridad y privacidad

- No incluyas credenciales ni información personal en commits. Revisa y limpia `postman/`, `.env` y `backend/active_companies.json` antes de publicar.

## Contribuir

Si quieres contribuir, abre issues o PRs. Consultá `CONTRIBUTING.md` para el flujo de contribución y seguí las pautas de estilo y pruebas.

## Enlaces útiles

- [instrucciones.md](instrucciones.md)
- [backend/app.py](backend/app.py)
- [frontend/package.json](frontend/package.json)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)

## Licencia

Este repositorio se publica bajo la licencia AGPL-3.0. Ver [LICENSE] para el texto completo.


-----

# ERP Integration — Project

Full-stack integration to work with **ERPNext** (Flask backend + React + Vite frontend).

## Description

Proxy service / API gateway in `backend/` that communicates with ERPNext, plus a web interface in `frontend/`.

## Project status

⚠️ **Pre-alpha / Experimental (for testing)**

This project is under active development. Breaking changes and errors may occur.

For now, it is intended for:
- testing, learning and early adoption
- businesses with **low volume** or “calm” usage (not high-traffic / mission-critical operations)

If you run high-volume operations or cannot tolerate interruptions, use with caution and proper support.

### Known limitations (short list)

- No complete test suite yet.
- AFIP / electronic invoicing: work in progress  
  (it can be used by issuing invoices directly in AFIP and then loading them into the system).
- Pagination: pending unification of `limit` using *smart limit* from `routes/general.py`
  (avoid hardcoded `limit_page_length`).

## Quickstart (development)

Requirements: Docker & Docker Compose, or a local Python/Node environment.

Using Docker Compose (recommended):

bash
# from the repo root
docker-compose up --build
Run backend only (development):

bash

cd backend
python app.py
Run frontend only (development):

bash

cd frontend
npm install
npm run dev

## Environment configuration
Copy the environment variable examples and fill them with your local values
(DO NOT commit credentials to the repo):

instrucciones.md — detailed setup instructions

.env.production.example — deployment template

## High-level structure
backend/ — Flask API, routes and utilities
Entry point: backend/app.py

frontend/ — React + Vite UI
See: frontend/package.json


##  Security and privacy
Do not include credentials or personal data in commits.

Review and clean postman/, .env files and backend/active_companies.json before publishing.

## Contributing
If you want to contribute, please open issues or pull requests.
See CONTRIBUTING.md for contribution workflow and style/testing guidelines.

## Useful links

- [instrucciones.md](instrucciones.md)
- [backend/app.py](backend/app.py)
- [frontend/package.json](frontend/package.json)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)


## License
This repository is published under the AGPL-3.0 license.
See [LICENSE] for the full text.