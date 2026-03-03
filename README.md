# Planificador de Recorridos Bambú

Aplicación web para que administración cargue coordenadas de clientes, visualice puntos en mapa y obtenga **3 recorridos optimizados** ordenados por distancia estimada.

## Funcionalidades

- Carga de clientes en texto (dirección + coordenadas o nombre,lat,lng).
- Mapa interactivo con OpenStreetMap + Leaflet.
- Depósito por defecto en Ingeniero Huergo (editable) y retorno al depósito.
- Distancias reales de calle con OSRM (fallback automático a línea recta si no hay conexión).
- Generación de 3 rutas candidatas (heurística nearest-neighbor + mejora 2-opt).
- Marcadores numerados en mapa según el recorrido seleccionado (#1, #2 o #3).
- Selector para mostrar en mapa el orden de visita del Recorrido #1, #2 o #3.
- Cambio rápido de recorrido haciendo clic en la tarjeta del ranking.
- Generación de links de Google Maps para cada recorrido (abrir o copiar para enviar al repartidor).
- Botón para copiar mensaje listo para WhatsApp con los links del recorrido.
- Ranking con distancia total y tiempo estimado.

## Ejecutar local

1. Desde la carpeta del proyecto:

```bash
python3 -m http.server 8080
```

2. Abrir:

- [http://localhost:8080](http://localhost:8080)

## Deploy en Netlify

El proyecto ya está preparado con `netlify.toml` para deploy estático con fallback a `index.html`.

### Opción A: desde GitHub (recomendada)

1. Subí este proyecto a GitHub.
2. En Netlify, elegí **Add new site > Import an existing project**.
3. Seleccioná el repositorio.
4. Confirmá configuración:
   - Build command: *(vacío)*
   - Publish directory: `.`
5. Deploy.

### Opción B: por CLI

```bash
npm i -g netlify-cli
netlify deploy --dir .
netlify deploy --prod --dir .
```

## Formato de entrada admitido

### Formato 1 (dos líneas por cliente)

```text
GREGORIO MARTINEZ 1615, NEUQUEN
-38.938063, -68.081729
```

### Formato 2 (una línea por cliente)

```text
Cliente Centro,-38.9516,-68.0591
```

También acepta separación por punto y coma o espacios.
