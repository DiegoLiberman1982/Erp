# Usamos una imagen de Python limpia y ligera
FROM python:3.10-slim

# Creamos el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos SOLO el archivo de requisitos e instalamos dependencias primero
# (Esto aprovecha la caché de Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ahora sí, copiamos el resto de tu código
COPY . .

# Comando para correr tu app (como me dijiste)
CMD ["python", "app.py"]