/**
 * CRC - Backend V13 para Google Sheets.
 * Consolidado por idRecorrido + idVivienda.
 * Además conserva historial de eventos.
 */
const NOMBRE_HOJA = "RECORRIDOS_CRC";
const NOMBRE_HISTORIAL = "HISTORIAL_CRC";

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, servicio: "CRC", version: "V13" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const hoja = ss.getSheetByName(NOMBRE_HOJA) || ss.insertSheet(NOMBRE_HOJA);
    const historial = ss.getSheetByName(NOMBRE_HISTORIAL) || ss.insertSheet(NOMBRE_HISTORIAL);

    const encabezados = [
      "idRecorrido","estadoRecorrido","ultimaActualizacion","timestamp",
      "fecha","hora","supervisor","encuestador","region","departamento",
      "municipio","areaGeografica","mgn","tipoUnidad","conteoReal",
      "modoSeleccion","vivienda","idVivienda","orden","estado",
      "resultado","fuente","grupoId","efectivasGrupo","metaGrupo"
    ];

    const encabezadosHist = [
      "timestamp","evento","idRecorrido","estadoRecorrido","fecha","hora",
      "supervisor","encuestador","region","departamento","municipio",
      "areaGeografica","mgn","tipoUnidad","vivienda","idVivienda",
      "orden","estado","resultado","fuente","grupoId"
    ];

    inicializarEncabezados(hoja, encabezados);
    inicializarEncabezados(historial, encabezadosHist);

    const registros = Array.isArray(payload.registros) ? payload.registros : [payload];
    let guardados = 0;

    registros.forEach(r => {
      if (!r.idRecorrido) return;

      if (r.evento === "SNAPSHOT_RECORRIDO" || r.evento === "SELECCION_GENERADA" || r.evento === "RECORRIDO_PENDIENTE" || r.evento === "RECORRIDO_COMPLETO") {
        const viviendas = Array.isArray(r.viviendas) && r.viviendas.length
          ? r.viviendas
          : [r];

        const filas = viviendas.map(v => [
          r.idRecorrido,
          r.estadoRecorrido || "",
          r.ultimaActualizacion || "",
          new Date(),
          r.fecha || "",
          r.hora || "",
          r.supervisor || "",
          r.encuestador || "",
          r.region || "",
          r.departamento || "",
          r.municipio || "",
          r.areaGeografica || "",
          r.mgn || "",
          r.tipoUnidad || "",
          r.conteoReal || "",
          r.modoSeleccion || "",
          v.vivienda || r.vivienda || "",
          v.idVivienda || r.idVivienda || "",
          v.orden || r.orden || "",
          v.estado || r.estado || "",
          v.resultado || r.resultado || "",
          v.fuente || r.fuente || "",
          r.grupoId || "",
          r.efectivasGrupo || "",
          r.metaGrupo || ""
        ]);

        filas.forEach(fila => upsertFila(hoja, fila, 0, 17));
        guardados += filas.length;
      }

      historial.appendRow([
        new Date(), r.evento || "", r.idRecorrido || "", r.estadoRecorrido || "",
        r.fecha || "", r.hora || "", r.supervisor || "", r.encuestador || "",
        r.region || "", r.departamento || "", r.municipio || "",
        r.areaGeografica || "", r.mgn || "", r.tipoUnidad || "",
        r.vivienda || "", r.idVivienda || "", r.orden || "",
        r.estado || "", r.resultado || "", r.fuente || "", r.grupoId || ""
      ]);
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, guardados }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function inicializarEncabezados(hoja, encabezados) {
  if (hoja.getLastRow() === 0) hoja.appendRow(encabezados);
}

function upsertFila(hoja, fila, colIdRecorrido, colIdVivienda) {
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) {
    hoja.appendRow(fila);
    return;
  }

  const datos = hoja.getRange(2, 1, lastRow - 1, hoja.getLastColumn()).getValues();
  const idRecorrido = String(fila[colIdRecorrido] || "");
  const idVivienda = String(fila[colIdVivienda] || "");

  for (let i = datos.length - 1; i >= 0; i--) {
    if (
      String(datos[i][colIdRecorrido] || "") === idRecorrido &&
      String(datos[i][colIdVivienda] || "") === idVivienda
    ) {
      hoja.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
      return;
    }
  }

  hoja.appendRow(fila);
}
