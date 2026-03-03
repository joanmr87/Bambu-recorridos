# Planificador de Recorridos Bambú

Aplicación web para que administración busque clientes desde Google Sheets en vivo, los seleccione y obtenga **3 recorridos optimizados** ordenados por distancia estimada.

## Funcionalidades

- Conexión en vivo a 2 Google Sheets de clientes (sin importar archivos manualmente).
- Cache local de clientes por 5 minutos para acelerar carga.
- Buscador por dirección con sugerencias en tiempo real.
- Selección de clientes por clic y armado de recorrido solo con seleccionados.
- Mapa interactivo con OpenStreetMap + Leaflet.
- Depósito por defecto en Ingeniero Huergo (editable) y retorno al depósito.
- Distancias reales de calle con OSRM (fallback automático a línea recta si no hay conexión).
- Generación de 3 rutas candidatas (heurística nearest-neighbor + mejora 2-opt).
- Marcadores numerados en mapa según el recorrido seleccionado (#1, #2 o #3).
- Selector para mostrar en mapa el orden de visita del Recorrido #1, #2 o #3.
- Cambio rápido de recorrido haciendo clic en la tarjeta del ranking.
- Generación de links de Google Maps para cada recorrido (abrir o copiar para enviar al repartidor).
- Botón para copiar mensaje listo para WhatsApp con los links del recorrido.
- Botón para generar URL del propio sistema en modo chofer (mapa + puntos numerados).
- Ranking con distancia total y tiempo estimado.

## Ejecutar local

1. Desde la carpeta del proyecto:

```bash
python3 -m http.server 8080
```

2. Abrir:

- [http://localhost:8080](http://localhost:8080)

Nota: para probar el proxy de Sheets de Netlify en local, conviene usar `netlify dev`.

## Deploy en Netlify

El proyecto ya está preparado con `netlify.toml` para deploy estático con fallback a `index.html`.
También incluye proxy de los 2 Google Sheets para evitar problemas de CORS en navegador.
Incluye botón de `Forzar actualización Sheets` para traer cambios inmediatos ignorando cache.

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

No hay carga manual de coordenadas. Los clientes se toman desde Google Sheets y se seleccionan desde el buscador.
