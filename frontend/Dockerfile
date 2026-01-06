# --- Etapa 1: Construcción (Build) ---
# Usamos una imagen de Node para compilar el React
FROM node:18-alpine AS build

WORKDIR /app/frontend

# Copiamos package.json y package-lock.json (o yarn.lock si usas yarn)
COPY frontend/package.json frontend/package-lock.json ./

# Instalamos dependencias
RUN npm install

# Copiamos el resto del código fuente del frontend
COPY frontend/ ./

# Copiamos los recursos compartidos para que el build tenga acceso a ellos
COPY shared /app/shared

# Construimos la app para producción (como me dijiste)
RUN npm run build

# --- Etapa 2: Servidor (Serve) ---
# Usamos una imagen de Nginx (un servidor web) súper ligera
FROM nginx:1.25-alpine

# Copiamos los archivos estáticos (el 'dist') que generamos en la Etapa 1
# al directorio web por defecto de Nginx
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Configuración personalizada de Nginx para manejar rutas del SPA
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Nginx se inicia solo, así que no necesitamos CMD
