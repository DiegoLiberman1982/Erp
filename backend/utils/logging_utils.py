# logging_utils.py - Utilidades de logging y cacheo para optimizar rendimiento

import functools
import time
from typing import Dict, Any, Optional

# Cache global para evitar múltiples llamadas a las mismas funciones
_function_cache: Dict[str, Dict[str, Any]] = {}
_cache_ttl = 30  # TTL de 30 segundos para el cache

def cached_function(ttl: int = 30):
    """
    Decorador para cachear resultados de funciones y evitar llamadas repetidas
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Crear una clave única para esta llamada
            cache_key = f"{func.__name__}_{hash(str(args) + str(sorted(kwargs.items())))}"
            current_time = time.time()
            
            # Verificar si tenemos un resultado cacheado válido
            if cache_key in _function_cache:
                cached_result, cached_time = _function_cache[cache_key]
                if current_time - cached_time < ttl:
                    # print(f"🔄 Cache HIT para {func.__name__}")
                    return cached_result
            
            # Ejecutar la función y cachear el resultado
            result = func(*args, **kwargs)
            _function_cache[cache_key] = (result, current_time)
            # print(f"💾 Cache MISS para {func.__name__} - resultado cacheado")
            
            return result
        return wrapper
    return decorator

def clear_cache():
    """Limpiar todo el cache"""
    global _function_cache
    _function_cache.clear()

def is_debug_mode() -> bool:
    """Determinar si estamos en modo debug basado en variables de entorno"""
    import os
    return os.getenv('DEBUG', 'False').lower() in ['true', '1', 'yes']

def conditional_log(message: str, level: str = "info", force: bool = False):
    """
    Log condicional - solo muestra logs detallados si estamos en modo debug
    o si se fuerza la salida
    """
    if force or is_debug_mode():
        print(f"[{level.upper()}] {message}")

def log_function_call(func_name: str, minimal: bool = False):
    """Log de llamada a función - versión mínima o completa según configuración"""
    if minimal:
        conditional_log(f"→ {func_name}", "debug")
    else:
        conditional_log(f"🔍 Ejecutando: {func_name}", "debug")

def log_search_operation(operation: str, details: str = ""):
    """Log específico para operaciones de búsqueda - siempre se muestra"""
    print(f"🔍 {operation}: {details}")

def log_error(error_msg: str, func_name: str = ""):
    """Log de errores - siempre se muestra"""
    prefix = f"❌ [{func_name}]" if func_name else "❌"
    print(f"{prefix} {error_msg}")

def log_success(success_msg: str, func_name: str = ""):
    """Log de éxito - versión condensada"""
    prefix = f"✅ [{func_name}]" if func_name else "✅"
    conditional_log(f"{prefix} {success_msg}", "info")