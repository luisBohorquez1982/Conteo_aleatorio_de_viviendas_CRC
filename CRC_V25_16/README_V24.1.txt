CRC V25

Corrección puntual de sincronización: el navegador bloqueaba la lectura de la respuesta del Web App de Google Apps Script por CORS, aunque el POST llegaba con HTTP 200. V25 utiliza una solicitud POST simple en modo no-cors y no intenta leer la respuesta. Se conserva la cola local y toda la lógica funcional de CRC.

IMPORTANTE: no se cambia SYNC_QUEUE_KEY para conservar los registros pendientes existentes.

CRC V18

Base funcional: CRC V16.4.
Cambio puntual: las listas de personal vuelven a filtrarse por REGION + DEPARTAMENTO + MUNICIPIO, como en las versiones anteriores, evitando que se mezclen equipos de otros municipios.
PERSONAL_CRC se conserva y se complementa con las geografias presentes en la muestra que no estaban en el archivo, manteniendo 2 supervisores y 5 encuestadores por supervisor.
No se modificaron las logicas de recorrido, reemplazos, historico, guardado, finalizacion o sincronizacion.


V19: corrección puntual de finalización. La meta y el conteo de efectivas para FINALIZAR se calculan a nivel de grupo (manzana padre + reemplazos), no únicamente sobre la última manzana. No se modifica la lógica restante.


--- V20.1 ---
Ajuste aislado del histórico: una sola fila por ciclo de manzana de muestra, con manzana padre, efectivas acumuladas y cantidad de reemplazos utilizados. La estructura interna de recorridos y reemplazos no se modifica.


V24: solo corrección de cache del navegador/service worker. Se mantiene el código funcional de V20.1; se versionó el shell y el JS para impedir que el navegador cargue un script cacheado anterior.


V24: cierre excepcional por agotamiento total. Si se recorren todas las viviendas disponibles del universo y todas las manzanas de reemplazo, sin alcanzar la meta, y no quedan pendientes ni falta resultado de manzana, se habilitan GUARDAR RECORRIDO PARCIAL y FINALIZAR Y GUARDAR RECORRIDO. La selección 20/20 (PRECARGA) y conteo diferente (ALEATORIO) se conserva sin cambios.


--- V24.1 ---
Ajustes puntuales sobre V24, sin modificar la lógica funcional restante:
1. Se elimina la restricción que impedía registrar un conteo real menor que la meta/faltantes. El conteo de campo se acepta tal como fue realizado y el sorteo opera sobre ese universo.
2. Las viviendas seleccionadas solo se muestran/habilitan después de clasificar la manzana como “Se puede trabajar”. Si se selecciona “No se puede trabajar”, se solicita obligatoriamente el motivo y su explicación y se activa la lógica de reemplazo.
3. El campo de explicación del motivo de manzana ocupa todo el ancho disponible.
No se modifican selección 20/20, selección aleatoria, reemplazos, histórico, guardado, finalización, sincronización u operación offline.


V25.2: se unificaron los avisos informativos del sistema en diálogos modales consistentes, manteniendo separado el diálogo de recuperación del formulario.
