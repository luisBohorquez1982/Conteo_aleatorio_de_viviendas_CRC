// ==================================================
// CRC - Selector Aleatorio de Viviendas
// Versión 25.4 - recuperación offline, avisos CRC y control explícito de versión
// ==================================================

const CONFIG = {
    // Pegaremos aquí la URL /exec de Google Apps Script cuando publiquemos
    // el backend. Si queda vacío, la aplicación funciona 100% local/offline
    // y conserva la información en el dispositivo.
    SYNC_URL: "https://script.google.com/macros/s/AKfycbzaxSqkdJdubTYFsQH8BAXivSnZpXv1cavjo-ryUs-CEB15FbNzMr5f_ZZI31eYyu0tkg/exec"
};

const SYNC_QUEUE_KEY = "CRC_V15_SYNC_QUEUE";
const RECORD_PREFIX = "CRC_V15_REC|";
const DRAFT_KEY = "CRC_V25_DRAFT_FORM_V25_4";
const LEGACY_DRAFT_KEYS = ["CRC_V25_DRAFT_FORM"];

const app = {
    datosCargados: false,
    muestra: [],
    distribucion: { nivel: [], cruces: [], encXmanzana: [] },
    reemplazosManzanas: [],
    reemplazosViviendas: [],
    personal: [],

    manzanas: new Map(),
    viviendasPorMgn: new Map(),
    reemplazosViviendaPorMgn: new Map(),
    grupos: new Map(),

    viviendas: [],
    llaveActual: null,
    grupoActual: null,
    manzanaActual: null,
    conteoRealActual: null,
    modoSeleccionActual: null,
    reemplazoManzanaActual: 0,
    historialManzanas: [],
    idRecorrido: null,
    estadoRecorrido: "NUEVO",
    ultimaActualizacion: null,
    fechaTrabajo: null,
    modoSoloLectura: false,
    sincronizacionActual: "PENDIENTE",
    resultadoManzana: "",
    motivoManzana: "",
    detalleMotivoManzana: "",
    motivoManzanaCompleto: ""
};

window.addEventListener("load", iniciar);

function iniciar() {
    actualizarFechaHora();
    setInterval(actualizarFechaHora, 1000);

    document.getElementById("btnGenerar").addEventListener("click", generarSeleccion);
    const btnSync = document.getElementById("btnSincronizar");
    if (btnSync) btnSync.addEventListener("click", () => sincronizarCola(true));

    document.getElementById("region").addEventListener("change", cargarDepartamentos);
    document.getElementById("departamento").addEventListener("change", cargarMunicipios);
    document.getElementById("municipio").addEventListener("change", cargarAreas);
    document.getElementById("areaGeografica").addEventListener("change", cargarManzanas);
    document.getElementById("supervisor").addEventListener("change", cargarEncuestadores);
    const campoManzana = document.getElementById("manzana");
    campoManzana.addEventListener("input", filtrarManzanas);
    campoManzana.addEventListener("focus", () => mostrarOpcionesManzana(true));
    campoManzana.addEventListener("click", () => mostrarOpcionesManzana(true));
    campoManzana.addEventListener("keydown", navegarOpcionesManzana);
    document.addEventListener("click", (event) => {
        const selector = document.querySelector(".mgn-selector");
        if (selector && !selector.contains(event.target)) ocultarOpcionesManzana();
    });
    document.getElementById("conteoReal").addEventListener("input", () => {
        actualizarEstadoConteo();
        guardarBorradorLocal();
    });

    ["region", "departamento", "municipio", "areaGeografica", "supervisor", "encuestador", "manzana"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("change", guardarBorradorLocal);
        el.addEventListener("input", guardarBorradorLocal);
    });

    // El borrador se conserva ante refresh/cierre accidental de la pestaña.
    window.addEventListener("beforeunload", guardarBorradorLocal);
    window.addEventListener("pagehide", guardarBorradorLocal);

    actualizarEstadoRed();
    window.addEventListener("online", actualizarEstadoRed);
    window.addEventListener("offline", actualizarEstadoRed);
    window.addEventListener("online", sincronizarCola);

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw_v25_13.js?v=25.16.1").catch(error => {
            console.warn("No fue posible registrar el modo offline:", error);
        });
    }

    cargarDatosProduccion();
    actualizarBotonesRecorrido();
}

function actualizarEstadoRed() {
    const el = document.getElementById("estadoRed");
    if (!el) return;
    actualizarEstadoSync();
    if (navigator.onLine) sincronizarCola();
}

const OPERATIVOS_DB = "CRC_V25_OPERATIVOS";
const OPERATIVOS_STORE = "datos";
const OPERATIVOS_KEY = "Muestra_V5.1";

function abrirDBOperativos() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB no está disponible en este dispositivo."));
            return;
        }

        const request = indexedDB.open(OPERATIVOS_DB, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(OPERATIVOS_STORE)) {
                db.createObjectStore(OPERATIVOS_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No fue posible abrir el almacenamiento offline."));
    });
}

async function guardarDatosOperativosOffline(datos) {
    try {
        const db = await abrirDBOperativos();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(OPERATIVOS_STORE, "readwrite");
            tx.objectStore(OPERATIVOS_STORE).put(datos, OPERATIVOS_KEY);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("No fue posible guardar los datos operativos offline."));
            tx.onabort = () => reject(tx.error || new Error("No fue posible guardar los datos operativos offline."));
        });
        db.close();
        console.info("CRC: datos operativos guardados en almacenamiento offline.");
        return true;
    } catch (error) {
        console.warn("CRC: no fue posible guardar la copia offline de los datos:", error);
        return false;
    }
}

async function obtenerDatosOperativosOffline() {
    const db = await abrirDBOperativos();
    const datos = await new Promise((resolve, reject) => {
        const tx = db.transaction(OPERATIVOS_STORE, "readonly");
        const request = tx.objectStore(OPERATIVOS_STORE).get(OPERATIVOS_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("No fue posible leer los datos operativos offline."));
    });
    db.close();
    return datos;
}

function aplicarDatosOperativos(datos) {
    app.muestra = datos.muestra || [];
    app.distribucion.nivel = datos.distribucion?.nivel || [];
    app.distribucion.cruces = datos.distribucion?.cruces || [];
    app.distribucion.encXmanzana = datos.distribucion?.encXmanzana || [];
    app.reemplazosManzanas = datos.reemplazosManzanas || [];
    app.reemplazosViviendas = datos.reemplazosViviendas || [];
    app.personal = datos.personal || [];

    validarEstructura();
    construirIndices();
    app.datosCargados = true;

    cargarRegiones();
    habilitar("region", "departamento", "municipio", "areaGeografica", "manzana", "supervisor", "encuestador", "btnGenerar");
    renderizarHistorico();
    mostrarResumenDatos();
    ofrecerRecuperacionBorrador();
}

async function cargarDatosProduccion() {
    const archivos = {
        muestra: "./data/Muestra_V5.1.xlsx",
        distribucion: "./data/Muestra_V5.1_Distribucion.xlsx",
        reemplazosManzanas: "./data/Muestra_V5.1_reemplazos_manzanas.xlsx",
        reemplazosViviendas: "./data/Muestra_V5.1_reemplazos_viviendas.xlsx",
        personal: "./data/PERSONAL_CRC.xlsx"
    };

    try {
        cambiarEstado(
            navigator.onLine
                ? "Cargando datos operativos..."
                : "Sin conexión. Recuperando datos operativos del dispositivo...",
            "carga"
        );

        /*
         * REGLA CRÍTICA:
         * Una vez que los datos operativos fueron cargados al menos una vez
         * con Internet, el aplicativo NO vuelve a depender de XLSX para
         * funcionar offline ni después de un refresh.
         *
         * Con Internet: intenta actualizar desde los Excel.
         * Sin Internet: recupera directamente la copia estructurada de
         * IndexedDB, sin ejecutar XLSX.
         *
         * Si una actualización online falla, también intenta la copia local.
         */
        if (!navigator.onLine) {
            const datosOffline = await obtenerDatosOperativosOffline();

            if (!datosOffline) {
                throw new Error("No existe una copia de los datos operativos en este dispositivo. Debe abrir la aplicación al menos una vez con Internet.");
            }

            aplicarDatosOperativos(datosOffline);
            cambiarEstado(
                "Datos operativos recuperados del almacenamiento offline. Lista para operar.",
                "ok"
            );
            return;
        }

        const respuestas = await Promise.all(
            Object.entries(archivos).map(async ([clave, url]) => {
                const respuesta = await fetch(url, { cache: "default" });
                if (!respuesta.ok) throw new Error("No se pudo cargar " + url);
                return [clave, await respuesta.arrayBuffer()];
            })
        );

        const buffers = Object.fromEntries(respuestas);

        if (typeof XLSX === "undefined") {
            throw new Error("La librería XLSX no está disponible para actualizar los datos operativos.");
        }

        const [wbMuestra, wbDistribucion, wbRM, wbRV, wbPersonal] = await Promise.all([
            Promise.resolve(XLSX.read(buffers.muestra, { type: "array" })),
            Promise.resolve(XLSX.read(buffers.distribucion, { type: "array" })),
            Promise.resolve(XLSX.read(buffers.reemplazosManzanas, { type: "array" })),
            Promise.resolve(XLSX.read(buffers.reemplazosViviendas, { type: "array" })),
            Promise.resolve(XLSX.read(buffers.personal, { type: "array" }))
        ]);

        const datos = {
            version: "V25.16",
            guardado: new Date().toISOString(),
            muestra: hojaComoObjetos(wbMuestra, wbMuestra.SheetNames[0]),
            distribucion: {
                nivel: hojaComoObjetos(wbDistribucion, "Nivel"),
                cruces: hojaComoObjetos(wbDistribucion, "Cruces"),
                encXmanzana: hojaComoObjetos(wbDistribucion, "EncXmanzana")
            },
            reemplazosManzanas: hojaComoObjetos(wbRM, wbRM.SheetNames[0]),
            reemplazosViviendas: hojaComoObjetos(wbRV, wbRV.SheetNames[0]),
            personal: hojaComoObjetos(wbPersonal, wbPersonal.SheetNames[0])
        };

        aplicarDatosOperativos(datos);

        // La copia estructurada queda disponible para futuros refresh offline.
        await guardarDatosOperativosOffline(datos);

        cambiarEstado(
            "Datos operativos cargados. Lista para operar en línea y offline.",
            "ok"
        );

    } catch (error) {
        console.warn("CRC: carga online de datos operativos falló:", error);

        // Si falla la carga online, nunca dejamos inutilizable la aplicación
        // si ya existe una copia válida en el dispositivo.
        try {
            const datosOffline = await obtenerDatosOperativosOffline();

            if (datosOffline) {
                aplicarDatosOperativos(datosOffline);
                cambiarEstado(
                    navigator.onLine
                        ? "No se pudieron actualizar los datos. Se utilizará la última copia válida guardada en el dispositivo."
                        : "Datos operativos recuperados del almacenamiento offline. Lista para operar.",
                    "ok"
                );
                return;
            }
        } catch (fallbackError) {
            console.warn("CRC: tampoco fue posible recuperar la copia offline:", fallbackError);
        }

        console.error(error);
        app.datosCargados = false;
        cambiarEstado("No fue posible cargar los datos operativos.", "error");
        mostrarAvisoCRC(
            "No fue posible cargar los datos de producción.\n\n" +
            "La aplicación no tiene todavía una copia operativa válida guardada en este dispositivo.\n\n" +
            error.message
        );
    }
}

function actualizarFechaHora() {
    const ahora = new Date();
    document.getElementById("fecha").value = ahora.toLocaleDateString("es-CO");
    document.getElementById("hora").value = ahora.toLocaleTimeString("es-CO");
}

function texto(valor) {
    if (valor === null || valor === undefined) return "";
    return String(valor).trim();
}

function normalizar(valor) {
    return texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function numero(valor, defecto = 0) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : defecto;
}

function claveMgn(mgn) { return texto(mgn); }

function escaparHTML(valor) {
    return texto(valor)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function archivoSeleccionado(id) {
    const input = document.getElementById(id);
    return input && input.files && input.files.length ? input.files[0] : null;
}

function hojaComoObjetos(workbook, nombreHoja) {
    const hoja = workbook.Sheets[nombreHoja];
    if (!hoja) return [];
    return XLSX.utils.sheet_to_json(hoja, { defval: "", raw: false });
}

async function leerExcel(archivo) {
    const buffer = await archivo.arrayBuffer();
    return XLSX.read(buffer, { type: "array" });
}

// ==================================================
// CARGA DE ARCHIVOS
// ==================================================

async function cargarArchivos() {
    try {
        const archivos = {
            muestra: archivoSeleccionado("archivoMuestra"),
            distribucion: archivoSeleccionado("archivoDistribucion"),
            reemplazosManzanas: archivoSeleccionado("archivoReemplazosManzanas"),
            reemplazosViviendas: archivoSeleccionado("archivoReemplazosViviendas"),
            personal: archivoSeleccionado("archivoPersonal")
        };

        const faltantes = Object.entries(archivos)
            .filter(([_, archivo]) => !archivo)
            .map(([nombre]) => nombre);

        if (faltantes.length) {
            mostrarAvisoCRC("Debe seleccionar los cuatro archivos de muestra y el archivo de personal antes de cargar los datos.");
            return;
        }

        cambiarEstado("Procesando archivos...", "carga");

        const [wbMuestra, wbDistribucion, wbRM, wbRV, wbPersonal] = await Promise.all([
            leerExcel(archivos.muestra),
            leerExcel(archivos.distribucion),
            leerExcel(archivos.reemplazosManzanas),
            leerExcel(archivos.reemplazosViviendas),
            leerExcel(archivos.personal)
        ]);

        app.muestra = hojaComoObjetos(wbMuestra, wbMuestra.SheetNames[0]);
        app.distribucion.nivel = hojaComoObjetos(wbDistribucion, "Nivel");
        app.distribucion.cruces = hojaComoObjetos(wbDistribucion, "Cruces");
        app.distribucion.encXmanzana = hojaComoObjetos(wbDistribucion, "EncXmanzana");
        app.reemplazosManzanas = hojaComoObjetos(wbRM, wbRM.SheetNames[0]);
        app.reemplazosViviendas = hojaComoObjetos(wbRV, wbRV.SheetNames[0]);
        app.personal = hojaComoObjetos(wbPersonal, wbPersonal.SheetNames[0]);

        validarEstructura();
        construirIndices();
        app.datosCargados = true;

        cargarRegiones();
        habilitar("region", "departamento", "municipio", "areaGeografica", "manzana", "supervisor", "encuestador", "btnGenerar");
        renderizarHistorico();
        mostrarResumenDatos();
        ofrecerRecuperacionBorrador();

        cambiarEstado("Muestra cargada correctamente. Lista para operar.", "ok");
    } catch (error) {
        console.error(error);
        app.datosCargados = false;
        cambiarEstado("Error al cargar los archivos.", "error");
        mostrarAvisoCRC("No fue posible cargar la muestra.\n\n" + error.message);
    }
}

function validarColumnas(datos, requeridas, nombre) {
    if (!datos.length) throw new Error("El archivo " + nombre + " no contiene registros.");
    const columnas = Object.keys(datos[0]);
    const faltantes = requeridas.filter(columna => !columnas.includes(columna));
    if (faltantes.length) {
        throw new Error("El archivo " + nombre + " no contiene las columnas: " + faltantes.join(", "));
    }
}

function validarEstructura() {
    validarColumnas(app.muestra,
        ["MGN", "Region", "COD_DPTO", "DPTO_NOM", "MPIO_CDPMP", "MUN_NOM", "areaGeografica", "TVIVIENDA", "VIV", "ID_VIV", "hog_encuestar"],
        "Muestra principal");

    validarColumnas(app.reemplazosManzanas,
        ["MGN", "Region", "COD_DPTO", "DPTO_NOM", "MPIO_CDPMP", "MUN_NOM", "areaGeografica", "TVIVIENDA", "inMue", "sub_clase"],
        "Reemplazos de manzanas");

    validarColumnas(app.reemplazosViviendas,
        ["MGN", "VIV", "ID_VIV", "orden_reemplazo"],
        "Reemplazos de viviendas");

    validarColumnas(app.personal,
        ["REGION", "DEPARTAMENTO", "CIUDAD", "ID_SUPERVISOR", "SUPERVISOR", "ID_ENCUESTADOR", "ENCUESTADOR", "ESTADO"],
        "Personal CRC");
}

// ==================================================
// ÍNDICES
// ==================================================

function construirIndices() {
    app.manzanas.clear();
    app.viviendasPorMgn.clear();
    app.reemplazosViviendaPorMgn.clear();
    app.grupos.clear();

    for (const fila of app.muestra) {
        const mgn = claveMgn(fila.MGN);

        if (!app.manzanas.has(mgn)) {
            app.manzanas.set(mgn, {
                mgn,
                region: texto(fila.Region),
                departamento: texto(fila.DPTO_NOM),
                codDpto: texto(fila.COD_DPTO),
                municipio: texto(fila.MUN_NOM),
                codigoMunicipio: texto(fila.MPIO_CDPMP),
                areaGeografica: texto(fila.areaGeografica),
                tvivienda: numero(fila.TVIVIENDA),
                tipo: "PADRE",
                meta: 0,
                grupoId: null
            });
        }

        if (!app.viviendasPorMgn.has(mgn)) app.viviendasPorMgn.set(mgn, []);

        app.viviendasPorMgn.get(mgn).push({
            mgn,
            viv: texto(fila.VIV),
            idVivienda: texto(fila.ID_VIV),
            hogarEncuestar: numero(fila.hog_encuestar),
            fuente: "MUESTRA"
        });
    }

    for (const [mgn, viviendas] of app.viviendasPorMgn.entries()) {
        const manzana = app.manzanas.get(mgn);
        manzana.meta = viviendas.filter(v => v.hogarEncuestar > 0).length;
        if (manzana.meta === 0) manzana.meta = viviendas.length;
    }

    const filasRM = app.reemplazosManzanas;

    for (let i = 0; i < filasRM.length; i++) {
        const filaPadre = filasRM[i];
        if (numero(filaPadre.inMue) !== 1) continue;

        const bloque = filasRM.slice(i, i + 4);
        const padre = bloque[0];
        const reemplazos = bloque.slice(1, 4);
        const mgnPadre = claveMgn(padre.MGN);
        const grupoId = "GRUPO_" + mgnPadre;

        const grupo = {
            id: grupoId,
            padre: mgnPadre,
            reemplazos: []
        };

        const padreInfo = app.manzanas.get(mgnPadre);
        if (padreInfo) {
            padreInfo.grupoId = grupoId;
            padreInfo.tipo = "PADRE";
        }

        reemplazos.forEach((fila, indice) => {
            const mgn = claveMgn(fila.MGN);
            const info = {
                mgn,
                region: texto(fila.Region),
                departamento: texto(fila.DPTO_NOM),
                codDpto: texto(fila.COD_DPTO),
                municipio: texto(fila.MUN_NOM),
                codigoMunicipio: texto(fila.MPIO_CDPMP),
                areaGeografica: texto(fila.areaGeografica),
                tvivienda: numero(fila.TVIVIENDA),
                tipo: "REEMPLAZO",
                reemplazoNumero: indice + 1,
                grupoId,
                meta: padreInfo ? padreInfo.meta : 0
            };

            app.manzanas.set(mgn, info);
            grupo.reemplazos.push(info);
        });

        app.grupos.set(grupoId, grupo);
    }

    // Cargar las viviendas de reemplazo en un índice EXCLUSIVO.
    // V9: no dependemos del arreglo mixto de viviendas de muestra + reemplazos.
    // Esto evita que una condición sobre las viviendas ya cargadas limite
    // accidentalmente la lectura del archivo completo de reemplazos.
    for (const fila of app.reemplazosViviendas) {
        const mgn = claveMgn(fila.MGN);
        if (!app.reemplazosViviendaPorMgn.has(mgn)) {
            app.reemplazosViviendaPorMgn.set(mgn, []);
        }

        app.reemplazosViviendaPorMgn.get(mgn).push({
            mgn,
            viv: texto(fila.VIV),
            idVivienda: texto(fila.ID_VIV),
            ordenReemplazo: numero(fila.orden_reemplazo),
            fuente: "REEMPLAZO_VIVIENDA"
        });
    }

    // Orden estable y completo: 1, 2, 3 ... hasta el último reemplazo disponible.
    for (const lista of app.reemplazosViviendaPorMgn.values()) {
        lista.sort((a, b) => a.ordenReemplazo - b.ordenReemplazo);
    }
}

// ==================================================
// COMBOS
// ==================================================

function limpiarSelect(id, textoInicial = "Seleccione...") {
    const select = document.getElementById(id);
    if (!select) {
        console.warn("Elemento no encontrado al limpiar select:", id);
        return null;
    }
    select.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = textoInicial;
    select.appendChild(option);
    return select;
}

function llenarSelect(id, valores, textoInicial = "Seleccione...") {
    const select = limpiarSelect(id, textoInicial);
    if (!select) return null;
    [...new Set(valores)].filter(Boolean).sort((a, b) => normalizar(a).localeCompare(normalizar(b))).forEach(valor => {
        const option = document.createElement("option");
        option.value = valor;
        option.textContent = valor;
        select.appendChild(option);
    });
    return select;
}

function manzanasPadre() {
    return [...app.manzanas.values()].filter(m => m.tipo === "PADRE");
}

function cargarRegiones() {
    const padres = manzanasPadre();
    llenarSelect("region", padres.map(m => m.region));
    limpiarSelect("departamento");
    limpiarSelect("municipio");
    limpiarSelect("areaGeografica");
    limpiarManzanaAutocomplete();
    limpiarSelect("supervisor");
    limpiarSelect("encuestador");
    document.getElementById("btnGenerar").disabled = true;
    
}

function cargarDepartamentos() {
    const region = document.getElementById("region").value;
    limpiarSelect("departamento");
    limpiarSelect("municipio");
    limpiarSelect("areaGeografica");
    limpiarManzanaAutocomplete();
    limpiarSelect("supervisor");
    limpiarSelect("encuestador");
    if (!region) return;
    llenarSelect("departamento", manzanasPadre().filter(m => m.region === region).map(m => m.departamento));
}

function cargarMunicipios() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    limpiarSelect("municipio");
    limpiarSelect("areaGeografica");
    limpiarManzanaAutocomplete();
    limpiarSelect("supervisor");
    limpiarSelect("encuestador");
    if (!region || !departamento) return;
    llenarSelect("municipio", manzanasPadre().filter(m => m.region === region && m.departamento === departamento).map(m => m.municipio));
}

function cargarAreas() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    limpiarSelect("areaGeografica");
    limpiarManzanaAutocomplete();
    limpiarSelect("supervisor");
    limpiarSelect("encuestador");
    if (!region || !departamento || !municipio) return;
    llenarSelect("areaGeografica", manzanasPadre().filter(m => m.region === region && m.departamento === departamento && m.municipio === municipio).map(m => m.areaGeografica));
    cargarSupervisores();
}

function cargarSupervisores() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    // PERSONAL_CRC se asigna por llave geografica REGION + DEPARTAMENTO + MUNICIPIO.
    // Cada municipio tiene su propio equipo: Supervisor 1, Supervisor 2, etc.
    const filas = app.personal.filter(p =>
        p.ESTADO && normalizar(p.ESTADO) === "ACTIVO" &&
        normalizar(p.REGION) === normalizar(region) &&
        normalizar(p.DEPARTAMENTO) === normalizar(departamento) &&
        normalizar(p.CIUDAD) === normalizar(municipio)
    );
    llenarSelect("supervisor", filas.map(p => p.ID_SUPERVISOR + "|" + p.SUPERVISOR));
    const sup = document.getElementById("supervisor");
    [...sup.options].forEach(o => {
        if (o.value) {
            const [id, nombre] = o.value.split("|");
            o.value = id;
            o.textContent = nombre;
        }
    });
    limpiarSelect("encuestador");
}

function cargarEncuestadores() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    const supervisor = document.getElementById("supervisor").value;
    const filas = app.personal.filter(p =>
        p.ESTADO && normalizar(p.ESTADO) === "ACTIVO" &&
        normalizar(p.REGION) === normalizar(region) &&
        normalizar(p.DEPARTAMENTO) === normalizar(departamento) &&
        normalizar(p.CIUDAD) === normalizar(municipio) &&
        texto(p.ID_SUPERVISOR) === texto(supervisor)
    );
    llenarSelect("encuestador", filas.map(p => p.ID_ENCUESTADOR + "|" + p.ENCUESTADOR));
    const enc = document.getElementById("encuestador");
    [...enc.options].forEach(o => {
        if (o.value) {
            const [id, nombre] = o.value.split("|");
            o.value = id;
            o.textContent = nombre;
        }
    });
    cargarManzanas();
}

function obtenerManzanasFiltradas() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    const area = document.getElementById("areaGeografica").value;
    const textoFiltro = normalizar(document.getElementById("manzana").value);
    return manzanasPadre().filter(m =>
        m.region === region &&
        m.departamento === departamento &&
        m.municipio === municipio &&
        m.areaGeografica === area &&
        (!textoFiltro || normalizar(m.mgn).includes(textoFiltro) || normalizar(m.mgn.slice(-4)).includes(textoFiltro))
    ).sort((a, b) => a.mgn.localeCompare(b.mgn));
}

function cargarManzanas() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    const area = document.getElementById("areaGeografica").value;
    const input = document.getElementById("manzana");

    input.value = "";
    if (!region || !departamento || !municipio || !area) {
        input.disabled = true;
        ocultarOpcionesManzana();
        limpiarOpcionesManzana();
        return;
    }

    input.disabled = false;
    filtrarManzanas();
}

function limpiarOpcionesManzana() {
    const lista = document.getElementById("listaManzanas");
    if (lista) { lista.innerHTML = ""; lista.classList.remove("visible"); }
}

function ocultarOpcionesManzana() {
    const lista = document.getElementById("listaManzanas");
    if (lista) lista.classList.remove("visible");
}

function mostrarOpcionesManzana(abrir = true) {
    const input = document.getElementById("manzana");
    if (!input || input.disabled) return;
    filtrarManzanas();
    const lista = document.getElementById("listaManzanas");
    if (abrir && lista && lista.children.length) lista.classList.add("visible");
}

function seleccionarOpcionManzana(mgn) {
    const input = document.getElementById("manzana");
    if (!input) return;
    input.value = mgn;
    ocultarOpcionesManzana();
    seleccionarManzana();
}

function navegarOpcionesManzana(event) {
    const lista = document.getElementById("listaManzanas");
    if (!lista || !lista.classList.contains("visible")) return;
    const opciones = [...lista.querySelectorAll(".mgn-opcion")];
    if (!opciones.length) return;
    const actual = opciones.findIndex(o => o.classList.contains("activo"));

    if (event.key === "ArrowDown") {
        event.preventDefault();
        opciones.forEach(o => o.classList.remove("activo"));
        opciones[Math.min(actual + 1, opciones.length - 1)].classList.add("activo");
        opciones[Math.min(actual + 1, opciones.length - 1)].scrollIntoView({block:"nearest"});
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        opciones.forEach(o => o.classList.remove("activo"));
        opciones[Math.max(actual <= 0 ? 0 : actual - 1, 0)].classList.add("activo");
    } else if (event.key === "Enter") {
        const activa = opciones.find(o => o.classList.contains("activo"));
        if (activa) {
            event.preventDefault();
            seleccionarOpcionManzana(activa.dataset.mgn);
        }
    } else if (event.key === "Escape") {
        ocultarOpcionesManzana();
    }
}

function obtenerManzanasFiltradas() {
    const region = document.getElementById("region").value;
    const departamento = document.getElementById("departamento").value;
    const municipio = document.getElementById("municipio").value;
    const area = document.getElementById("areaGeografica").value;
    const textoFiltro = normalizar(document.getElementById("manzana").value);
    return manzanasPadre().filter(m =>
        m.region === region &&
        m.departamento === departamento &&
        m.municipio === municipio &&
        m.areaGeografica === area &&
        (!textoFiltro || normalizar(m.mgn).includes(textoFiltro) || normalizar(m.mgn.slice(-4)).includes(textoFiltro))
    ).sort((a, b) => a.mgn.localeCompare(b.mgn));
}

function filtrarManzanas() {
    const lista = document.getElementById("listaManzanas");
    if (!lista) return;
    lista.innerHTML = "";

    const padres = obtenerManzanasFiltradas();
    const limite = 100;
    padres.slice(0, limite).forEach(m => {
        const opcion = document.createElement("div");
        opcion.className = "mgn-opcion";
        opcion.dataset.mgn = m.mgn;
        opcion.setAttribute("role", "option");
        opcion.innerHTML = `<strong>${escaparHTML(m.mgn)}</strong><span>${escaparHTML(m.municipio)} · ${escaparHTML(m.areaGeografica)}</span>`;
        opcion.addEventListener("mousedown", (event) => {
            event.preventDefault();
            seleccionarOpcionManzana(m.mgn);
        });
        lista.appendChild(opcion);
    });

    if (padres.length > limite) {
        const mas = document.createElement("div");
        mas.className = "mgn-ayuda-lista";
        mas.textContent = `Mostrando ${limite} de ${padres.length}. Escriba más dígitos para filtrar.`;
        lista.appendChild(mas);
    }

    lista.classList.add("visible");
}

function limpiarManzanaAutocomplete() {
    const input = document.getElementById("manzana");
    const lista = document.getElementById("listaManzanas");
    if (input) {
        input.value = "";
        input.disabled = true;
    }
    if (lista) lista.innerHTML = "";
}

// ==================================================
// RECUPERACIÓN DEL FORMULARIO ANTE REFRESH / OFFLINE
// ==================================================

function construirBorradorLocal() {
    if (!app.manzanaActual && !valorCampo("manzana")) return null;

    return {
        version: 1,
        guardadoEn: new Date().toISOString(),
        region: valorCampo("region"),
        departamento: valorCampo("departamento"),
        municipio: valorCampo("municipio"),
        areaGeografica: valorCampo("areaGeografica"),
        supervisor: valorCampo("supervisor"),
        encuestador: valorCampo("encuestador"),
        mgn: valorCampo("manzana"),
        app: {
            idRecorrido: app.idRecorrido,
            estadoRecorrido: app.estadoRecorrido,
            sincronizacionActual: app.sincronizacionActual,
            fechaTrabajo: app.fechaTrabajo,
            ultimaActualizacion: app.ultimaActualizacion,
            conteoRealActual: app.conteoRealActual,
            modoSeleccionActual: app.modoSeleccionActual,
            reemplazoManzanaActual: app.reemplazoManzanaActual,
            historialManzanas: JSON.parse(JSON.stringify(app.historialManzanas || [])),
            viviendas: JSON.parse(JSON.stringify(app.viviendas || [])),
            resultadoManzana: app.resultadoManzana,
            motivoManzana: app.motivoManzana,
            detalleMotivoManzana: app.detalleMotivoManzana,
            motivoManzanaCompleto: app.motivoManzanaCompleto
        },
        conteoCampo: document.getElementById("conteoReal")?.value || ""
    };
}

function guardarBorradorLocal() {
    try {
        // Un recorrido FINALIZADO o una INCIDENCIA cerrada ya no es un
        // formulario pendiente de recuperar. Su registro histórico queda
        // guardado por separado y el borrador debe desaparecer.
        if (app.estadoRecorrido === "FINALIZADA" || app.estadoRecorrido === "INCIDENCIA_MANZANA") {
            eliminarBorradorLocal();
            return;
        }

        const borrador = construirBorradorLocal();
        if (borrador && borradorCorrespondeARecorridoCerrado(borrador)) {
            eliminarBorradorLocal();
            return;
        }
        if (!borrador) return;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(borrador));
    } catch (error) {
        console.warn("No fue posible guardar el borrador local:", error);
    }
}

function obtenerBorradorLocal() {
    try {
        const claves = [DRAFT_KEY, ...LEGACY_DRAFT_KEYS];
        for (const clave of claves) {
            const raw = localStorage.getItem(clave);
            if (!raw) continue;
            let borrador;
            try {
                borrador = JSON.parse(raw);
            } catch (error) {
                localStorage.removeItem(clave);
                continue;
            }
            if (!borrador?.mgn) {
                localStorage.removeItem(clave);
                continue;
            }

            // Si el borrador viejo corresponde a un recorrido que ya quedó
            // FINALIZADO/INCIDENCIA, no debe volver a ofrecerse al usuario.
            if (borradorCorrespondeARecorridoCerrado(borrador)) {
                localStorage.removeItem(clave);
                continue;
            }

            // Migrar silenciosamente un borrador válido de V25.1-V25.3.
            if (clave !== DRAFT_KEY) {
                localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...borrador, version: 2 }));
                localStorage.removeItem(clave);
            }
            return borrador;
        }
        return null;
    } catch (error) {
        console.warn("Borrador local inválido:", error);
        return null;
    }
}

function borradorCorrespondeARecorridoCerrado(borrador) {
    const id = borrador?.app?.idRecorrido || "";
    const mgn = claveMgn(borrador?.mgn || "");
    const encuestador = normalizar(borrador?.encuestador || "");

    for (let i = 0; i < localStorage.length; i++) {
        const llave = localStorage.key(i);
        if (!llave || !llave.startsWith(RECORD_PREFIX)) continue;
        try {
            const registro = JSON.parse(localStorage.getItem(llave));
            if (!registro) continue;
            const mismoId = id && registro.idRecorrido === id;
            const mismoRecorrido = mgn && claveMgn(registro.mgnActual || "") === mgn &&
                (!encuestador || normalizar(registro.encuestador || "") === encuestador);
            if ((mismoId || mismoRecorrido) &&
                (registro.estadoRecorrido === "FINALIZADA" || registro.estadoRecorrido === "INCIDENCIA_MANZANA")) {
                return true;
            }
        } catch (_) {}
    }
    return false;
}

function eliminarBorradorLocal() {
    localStorage.removeItem(DRAFT_KEY);
    LEGACY_DRAFT_KEYS.forEach(clave => localStorage.removeItem(clave));
}


function mostrarAvisoCRC(mensaje, tipo = "info", titulo = "") {
    const anterior = document.getElementById("dialogoAvisoCRC");
    if (anterior) anterior.remove();

    const texto = String(mensaje ?? "");
    const esExito = tipo === "success" || texto.trimStart().startsWith("✓");
    const esError = tipo === "error" || /error|no fue posible|no se pudo|no puede|no es posible/i.test(texto);
    const esAdvertencia = tipo === "warning" || /debe |primero |atención|pendiente|no se permite/i.test(texto);

    const tituloFinal = titulo || (
        esExito ? "¡Operación exitosa!" :
        esError ? "No fue posible completar la acción" :
        esAdvertencia ? "Atención" :
        "Información"
    );

    const colorIcono = esError ? "#e74c3c" : esAdvertencia ? "#f39c12" : esExito ? "#20a464" : "#0b63b6";
    const icono = esError ? "×" : esAdvertencia ? "!" : esExito ? "✓" : "i";

    const fondo = document.createElement("div");
    fondo.id = "dialogoAvisoCRC";
    fondo.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100000;padding:20px;";

    const contenido = escaparHTML(texto).replace(/\n/g, "<br>");

    fondo.innerHTML = `
        <div role="dialog" aria-modal="true" aria-labelledby="tituloAvisoCRC"
             style="max-width:520px;width:100%;background:#fff;border-radius:12px;padding:26px 24px 22px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Arial,sans-serif;">
            <div style="display:flex;align-items:flex-start;gap:14px;">
                <div style="width:38px;height:38px;min-width:38px;border-radius:50%;background:${colorIcono};color:#fff;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:700;line-height:1;">
                    ${icono}
                </div>
                <div style="flex:1;">
                    <h2 id="tituloAvisoCRC" style="margin:4px 0 12px;font-size:21px;color:#111;">${escaparHTML(tituloFinal)}</h2>
                    <div style="font-size:15px;line-height:1.55;color:#333;">${contenido}</div>
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:22px;">
                <button type="button" id="btnAceptarAvisoCRC"
                        style="border:0;border-radius:7px;padding:12px 28px;background:#0b63b6;color:#fff;font-weight:700;font-size:14px;cursor:pointer;">
                    ACEPTAR
                </button>
            </div>
        </div>`;

    document.body.appendChild(fondo);

    const cerrar = () => fondo.remove();
    document.getElementById("btnAceptarAvisoCRC").addEventListener("click", cerrar);
    fondo.addEventListener("click", (e) => {
        if (e.target === fondo) cerrar();
    });

    const boton = document.getElementById("btnAceptarAvisoCRC");
    boton.focus();

    fondo.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            cerrar();
        }
    });
}

function mostrarConfirmacionCRC(mensaje, titulo = "Confirmar acción") {
    return new Promise(resolve => {
        const anterior = document.getElementById("dialogoConfirmacionCRC");
        if (anterior) anterior.remove();

        const fondo = document.createElement("div");
        fondo.id = "dialogoConfirmacionCRC";
        fondo.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100001;padding:20px;";
        const contenido = escaparHTML(String(mensaje ?? "")).replace(/\n/g, "<br>");
        fondo.innerHTML = `
            <div role="dialog" aria-modal="true" style="max-width:520px;width:100%;background:#fff;border-radius:12px;padding:26px 24px 22px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Arial,sans-serif;">
                <div style="display:flex;align-items:flex-start;gap:14px;">
                    <div style="width:38px;height:38px;min-width:38px;border-radius:50%;background:#f39c12;color:#fff;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:700;line-height:1;">!</div>
                    <div style="flex:1;">
                        <h2 style="margin:4px 0 12px;font-size:21px;color:#111;">${escaparHTML(titulo)}</h2>
                        <div style="font-size:15px;line-height:1.55;color:#333;">${contenido}</div>
                    </div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px;">
                    <button type="button" id="btnCancelarConfirmacionCRC" style="border:1px solid #c7cfd6;border-radius:7px;padding:12px 24px;background:#fff;color:#4f5d66;font-weight:700;font-size:14px;cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btnAceptarConfirmacionCRC" style="border:0;border-radius:7px;padding:12px 24px;background:#0b63b6;color:#fff;font-weight:700;font-size:14px;cursor:pointer;">CONFIRMAR</button>
                </div>
            </div>`;

        document.body.appendChild(fondo);
        const cerrar = valor => { fondo.remove(); resolve(valor); };
        document.getElementById("btnCancelarConfirmacionCRC").addEventListener("click", () => cerrar(false));
        document.getElementById("btnAceptarConfirmacionCRC").addEventListener("click", () => cerrar(true));
        fondo.addEventListener("click", e => { if (e.target === fondo) cerrar(false); });
        document.getElementById("btnAceptarConfirmacionCRC").focus();
    });
}

function crearDialogoRecuperacionBorrador(borrador) {
    if (document.getElementById("dialogoRecuperacionCRC")) return;

    const mgn = borrador?.mgn || "la manzana en curso";
    const fecha = borrador?.guardadoEn
        ? new Date(borrador.guardadoEn).toLocaleString("es-CO")
        : "momento anterior";

    const fondo = document.createElement("div");
    fondo.id = "dialogoRecuperacionCRC";
    fondo.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;";
    fondo.innerHTML = `
        <div style="max-width:520px;width:100%;background:#fff;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Arial,sans-serif;">
            <h2 style="margin-top:0;">Formulario sin terminar</h2>
            <p>Se encontró información de un formulario que estaba en proceso para la manzana <b>${escaparHTML(mgn)}</b>.</p>
            <p style="font-size:.92rem;color:#555;">Último guardado local: ${escaparHTML(fecha)}</p>
            <p>¿Desea recuperar la información y continuar trabajando?</p>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
                <button type="button" id="btnDescartarBorradorCRC" class="secundario">DESCARTAR</button>
                <button type="button" id="btnCargarBorradorCRC">CARGAR FORMULARIO</button>
            </div>
        </div>`;

    document.body.appendChild(fondo);
    document.getElementById("btnDescartarBorradorCRC").addEventListener("click", () => {
        eliminarBorradorLocal();
        fondo.remove();
        cambiarEstado("Borrador descartado. Puede iniciar un recorrido nuevo.", "ok");
    });
    document.getElementById("btnCargarBorradorCRC").addEventListener("click", () => {
        fondo.remove();
        recuperarBorradorLocal(borrador);
    });
}

function ofrecerRecuperacionBorrador() {
    const borrador = obtenerBorradorLocal();
    if (!borrador?.mgn) return;

    // Compatibilidad con borradores creados por V25.1/V25.2: si el último
    // recorrido ya quedó FINALIZADO o cerrado como INCIDENCIA, no debe
    // mostrarse como "formulario sin terminar".
    const estado = borrador.app?.estadoRecorrido || "";
    if (estado === "FINALIZADA" || estado === "INCIDENCIA_MANZANA") {
        eliminarBorradorLocal();
        return;
    }

    crearDialogoRecuperacionBorrador(borrador);
}

function recuperarBorradorLocal(borrador) {
    try {
        const ids = ["region", "departamento", "municipio", "areaGeografica", "supervisor", "encuestador"];
        const valores = [
            borrador.region,
            borrador.departamento,
            borrador.municipio,
            borrador.areaGeografica,
            borrador.supervisor,
            borrador.encuestador
        ];

        for (let i = 0; i < ids.length; i++) {
            const el = document.getElementById(ids[i]);
            if (el && valores[i] && [...el.options].some(o => o.value === valores[i])) {
                el.value = valores[i];
                if (ids[i] === "region") cargarDepartamentos();
                else if (ids[i] === "departamento") cargarMunicipios();
                else if (ids[i] === "municipio") cargarAreas();
                else if (ids[i] === "areaGeografica") cargarSupervisores();
                else if (ids[i] === "supervisor") cargarEncuestadores();
                else if (ids[i] === "encuestador") cargarManzanas();
            }
        }

        const manzana = document.getElementById("manzana");
        if (!manzana || !borrador.mgn) throw new Error("No se pudo recuperar la manzana del borrador.");
        manzana.value = borrador.mgn;

        const seleccion = app.manzanas.get(borrador.mgn);
        if (!seleccion) throw new Error("La manzana guardada ya no está disponible en los datos operativos cargados.");

        app.manzanaActual = seleccion;
        app.grupoActual = seleccion.grupoId ? app.grupos.get(seleccion.grupoId) : null;
        prepararContextoManzana(seleccion);

        const estado = borrador.app || {};
        app.llaveActual = generarLlave();
        app.idRecorrido = estado.idRecorrido || generarIdRecorrido();
        app.estadoRecorrido = estado.estadoRecorrido || "PARCIAL";
        app.sincronizacionActual = estado.sincronizacionActual || "PENDIENTE";
        app.fechaTrabajo = estado.fechaTrabajo || borrador.guardadoEn || new Date().toISOString();
        app.ultimaActualizacion = estado.ultimaActualizacion || borrador.guardadoEn || null;
        app.conteoRealActual = estado.conteoRealActual ?? (borrador.conteoCampo ? Number(borrador.conteoCampo) : null);
        app.modoSeleccionActual = estado.modoSeleccionActual || null;
        app.reemplazoManzanaActual = estado.reemplazoManzanaActual || 0;
        app.historialManzanas = estado.historialManzanas || [];
        app.viviendas = estado.viviendas || [];
        app.resultadoManzana = estado.resultadoManzana || "";
        app.motivoManzana = estado.motivoManzana || "";
        app.detalleMotivoManzana = estado.detalleMotivoManzana || "";
        app.motivoManzanaCompleto = estado.motivoManzanaCompleto || "";
        app.modoSoloLectura = app.estadoRecorrido === "FINALIZADA" || app.estadoRecorrido === "INCIDENCIA_MANZANA";

        document.getElementById("conteoReal").value = app.conteoRealActual ?? "";
        document.getElementById("conteoReal").disabled = app.modoSoloLectura;
        actualizarEstadoConteo();
        mostrarGrupoReemplazos();
        mostrarTabla();
        actualizarBotonesRecorrido();
        renderizarHistorico();

        cambiarEstado("✓ Formulario recuperado. Puede continuar trabajando desde el punto anterior.", "ok");
    } catch (error) {
        console.error(error);
        mostrarAvisoCRC("No fue posible recuperar el formulario guardado. La información permanece en el dispositivo para no perderla.\n\n" + error.message);
    }
}

// ==================================================
// SELECCIÓN DE MANZANA
// ==================================================


// ==================================================
// BLOQUEO DE MGN YA TRABAJADA — REGLA EXCLUSIVA POR MGN
// ==================================================
function mgnYaFueTrabajada(mgn) {
    const objetivo = claveMgn(mgn);
    if (!objetivo) return false;

    for (let i = 0; i < localStorage.length; i++) {
        const llave = localStorage.key(i);
        if (!llave || !llave.startsWith(RECORD_PREFIX)) continue;

        try {
            const registro = JSON.parse(localStorage.getItem(llave));
            if (registro && claveMgn(registro.mgnActual || "") === objetivo) {
                return true;
            }
        } catch (_) {}
    }
    return false;
}

function seleccionarManzana(desdeHistorico = false) {
    const mgn = texto(document.getElementById("manzana").value);
    const seleccion = app.manzanas.get(mgn) || null;

    if (!seleccion) {
        app.manzanaActual = null;
        app.grupoActual = null;
        limpiarInformacionManzana();
        document.getElementById("btnGenerar").disabled = true;
        mostrarMensajeInicial("Seleccione una MGN válida para iniciar o continuar un recorrido.");
        return;
    }

    // Desde el selector principal, una MGN que ya existe en cualquier
    // registro histórico NO puede volver a iniciar/cargar un recorrido.
    // ABRIR/VER desde Histórico llaman esta función con true.
    if (!desdeHistorico && mgnYaFueTrabajada(mgn)) {
        mostrarAvisoCRC(
            `La manzana ${mgn} ya fue trabajada y se encuentra registrada en el histórico.\n\nPara consultar o continuar con esta manzana, utilice los botones ABRIR o VER desde la tabla de históricos.`,
            "warning",
            "Manzana ya trabajada"
        );
        return;
    }

    app.manzanaActual = seleccion;
    app.grupoActual = seleccion.grupoId ? app.grupos.get(seleccion.grupoId) : null;
    prepararContextoManzana(seleccion);

    app.llaveActual = generarLlave();
    const guardado = localStorage.getItem(app.llaveActual);

    if (guardado) {
        cargarRecorridoGuardado(JSON.parse(guardado));
    } else {
        inicializarRecorridoNuevo();
    }

    actualizarBotonesRecorrido();
    renderizarHistorico();
}

function prepararContextoManzana(manzana) {
    document.getElementById("tipoUnidad").value = manzana.tipo === "PADRE"
        ? "Manzana de muestra"
        : "Manzana de reemplazo " + manzana.reemplazoNumero;
    document.getElementById("totalViviendas").value = manzana.tvivienda;
    document.getElementById("muestra").value = manzana.meta || 0;
}

function inicializarRecorridoNuevo() {
    app.viviendas = [];
    app.conteoRealActual = null;
    app.modoSeleccionActual = null;
    app.reemplazoManzanaActual = 0;
    app.historialManzanas = [];
    app.idRecorrido = generarIdRecorrido();
    app.estadoRecorrido = "NUEVO";
    app.ultimaActualizacion = null;
    app.fechaTrabajo = new Date().toISOString();
    app.modoSoloLectura = false;
    app.sincronizacionActual = "PENDIENTE";
    app.resultadoManzana = "";
    app.motivoManzana = "";
    app.detalleMotivoManzana = "";
    app.motivoManzanaCompleto = "";

    document.getElementById("conteoReal").value = "";
    document.getElementById("conteoReal").disabled = false;
    actualizarEstadoConteo();
    mostrarGrupoReemplazos();
    mostrarMensajeInicial("Manzana nueva. Ingrese el conteo real y pulse INICIAR / CARGAR RECORRIDO.");
    document.getElementById("resultado").innerHTML = "";
    document.getElementById("btnGenerar").disabled = false;
}

function cargarRecorridoGuardado(datos) {
    app.idRecorrido = datos.idRecorrido || generarIdRecorrido();
    app.estadoRecorrido = datos.estadoRecorrido || "PARCIAL";
    app.ultimaActualizacion = datos.ultimaActualizacion || null;
    app.fechaTrabajo = datos.fechaTrabajo || datos.ultimaActualizacion || new Date().toISOString();
    app.viviendas = datos.viviendas || [];
    app.conteoRealActual = datos.conteoReal ?? null;
    app.modoSeleccionActual = datos.modoSeleccion || null;
    app.reemplazoManzanaActual = datos.reemplazoManzanaActual || 0;
    app.historialManzanas = datos.historialManzanas || [];
    app.modoSoloLectura = datos.estadoRecorrido === "FINALIZADA" || datos.estadoRecorrido === "INCIDENCIA_MANZANA";
    app.sincronizacionActual = datos.sincronizacionActual || "PENDIENTE";
    app.resultadoManzana = datos.resultadoManzana || "";
    app.motivoManzana = datos.motivoManzana || "";
    app.detalleMotivoManzana = datos.detalleMotivoManzana || "";
    app.motivoManzanaCompleto = datos.motivoManzanaCompleto || "";

    // Si el recorrido fue guardado con varios no efectivos, garantizar que
    // todos sus reemplazos queden cargados al recuperarlo.
    if (app.estadoRecorrido !== "FINALIZADA") asegurarReemplazosVivienda();

    document.getElementById("conteoReal").value = app.conteoRealActual ?? "";
    document.getElementById("conteoReal").disabled = app.modoSoloLectura;
    actualizarEstadoConteo();
    mostrarGrupoReemplazos();
    mostrarTabla();

    if (app.modoSoloLectura) {
        bloquearControlesManzana(true);
        if (app.estadoRecorrido === "INCIDENCIA_MANZANA") {
            mostrarMensajeRecorrido("INCIDENCIA", `Esta manzana fue cerrada como NO TRABAJADA por: ${app.motivoManzana || "incidencia de campo"}. Se encuentra en modo SOLO LECTURA.`, "ok");
        } else {
            mostrarMensajeRecorrido("FINALIZADA", "Esta manzana ya fue finalizada. Se encuentra en modo SOLO LECTURA.", "ok");
        }
    } else {
        bloquearControlesManzana(false);
        mostrarMensajeRecorrido("PARCIAL", "Esta manzana tiene un recorrido guardado. Puede continuar desde donde quedó.", "pendiente");
    }
}

function mostrarMensajeInicial(mensaje) {
    const el = document.getElementById("estadoRecorridoInicial");
    if (el) el.textContent = mensaje;
}

function limpiarInformacionManzana() {
    document.getElementById("tipoUnidad").value = "";
    document.getElementById("totalViviendas").value = "";
    document.getElementById("muestra").value = "";
    document.getElementById("conteoReal").value = "";
    document.getElementById("grupoReemplazos").innerHTML = "";
    document.getElementById("estadoConteo").textContent = "Digite el conteo real de viviendas.";
    document.getElementById("resultado").innerHTML = "";
    actualizarBotonesRecorrido();
}

function mostrarGrupoReemplazos() {
    const contenedor = document.getElementById("grupoReemplazos");

    if (!app.grupoActual) {
        contenedor.innerHTML = "<b>Grupo de trabajo:</b> sin reemplazos de manzana asociados.";
        return;
    }

    const g = app.grupoActual;
    contenedor.innerHTML = `
        <b>Grupo de trabajo:</b> ${escaparHTML(g.id)}
        &nbsp; | &nbsp;
        <b>Manzana padre:</b> ${escaparHTML(g.padre)}
        &nbsp; | &nbsp;
        <b>Reemplazos disponibles:</b> ${g.reemplazos.length}
        <div class="nota-reemplazos">
            Las manzanas de reemplazo se habilitan automáticamente y respetan el orden de la muestra.
        </div>
    `;
}

function actualizarEstadoConteo() {
    const estado = document.getElementById("estadoConteo");
    if (!app.manzanaActual) {
        estado.textContent = "Digite el conteo real de viviendas.";
        return;
    }

    const valor = parseInt(document.getElementById("conteoReal").value, 10);
    if (!Number.isInteger(valor) || valor < 0) {
        estado.className = "grupo-info estado-conteo";
        estado.textContent = "Digite el conteo real de viviendas para definir el método de selección.";
        return;
    }

    const esperado = app.manzanaActual.tvivienda;

    if (valor === esperado) {
        estado.className = "grupo-info estado-conteo conteo-ok";
        estado.textContent = "✓ Conteo coincide con la muestra. Se utilizarán las viviendas precargadas y sus reemplazos.";
    } else {
        estado.className = "grupo-info estado-conteo conteo-diferente";
        estado.textContent = "⚠ Conteo diferente a la muestra. El sistema realizará un nuevo sorteo aleatorio con " + valor + " viviendas.";
    }
}

// ==================================================
// SINCRONIZACIÓN ONLINE / OFFLINE
// ==================================================

function valorCampo(id) {
    const el = document.getElementById(id);
    return el ? texto(el.value) : "";
}

function obtenerColaSync() {
    try {
        return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
    } catch (_) {
        return [];
    }
}

function guardarColaSync(cola) {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(cola));
}

function construirRegistroSync(vivienda, evento = "RESULTADO") {
    return {
        evento,
        idRecorrido: app.idRecorrido || "",
        estadoRecorrido: app.estadoRecorrido || "NUEVO",
        sincronizacionActual: "PENDIENTE",
        fecha: valorCampo("fecha"),
        hora: valorCampo("hora"),
        fechaTrabajo: app.fechaTrabajo || new Date().toISOString(),
        supervisor: valorCampo("supervisor"),
        encuestador: valorCampo("encuestador"),
        region: valorCampo("region"),
        departamento: valorCampo("departamento"),
        municipio: valorCampo("municipio"),
        areaGeografica: valorCampo("areaGeografica"),
        mgn: app.manzanaActual?.mgn || "",
        tipoUnidad: app.manzanaActual?.tipo || "",
        conteoReal: app.conteoRealActual || "",
        modoSeleccion: app.modoSeleccionActual || "",
        resultadoManzana: app.resultadoManzana || "",
        motivoManzana: app.motivoManzana || "",
        detalleMotivoManzana: app.detalleMotivoManzana || "",
        motivoManzanaCompleto: app.motivoManzanaCompleto || "",
        vivienda: vivienda?.vivienda || "",
        idVivienda: vivienda?.idVivienda || "",
        orden: vivienda?.orden || "",
        estado: vivienda?.estado || "",
        resultado: vivienda?.resultado || "",
        fuente: vivienda?.fuente || "",
        grupoId: app.grupoActual?.id || "",
        ultimaActualizacion: app.ultimaActualizacion || new Date().toISOString()
    };
}

function construirSnapshotRecorrido(evento = "SNAPSHOT_RECORRIDO") {
    return {
        ...construirRegistroSync(null, evento),
        viviendas: JSON.parse(JSON.stringify(app.viviendas || [])),
        historialManzanas: JSON.parse(JSON.stringify(app.historialManzanas || [])),
        efectivasGrupo: efectivasGrupo(),
        metaGrupo: metaGrupo()
    };
}

function encolarRegistroSync(registro) {
    const cola = obtenerColaSync();
    cola.push(registro);
    guardarColaSync(cola);
    actualizarEstadoSync();
    if (navigator.onLine) sincronizarCola();
}

function reemplazarSnapshotEnCola(snapshot) {
    const cola = obtenerColaSync().filter(r =>
        !(r.evento === "SNAPSHOT_RECORRIDO" && r.idRecorrido === snapshot.idRecorrido)
    );
    cola.push(snapshot);
    guardarColaSync(cola);
    actualizarEstadoSync();
    if (navigator.onLine) sincronizarCola();
}

async function sincronizarCola(forzado = false) {
    if (!CONFIG.SYNC_URL || !navigator.onLine) {
        actualizarEstadoSync();
        if (forzado && !CONFIG.SYNC_URL) {
            mostrarAvisoCRC("La sincronización todavía no está configurada: falta la URL /exec de Google Apps Script.");
        }
        return false;
    }

    const cola = obtenerColaSync();
    if (!cola.length) {
        actualizarEstadoSync();
        if (forzado) mostrarAvisoCRC("No hay registros pendientes de sincronización.");
        return true;
    }

    const ids = [...new Set(cola.map(r => r.idRecorrido).filter(Boolean))];
    try {
        // Google Apps Script no expone Access-Control-Allow-Origin para este Web App.
        // Por eso el navegador bloquea la lectura de la respuesta aunque el POST
        // llegue al servidor (en DevTools se observa HTTP 200 + CORS).
        // Usamos una solicitud simple no-cors: el POST se envía y no intentamos
        // leer la respuesta, evitando que Chrome lo reporte como Failed to fetch.
        await fetch(CONFIG.SYNC_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ registros: cola })
        });

        marcarRecorridosSincronizados(ids);
        guardarColaSync([]);
        actualizarEstadoSync();
        renderizarHistorico();

        if (forzado) {
            mostrarAvisoCRC("✓ Registros enviados al servidor.\n\nRegistros enviados: " + cola.length);
        }
        return true;
    } catch (error) {
        console.warn("Sincronización pendiente:", error);
        actualizarEstadoSync();
        if (forzado) {
            mostrarAvisoCRC("No fue posible sincronizar ahora.\n\nLa información permanece guardada en este dispositivo y se intentará nuevamente cuando haya conexión.");
        }
        return false;
    }
}

function actualizarEstadoSync() {
    const el = document.getElementById("estadoRed");
    if (!el) return;
    const pendientes = obtenerColaSync().length;
    const red = navigator.onLine ? "● En línea" : "● Sin conexión — modo offline activo";
    const clase = navigator.onLine ? "online" : "offline";
    el.className = "estado-red " + clase;
    el.textContent = pendientes
        ? `${red} | ${pendientes} registro(s) pendiente(s) de sincronizar`
        : red;
}

function marcarRecorridosSincronizados(ids) {
    ids.forEach(id => {
        const datos = buscarRegistroPorId(id);
        if (!datos || !datos.llave) return;
        datos.registro.sincronizacionActual = "SINCRONIZADA";
        localStorage.setItem(datos.llave, JSON.stringify(datos.registro));
        if (app.idRecorrido === id) app.sincronizacionActual = "SINCRONIZADA";
    });
}

function generarIdRecorrido() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "CRC15-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

function generarLlave() {
    if (!app.manzanaActual) return null;
    const encuestador = valorCampo("encuestador") || "SIN_ENCUESTADOR";
    return RECORD_PREFIX + [encuestador, app.manzanaActual.mgn].join("|");
}

function guardarSeleccion() {
    if (!app.llaveActual) app.llaveActual = generarLlave();
    if (!app.idRecorrido) app.idRecorrido = generarIdRecorrido();
    app.ultimaActualizacion = new Date().toISOString();
    if (!app.fechaTrabajo) app.fechaTrabajo = app.ultimaActualizacion;

    localStorage.setItem(app.llaveActual, JSON.stringify({
        idRecorrido: app.idRecorrido,
        estadoRecorrido: app.estadoRecorrido,
        sincronizacionActual: app.sincronizacionActual || "PENDIENTE",
        fechaTrabajo: app.fechaTrabajo,
        ultimaActualizacion: app.ultimaActualizacion,
        mgnActual: app.manzanaActual?.mgn || null,
        region: valorCampo("region"),
        departamento: valorCampo("departamento"),
        municipio: valorCampo("municipio"),
        areaGeografica: valorCampo("areaGeografica"),
        supervisor: valorCampo("supervisor"),
        encuestador: valorCampo("encuestador"),
        viviendas: JSON.parse(JSON.stringify(app.viviendas || [])),
        conteoReal: app.conteoRealActual,
        modoSeleccion: app.modoSeleccionActual,
        reemplazoManzanaActual: app.reemplazoManzanaActual,
        historialManzanas: JSON.parse(JSON.stringify(app.historialManzanas || [])),
        metaManzana: app.manzanaActual?.meta || 0,
        resultadoManzana: app.resultadoManzana || "",
        motivoManzana: app.motivoManzana || "",
        detalleMotivoManzana: app.detalleMotivoManzana || "",
        motivoManzanaCompleto: app.motivoManzanaCompleto || ""
    }));
    renderizarHistorico();
    guardarBorradorLocal();
}

function guardarSnapshotYSincronizar(evento) {
    app.sincronizacionActual = "PENDIENTE";
    guardarSeleccion();
    const snapshot = construirSnapshotRecorrido(evento);
    reemplazarSnapshotEnCola(snapshot);
    if (navigator.onLine && CONFIG.SYNC_URL) sincronizarCola();
}

function buscarRegistroPorId(id) {
    for (let i = 0; i < localStorage.length; i++) {
        const llave = localStorage.key(i);
        if (!llave || !llave.startsWith(RECORD_PREFIX)) continue;
        try {
            const registro = JSON.parse(localStorage.getItem(llave));
            if (registro?.idRecorrido === id) return { llave, registro };
        } catch (_) {}
    }
    return null;
}

function obtenerRegistrosHistoricos() {
    const registros = [];
    for (let i = 0; i < localStorage.length; i++) {
        const llave = localStorage.key(i);
        if (!llave || !llave.startsWith(RECORD_PREFIX)) continue;
        try {
            const registro = JSON.parse(localStorage.getItem(llave));
            if (!registro?.mgnActual) continue;
            if (registro.estadoRecorrido !== "INCIDENCIA_MANZANA" && !registro?.viviendas?.length) continue;
            registros.push({ llave, ...registro });
        } catch (_) {}
    }
    return registros;
}

function obtenerGrupoHistorico(registro) {
    const mgn = registro?.mgnActual ? claveMgn(registro.mgnActual) : "";
    const info = mgn ? app.manzanas.get(mgn) : null;
    const grupoId = registro?.grupoId || info?.grupoId || (mgn ? "GRUPO_" + mgn : "");
    const grupo = grupoId ? app.grupos.get(grupoId) : null;
    const padreMgn = grupo?.padre || (info?.tipo === "PADRE" ? mgn : "");
    return { grupoId, grupo, padreMgn, info };
}

function obtenerCiclosHistoricos() {
    const grupos = new Map();

    obtenerRegistrosHistoricos().forEach(registro => {
        const { grupoId, grupo, padreMgn } = obtenerGrupoHistorico(registro);
        const clave = `${grupoId || padreMgn || registro.mgnActual}|${normalizar(registro.encuestador || "")}`;

        if (!grupos.has(clave)) {
            grupos.set(clave, {
                clave,
                grupoId,
                grupo,
                padreMgn,
                registros: new Map()
            });
        }

        const ciclo = grupos.get(clave);
        const mgn = claveMgn(registro.mgnActual);
        const anterior = ciclo.registros.get(mgn);
        const fechaRegistro = new Date(registro.ultimaActualizacion || registro.fechaTrabajo || 0).getTime();
        const fechaAnterior = anterior
            ? new Date(anterior.ultimaActualizacion || anterior.fechaTrabajo || 0).getTime()
            : -1;

        // Una sola versión por manzana física. No usamos historialManzanas
        // anidado para sumar, porque eso duplicaría las efectivas.
        if (!anterior || fechaRegistro >= fechaAnterior) {
            ciclo.registros.set(mgn, registro);
        }
    });

    return [...grupos.values()].map(ciclo => {
        const registrosManzana = [...ciclo.registros.values()].sort((a, b) =>
            new Date(a.fechaTrabajo || a.ultimaActualizacion || 0) -
            new Date(b.fechaTrabajo || b.ultimaActualizacion || 0)
        );

        const padre = registrosManzana.find(r => {
            const info = app.manzanas.get(claveMgn(r.mgnActual));
            return info?.tipo === "PADRE" || claveMgn(r.mgnActual) === ciclo.padreMgn;
        }) || registrosManzana[0];

        const ultimo = registrosManzana.reduce((actual, r) => {
            const tActual = new Date(actual?.ultimaActualizacion || actual?.fechaTrabajo || 0).getTime();
            const tR = new Date(r?.ultimaActualizacion || r?.fechaTrabajo || 0).getTime();
            return tR >= tActual ? r : actual;
        }, registrosManzana[0]);

        const efectivas = registrosManzana.reduce((total, r) =>
            total + (r.viviendas || []).filter(v => v.resultado === "Efectiva").length, 0);

        const reemplazosUtilizados = registrosManzana.filter(r => {
            const info = app.manzanas.get(claveMgn(r.mgnActual));
            return info?.tipo === "REEMPLAZO";
        }).length;

        return {
            ...ciclo,
            registrosManzana,
            padre,
            ultimo,
            efectivas,
            muestra: 1,
            reemplazosUtilizados
        };
    }).sort((a, b) => new Date(b.padre?.fechaTrabajo || b.ultimo?.ultimaActualizacion || 0) - new Date(a.padre?.fechaTrabajo || a.ultimo?.ultimaActualizacion || 0));
}

function obtenerEstadoVisual(registro) {
    const sincronizada = registro.sincronizacionActual === "SINCRONIZADA";
    if (registro.estadoRecorrido === "INCIDENCIA_MANZANA") {
        const motivo = registro.motivoManzana || "Incidencia de campo";
        return sincronizada
            ? { texto: `No trabajada – ${motivo} (sincronizada)`, clase: "incidencia" }
            : { texto: `No trabajada – ${motivo} (pendiente por sincronizar)`, clase: "incidencia-pendiente" };
    }
    if (registro.estadoRecorrido === "FINALIZADA") {
        return sincronizada
            ? { texto: "Finalizada sincronizada", clase: "finalizada" }
            : { texto: "Finalizada pendiente por sincronizar", clase: "finalizada-pendiente" };
    }
    return sincronizada
        ? { texto: "Guardada parcialmente sincronizada", clase: "parcial" }
        : { texto: "Guardada parcialmente sin sincronizar", clase: "parcial-pendiente" };
}

function cargarRegistroHistoricoPorLlave(llave) {
    const datos = localStorage.getItem(llave);
    if (!datos) return;
    const registro = JSON.parse(datos);
    const mgn = registro.mgnActual;
    if (!app.manzanas.has(mgn)) {
        mostrarAvisoCRC("La MGN de este histórico no existe en los datos operativos actuales.");
        return;
    }

    const region = document.getElementById("region");
    const departamento = document.getElementById("departamento");
    const municipio = document.getElementById("municipio");
    const area = document.getElementById("areaGeografica");
    const supervisor = document.getElementById("supervisor");
    const encuestador = document.getElementById("encuestador");

    if (registro.region && region.querySelector(`option[value="${CSS.escape(registro.region)}"]`)) {
        region.value = registro.region;
        cargarDepartamentos();
    }
    if (registro.departamento && departamento.querySelector(`option[value="${CSS.escape(registro.departamento)}"]`)) {
        departamento.value = registro.departamento;
        cargarMunicipios();
    }
    if (registro.municipio && municipio.querySelector(`option[value="${CSS.escape(registro.municipio)}"]`)) {
        municipio.value = registro.municipio;
        cargarAreas();
    }
    if (registro.areaGeografica && area.querySelector(`option[value="${CSS.escape(registro.areaGeografica)}"]`)) {
        area.value = registro.areaGeografica;
        cargarSupervisores();
    }
    if (registro.supervisor && supervisor.querySelector(`option[value="${CSS.escape(registro.supervisor)}"]`)) {
        supervisor.value = registro.supervisor;
        cargarEncuestadores();
    }
    if (registro.encuestador && encuestador.querySelector(`option[value="${CSS.escape(registro.encuestador)}"]`)) {
        encuestador.value = registro.encuestador;
        cargarManzanas();
    }

    document.getElementById("manzana").value = mgn;
    seleccionarManzana(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function obtenerEstadoVisualCiclo(ciclo) {
    return obtenerEstadoVisual(ciclo.ultimo || ciclo.padre);
}

function obtenerRegistrosHistoricosFiltrados() {
    const textoFiltro = normalizar(document.getElementById("filtroHistoricoTexto")?.value || "");
    const estadoFiltro = document.getElementById("filtroHistoricoEstado")?.value || "";

    return obtenerCiclosHistoricos().filter(ciclo => {
        const r = ciclo.padre || ciclo.ultimo || {};
        const estado = obtenerEstadoVisualCiclo(ciclo).texto;
        const textoBusqueda = normalizar([ciclo.padreMgn || r.mgnActual, r.departamento, r.municipio].join(" "));
        return (!textoFiltro || textoBusqueda.includes(textoFiltro)) && (!estadoFiltro || estado === estadoFiltro);
    });
}

function filtrarHistorico() {
    renderizarHistorico();
}


function renderizarHistorico() {
    const contenedor = document.getElementById("historicoCRC");
    if (!contenedor) return;

    const estadoSeleccionado = document.getElementById("filtroHistoricoEstado")?.value || "";
    const textoSeleccionado = document.getElementById("filtroHistoricoTexto")?.value || "";
    const ciclos = obtenerRegistrosHistoricosFiltrados();
    const estados = [
        "Guardada parcialmente sin sincronizar",
        "Guardada parcialmente sincronizada",
        "Finalizada pendiente por sincronizar",
        "Finalizada sincronizada",
        "No trabajada – Inseguridad (sincronizada)",
        "No trabajada – Inseguridad (pendiente por sincronizar)",
        "No trabajada – Manzana no existe (sincronizada)",
        "No trabajada – Manzana no existe (pendiente por sincronizar)",
        "No trabajada – Manzana no localizada (sincronizada)",
        "No trabajada – Manzana no localizada (pendiente por sincronizar)",
        "No trabajada – Acceso imposible (sincronizada)",
        "No trabajada – Acceso imposible (pendiente por sincronizar)",
        "No trabajada – Otro (sincronizada)",
        "No trabajada – Otro (pendiente por sincronizar)"
    ];

    const filas = ciclos.length ? ciclos.map(ciclo => {
        const r = ciclo.padre || ciclo.ultimo || {};
        const estado = obtenerEstadoVisualCiclo(ciclo);
        const fecha = r.fechaTrabajo ? new Date(r.fechaTrabajo).toLocaleDateString("es-CO") : "";
        const mgnPadre = ciclo.padreMgn || r.mgnActual || "";
        const accionRegistro = ciclo.ultimo || ciclo.padre || r;
        const accion = (accionRegistro.estadoRecorrido === "FINALIZADA" || accionRegistro.estadoRecorrido === "INCIDENCIA_MANZANA") ? "VER" : "ABRIR";
        const claseAccion = accionRegistro.estadoRecorrido === "FINALIZADA" ? "accion-ver" : "accion-abrir";
        const llaveAccion = accionRegistro.llave || "";
        const metaSolicitada = (app.manzanas.get(claveMgn(mgnPadre))?.meta || r.metaManzana || 0);

        return `<tr>
            <td>${escaparHTML(fecha)}</td>
            <td>${escaparHTML(r.departamento || "")}</td>
            <td>${escaparHTML(r.municipio || "")}</td>
            <td><b>${escaparHTML(mgnPadre)}</b></td>
            <td>${numero(metaSolicitada)}</td>
            <td>${numero(ciclo.efectivas)}</td>
            <td>${numero(ciclo.muestra)}</td>
            <td>${numero(ciclo.reemplazosUtilizados)}</td>
            <td><span class="estado-chip ${estado.clase}">${escaparHTML(estado.texto)}</span></td>
            <td><button type="button" class="btn-historico ${claseAccion}" data-llave='${escaparHTML(llaveAccion)}'>${accion}</button></td>
        </tr>`;
    }).join("") : `<tr><td colspan="10" class="historico-vacio">No hay ciclos de manzanas de muestra que coincidan con los filtros.</td></tr>`;

    contenedor.innerHTML = `<div class="historico-crc">
        <div class="historico-encabezado">
            <div>
                <h2>Histórico de manzanas trabajadas</h2>
                <p>Una fila por ciclo de la manzana de muestra. Los reemplazos utilizados se resumen en la misma fila.</p>
            </div>
            <div class="historico-controles">
                <input id="filtroHistoricoTexto" type="search" placeholder="Buscar MGN, municipio o departamento..." value="${escaparHTML(textoSeleccionado)}">
                <select id="filtroHistoricoEstado">
                    <option value="">Todos los estados</option>
                    ${estados.map(e => `<option value="${escaparHTML(e)}" ${e === estadoSeleccionado ? "selected" : ""}>${escaparHTML(e)}</option>`).join("")}
                </select>
            </div>
        </div>
        <div class="historico-meta">${ciclos.length} ciclo(s) mostrado(s)</div>
        <div class="historico-scroll"><table class="historico-tabla">
            <thead><tr>
                <th>Fecha de trabajo</th>
                <th>Departamento</th>
                <th>Municipio</th>
                <th>Manzana MGN</th>
                <th>Efectivas solicitadas</th>
                <th>Efectivas recolectadas</th>
                <th>Muestra</th>
                <th>Reemplazos utilizados</th>
                <th>Estado actual</th>
                <th>Acción</th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table></div>
    </div>`;

    const filtroTexto = document.getElementById("filtroHistoricoTexto");
    const filtroEstado = document.getElementById("filtroHistoricoEstado");
    if (filtroTexto) filtroTexto.addEventListener("input", renderizarHistorico);
    if (filtroEstado) filtroEstado.addEventListener("change", renderizarHistorico);
    contenedor.querySelectorAll(".btn-historico").forEach(btn => {
        btn.addEventListener("click", () => cargarRegistroHistoricoPorLlave(btn.dataset.llave));
    });
}

function recuperarSeleccion() {
    if (!app.manzanaActual) return;
    seleccionarManzana();
}

function mostrarMensajeRecorrido(estado, mensaje, tipo = "info") {
    const resultado = document.getElementById("resultado");
    if (!resultado) return;

    const clase = tipo === "ok" ? "grupo-cerrado" : "grupo-progreso";
    const icono = estado === "FINALIZADA" ? "✓" : "⚠";
    const aviso = `<div class="${clase}" style="margin-bottom:12px;"><b>${icono} ${estado}</b><br>${escaparHTML(mensaje)}</div>`;

    if (resultado.innerHTML && !resultado.innerHTML.includes("id=\"avisoRecorrido\"")) {
        resultado.innerHTML = `<div id="avisoRecorrido">${aviso}</div>` + resultado.innerHTML;
    }
}

function bloquearControlesManzana(completa) {
    const ids = [
        "region", "departamento", "municipio", "areaGeografica",
        "supervisor", "encuestador", "manzana", "conteoReal",
        "btnGenerar"
    ];

    ids.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.disabled = !!completa;
    });

    // Cuando se consulta una manzana COMPLETA, la información operativa queda
    // en modo solo lectura. NUEVA MANZANA será la vía para volver a operar.
}

function cicloListoParaCerrar() {
    const incidenciaAgotada =
        app.estadoRecorrido === "INCIDENCIA_MANZANA" &&
        cicloAgotadoSinMeta();

    // Una manzana marcada como NO TRABAJADA puede cerrar el GRUPO aunque
    // tenga viviendas pendientes: esas viviendas nunca fueron visitadas.
    // Solo aplica cuando ya no queda otra manzana de reemplazo disponible.
    if (!app.manzanaActual) return false;
    if (app.estadoRecorrido === "FINALIZADA") return false;

    if (!app.viviendas || !app.viviendas.length) {
        if (!incidenciaAgotada) return false;
    }

    // En una incidencia agotada no exigimos resultados de viviendas:
    // el resultado de la manzana es el que cerró esa unidad operativa.
    if (!incidenciaAgotada && tienePendientes()) return false;

    // Todas las manzanas cerradas previamente deben tener resultado.
    if ((app.historialManzanas || []).some(h => !String(h.resultadoManzana || "").trim())) return false;

    // La manzana actualmente abierta también debe tener resultado.
    if (!String(app.resultadoManzana || "").trim()) return false;

    // Se puede cerrar cuando se alcanza la meta O cuando se agotó
    // completamente el ciclo (Padre + reemplazos disponibles).
    return efectivasGrupo() >= metaGrupo() || incidenciaAgotada || cicloAgotadoSinMeta();
}

function actualizarBotonesRecorrido() {
    const btnFinalizar = document.getElementById("btnFinalizar");
    const btnParcial = document.getElementById("btnParcial");
    const btnGenerar = document.getElementById("btnGenerar");
    if (!btnGenerar) return;

    const hayViviendas = app.viviendas && app.viviendas.length > 0;
    const finalizada = app.estadoRecorrido === "FINALIZADA";
    const incidencia = app.estadoRecorrido === "INCIDENCIA_MANZANA";
    const cierrePorAgotamiento = cicloAgotadoSinMeta();
    const bloqueado = finalizada || (incidencia && !cierrePorAgotamiento);
    const metaAlcanzada = efectivasGrupo() >= metaGrupo();
    const puedeCerrar = cicloListoParaCerrar();

    btnGenerar.disabled = !app.manzanaActual || bloqueado || (hayViviendas && app.estadoRecorrido !== "NUEVO");

    // FINALIZAR/CERRAR solo se habilita cuando el grupo puede cerrarse:
    // meta alcanzada o agotamiento total, y sin viviendas pendientes.
    if (btnFinalizar) btnFinalizar.disabled = !puedeCerrar || bloqueado;

    // GUARDAR PARCIAL solo existe mientras el ciclo sigue abierto:
    // no se ha alcanzado la meta y todavía queda trabajo por realizar.
    if (btnParcial) btnParcial.disabled = !hayViviendas || bloqueado || metaAlcanzada || cierrePorAgotamiento;
}

function limpiarParaSiguienteManzana() {
    app.manzanaActual = null;
    app.grupoActual = null;
    app.viviendas = [];
    app.llaveActual = null;
    app.idRecorrido = null;
    app.estadoRecorrido = "NUEVO";
    app.conteoRealActual = null;
    app.modoSeleccionActual = null;
    app.reemplazoManzanaActual = 0;
    app.historialManzanas = [];
    app.ultimaActualizacion = null;
    app.fechaTrabajo = null;
    app.modoSoloLectura = false;
    app.sincronizacionActual = "PENDIENTE";
    app.resultadoManzana = "";
    app.motivoManzana = "";
    app.detalleMotivoManzana = "";
    app.motivoManzanaCompleto = "";

    limpiarInformacionManzana();
    document.getElementById("conteoReal").disabled = false;
    document.getElementById("btnGenerar").disabled = true;
    // Dejar el formulario superior realmente limpio para iniciar otra manzana.
    document.getElementById("region").value = "";
    limpiarSelect("departamento");
    limpiarSelect("municipio");
    limpiarSelect("areaGeografica");
    limpiarManzanaAutocomplete();
    limpiarSelect("supervisor");
    limpiarSelect("encuestador");
    document.getElementById("tipoUnidad").value = "";
    document.getElementById("totalViviendas").value = "";
    document.getElementById("muestra").value = "";
    mostrarMensajeInicial("Seleccione una nueva manzana MGN para iniciar otro recorrido o ábrala desde el histórico.");
    renderizarHistorico();
}

function validarResultadosManzanasCiclo() {
    const pendientes = [];

    // Todas las manzanas que ya fueron cerradas dentro del ciclo deben
    // conservar un resultado de manzana antes de permitir otro guardado.
    (app.historialManzanas || []).forEach((h, i) => {
        const resultado = String(h.resultadoManzana || "").trim();
        if (!resultado) {
            const tipo = h.tipo === "PADRE"
                ? "Manzana padre"
                : `Manzana de reemplazo ${h.reemplazoNumero || (i + 1)}`;
            pendientes.push(`${tipo}${h.mgn ? ` (${h.mgn})` : ""}`);
        }
    });

    // La manzana actualmente abierta también debe tener resultado.
    if (app.manzanaActual && app.estadoRecorrido !== "INCIDENCIA_MANZANA") {
        const resultadoActual = String(app.resultadoManzana || "").trim();
        if (!resultadoActual) {
            const tipoActual = app.manzanaActual.tipo === "PADRE"
                ? "Manzana padre"
                : `Manzana de reemplazo ${app.manzanaActual.reemplazoNumero || (app.reemplazoManzanaActual + 1)}`;
            pendientes.push(`${tipoActual}${app.manzanaActual.mgn ? ` (${app.manzanaActual.mgn})` : ""}`);
        }
    }

    if (pendientes.length) {
        mostrarAvisoCRC(
            "No es posible guardar el recorrido todavía.\n\n" +
            "Debe registrar el RESULTADO DE LA MANZANA en todas las manzanas " +
            "del ciclo antes de guardar o finalizar.\n\n" +
            "Pendientes:\n• " + pendientes.join("\n• ")
        );
        return false;
    }

    return true;
}


function cicloAgotadoSinMeta() {
    if (!app.grupoActual || !app.manzanaActual) return false;
    if (efectivasGrupo() >= metaGrupo()) return false;

    // Si la manzana actual fue cerrada como NO TRABAJADA, sus viviendas
    // no deben bloquear el cierre: no fueron objeto de visita.
    // El único requisito adicional es que ya no exista otro reemplazo
    // de manzana disponible.
    if (app.estadoRecorrido === "INCIDENCIA_MANZANA") {
        if (!String(app.resultadoManzana || "").trim()) return false;
        return app.reemplazoManzanaActual >= (app.grupoActual.reemplazos || []).length;
    }

    // Todas las viviendas de la manzana actualmente abierta deben tener
    // resultado antes de considerar agotado el ciclo.
    if (!app.viviendas.length || tienePendientes()) return false;

    // El resultado de la manzana es obligatorio para cerrar el ciclo.
    if (!String(app.resultadoManzana || "").trim()) return false;

    // No puede quedar otra manzana de reemplazo por utilizar.
    if (app.reemplazoManzanaActual < (app.grupoActual.reemplazos || []).length) return false;

    // Tampoco puede quedar una vivienda de reemplazo disponible en la
    // manzana actual. En ALEATORIO, el universo válido es 1..conteo real.
    if (app.modoSeleccionActual === "ALEATORIO") {
        const conteo = Number(app.conteoRealActual);
        if (!Number.isInteger(conteo) || conteo <= 0) return false;
        const usadas = new Set(app.viviendas.map(v => String(v.vivienda)));
        const quedanEnUniverso = Array.from({ length: conteo }, (_, i) => String(i + 1))
            .some(v => !usadas.has(v));
        if (quedanEnUniverso) return false;
    } else {
        if (siguienteReemplazoVivienda() !== null) return false;
    }

    return true;
}

function guardarRecorridoParcial() {
    if (!app.manzanaActual || !app.viviendas.length) {
        mostrarAvisoCRC("Primero debe iniciar/cargar el recorrido de esta manzana.");
        return;
    }
    if (!validarResultadosManzanasCiclo()) return;
    if (app.estadoRecorrido === "FINALIZADA") {
        mostrarAvisoCRC("Esta manzana ya está finalizada y se encuentra en solo lectura.");
        return;
    }
    app.estadoRecorrido = "PARCIAL";
    guardarSnapshotYSincronizar("RECORRIDO_PARCIAL");
    const sincronizado = app.sincronizacionActual === "SINCRONIZADA";
    mostrarAvisoCRC("✓ RECORRIDO GUARDADO PARCIALMENTE.\n\nLa manzana queda disponible para retomarla posteriormente." +
          (sincronizado ? "\n\n✓ Ya fue sincronizada con el servidor." : "\n\nQuedó pendiente de sincronización y se enviará automáticamente cuando haya conexión."));
    limpiarParaSiguienteManzana();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function finalizarYGuardarRecorrido() {
    const incidenciaAgotada =
        app.estadoRecorrido === "INCIDENCIA_MANZANA" &&
        cicloAgotadoSinMeta();

    if (!app.manzanaActual || (!app.viviendas.length && !incidenciaAgotada)) {
        mostrarAvisoCRC("Primero debe iniciar/cargar el recorrido de esta manzana.");
        return;
    }
    if (!validarResultadosManzanasCiclo()) return;
    if (app.estadoRecorrido === "FINALIZADA") {
        mostrarAvisoCRC("Esta manzana ya está finalizada y se encuentra en solo lectura.");
        return;
    }

    // La meta de finalización pertenece al GRUPO (padre + reemplazos),
    // no a la última manzana abierta. Las efectivas de las manzanas ya
    // recorridas están en historialManzanas y las de la actual en viviendas.
    const meta = metaGrupo();
    const efectivas = efectivasGrupo();

    const agotamientoTotal = cicloAgotadoSinMeta();

    if (efectivas < meta && !agotamientoTotal) {
        mostrarAvisoCRC("El ciclo todavía no puede finalizarse.\n\nMeta del grupo: " + meta + " efectivas.\nRecolectadas en el ciclo: " + efectivas + ".\nFaltan: " + (meta - efectivas) + ".\n\nUse GUARDAR RECORRIDO PARCIAL para retomarlo después.");
        return;
    }

    // Una incidencia agotada cierra el grupo aunque conserve viviendas
    // pendientes, porque esas viviendas no fueron visitadas.
    if (!incidenciaAgotada && tienePendientes()) {
        mostrarAvisoCRC("No puede finalizar mientras existan viviendas con resultado PENDIENTE.");
        return;
    }

    app.estadoRecorrido = "FINALIZADA";
    app.modoSoloLectura = true;
    // El recorrido acaba de cerrarse: eliminar inmediatamente cualquier
    // borrador de esta manzana para que un refresh no lo ofrezca de nuevo.
    eliminarBorradorLocal();
    guardarSnapshotYSincronizar("RECORRIDO_FINALIZADO");
    const sincronizado = app.sincronizacionActual === "SINCRONIZADA";
    mostrarAvisoCRC(agotamientoTotal
        ? "✓ RECORRIDO FINALIZADO.\n\nSe agotaron todas las viviendas y manzanas de reemplazo disponibles.\nEfectivas recolectadas: " + efectivas + " de " + meta + ".\nLa meta no fue alcanzada por agotamiento del universo operativo." +
          (sincronizado ? "\n\n✓ Ya fue sincronizada con el servidor." : "\n\nQuedó pendiente de sincronización y se enviará automáticamente cuando haya conexión.")
        : "✓ RECORRIDO FINALIZADO.\n\nSe alcanzó la meta del grupo de " + meta + " encuesta(s) efectiva(s)." +
          (sincronizado ? "\n\n✓ Ya fue sincronizada con el servidor." : "\n\nQuedó pendiente de sincronización y se enviará automáticamente cuando haya conexión."));
    limpiarParaSiguienteManzana();
    eliminarBorradorLocal();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ==================================================
// GENERACIÓN / CARGA DE SELECCIÓN
// ==================================================

function generarSeleccion() {
    if (app.estadoRecorrido === "FINALIZADA") {
        mostrarAvisoCRC("Esta manzana ya está FINALIZADA. No se permite generar una nueva selección ni modificar su recorrido.");
        return;
    }

    if (!app.datosCargados || !app.manzanaActual) {
        mostrarAvisoCRC("Seleccione una manzana válida.");
        return;
    }

    const conteo = parseInt(document.getElementById("conteoReal").value, 10);
    const esperado = app.manzanaActual.tvivienda;
    const meta = app.manzanaActual.meta || 0;

    if (!Number.isInteger(conteo) || conteo <= 0) {
        mostrarAvisoCRC("Debe ingresar el conteo real de viviendas de la manzana.");
        return;
    }

    app.llaveActual = generarLlave();
    if (localStorage.getItem(app.llaveActual)) {
        mostrarAvisoCRC("Esta manzana ya tiene un recorrido guardado. Selecciónela nuevamente para continuar desde el histórico.");
        return;
    }

    app.idRecorrido = app.idRecorrido || generarIdRecorrido();
    app.estadoRecorrido = "PARCIAL";
    app.conteoRealActual = conteo;
    app.modoSeleccionActual = (conteo === esperado && app.manzanaActual.tipo === "PADRE") ? "PRECARGA" : "ALEATORIO";
    app.reemplazoManzanaActual = 0;
    app.historialManzanas = [];

    // IMPORTANTE: cuando el conteo difiere, nunca se cargan las viviendas
    // precargadas. Se sortea exactamente sobre el universo contado en campo.
    if (conteo === esperado && app.manzanaActual.tipo === "PADRE") {
        cargarSeleccionPrecargada(meta);
    } else {
        generarSeleccionAleatoria(conteo, meta);
    }

    guardarSeleccion();
    guardarSnapshotYSincronizar("SELECCION_GENERADA");
    mostrarTabla();
    actualizarBotonesRecorrido();
}

function cargarSeleccionPrecargada(meta) {
    const fuente = (app.viviendasPorMgn.get(app.manzanaActual.mgn) || [])
        .filter(v => v.fuente === "MUESTRA")
        .slice();

    if (!fuente.length) {
        generarSeleccionAleatoria(app.conteoRealActual, meta);
        app.modoSeleccionActual = "ALEATORIO";
        return;
    }

    const seleccionadas = fuente.filter(v => v.hogarEncuestar > 0).slice(0, meta);

    if (seleccionadas.length < meta) {
        mostrarAvisoCRC("La muestra no contiene suficientes viviendas precargadas para cumplir la meta. Se generará un nuevo sorteo.");
        generarSeleccionAleatoria(app.conteoRealActual, meta);
        app.modoSeleccionActual = "ALEATORIO";
        return;
    }

    app.viviendas = seleccionadas.map((v, indice) => crearRegistroVivienda(v, indice + 1, "SELECCIONADA", "MUESTRA"));
}

function generarSeleccionAleatoria(conteo, meta) {
    const universo = Array.from({ length: conteo }, (_, i) => i + 1);
    const seleccion = mezclar(universo).slice(0, meta);

    app.viviendas = seleccion.map((numeroVivienda, indice) => ({
        orden: indice + 1,
        vivienda: String(numeroVivienda),
        idVivienda: app.manzanaActual.mgn + "-" + String(numeroVivienda),
        aleatorio: Math.random(),
        seleccionada: true,
        estado: "Seleccionada",
        resultado: "Pendiente",
        fuente: "ALEATORIO",
        hogarEncuestar: 1,
        esReemplazoVivienda: false
    }));
}

function mezclar(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function crearRegistroVivienda(v, orden, estado = "Seleccionada", fuente = "MUESTRA") {
    return {
        orden,
        vivienda: v.viv,
        idVivienda: v.idVivienda,
        aleatorio: null,
        seleccionada: true,
        estado,
        resultado: "Pendiente",
        fuente,
        hogarEncuestar: v.hogarEncuestar || 1,
        esReemplazoVivienda: fuente === "REEMPLAZO_VIVIENDA"
    };
}

// ==================================================
// RESULTADOS Y REEMPLAZOS DE VIVIENDA
// ==================================================

const resultados = [
    "Pendiente",
    "Efectiva",
    "Rechazo",
    "Nadie atiende",
    "Informante idóneo ausente",
    "No cumple filtros",
    "Inseguridad",
    "Comercial",
    "Desocupado"
];

function efectivasActuales() {
    return app.viviendas.filter(v => v.resultado === "Efectiva").length;
}

function efectivasGrupo() {
    const historicas = app.historialManzanas.reduce((total, h) => {
        return total + (h.viviendas || []).filter(v => v.resultado === "Efectiva").length;
    }, 0);
    return historicas + efectivasActuales();
}

function metaGrupo() {
    return app.grupoActual?.padre && app.manzanas.get(app.grupoActual.padre)
        ? (app.manzanas.get(app.grupoActual.padre).meta || 0)
        : (app.manzanaActual?.meta || 0);
}

function obtenerReemplazosViviendaDisponibles() {
    if (!app.manzanaActual) return [];

    // V9: el universo de reemplazos se toma directamente del archivo
    // Muestra_V5.1_reemplazos_viviendas, sin ningún límite artificial.
    return (app.reemplazosViviendaPorMgn.get(app.manzanaActual.mgn) || [])
        .slice()
        .sort((a, b) => a.ordenReemplazo - b.ordenReemplazo);
}

function siguienteReemplazoVivienda() {
    const disponibles = obtenerReemplazosViviendaDisponibles();
    const usados = new Set(
        app.viviendas
            .filter(v => v.esReemplazoVivienda)
            .map(v => texto(v.idVivienda))
    );

    // Se recorre TODO el listado en el orden entregado por el muestrista.
    // No existe límite de 12, 20, 50, etc.
    return disponibles.find(v => !usados.has(texto(v.idVivienda))) || null;
}

function esResultadoNoEfectivo(valor) {
    return valor === "Rechazo" ||
           valor === "Nadie atiende" ||
           valor === "Inseguridad" ||
           valor === "Informante idóneo ausente" ||
           valor === "No cumple filtros" ||
           valor === "Comercial" ||
           valor === "Desocupado";
}

function tienePendientes() {
    return app.viviendas.some(v => v.resultado === "Pendiente");
}

function cambiarResultado(indice, valor) {
    if (app.estadoRecorrido === "FINALIZADA") {
        mostrarAvisoCRC("Esta manzana está COMPLETA y se encuentra en modo solo lectura.");
        mostrarTabla();
        return;
    }

    if (!app.viviendas[indice]) return;

    if (app.resultadoManzana !== "TRABAJADA") {
        mostrarAvisoCRC("Primero debe indicar el resultado de la manzana: SE PUEDE TRABAJAR.");
        mostrarTabla();
        return;
    }

    const vivienda = app.viviendas[indice];
    const anterior = vivienda.resultado;

    // No hacemos nada si el usuario vuelve a seleccionar el mismo resultado.
    if (anterior === valor) return;

    vivienda.resultado = valor;

    // Nunca se permite superar la meta del grupo.
    if (efectivasGrupo() > metaGrupo()) {
        vivienda.resultado = anterior || "Pendiente";
        mostrarAvisoCRC("La meta de encuestas de este grupo ya fue alcanzada. No se permiten más efectivas.");
        mostrarTabla();
        return;
    }

    if (efectivasGrupo() < metaGrupo()) {
        // Cada resultado NO EFECTIVO debe liberar inmediatamente una vivienda
        // de reemplazo. La cantidad de reemplazos se reconcilia contra TODO el
        // recorrido, no contra la última fila modificada. Esto evita que los
        // reemplazos aparezcan únicamente cuando se diligencia el último registro.
        asegurarReemplazosVivienda();
    }

    if (app.estadoRecorrido === "NUEVO") {
        app.estadoRecorrido = "PARCIAL";
    }
    guardarSeleccion();
    encolarRegistroSync(construirRegistroSync(vivienda, "RESULTADO"));
    reemplazarSnapshotEnCola(construirSnapshotRecorrido("SNAPSHOT_RECORRIDO"));
    mostrarTabla();
    actualizarBotonesRecorrido();
}

function asegurarReemplazosVivienda() {
    if (!app.manzanaActual) return 0;
    if (efectivasGrupo() >= metaGrupo()) return 0;

    const noEfectivas = app.viviendas.filter(v => esResultadoNoEfectivo(v.resultado)).length;
    let reemplazosActuales = app.viviendas.filter(v => v.esReemplazoVivienda).length;
    let agregados = 0;

    // Mientras existan más resultados no efectivos que reemplazos cargados,
    // habilitamos los siguientes reemplazos en el orden del muestrista.
    // También funciona al recuperar un recorrido parcial ya guardado.
    while (reemplazosActuales < noEfectivas && efectivasGrupo() < metaGrupo()) {
        const antes = app.viviendas.length;
        const creado = activarSiguienteReemplazoVivienda();
        if (!creado || app.viviendas.length === antes) break;
        reemplazosActuales++;
        agregados++;
    }

    return agregados;
}

function activarSiguienteReemplazoVivienda() {
    if (efectivasGrupo() >= metaGrupo()) return false;

    // IMPORTANTE: una vivienda con resultado no efectivo debe habilitar
    // inmediatamente su reemplazo, aunque todavía existan otras viviendas
    // pendientes. Cada rechazo/nadie atiende/inseguridad libera una siguiente
    // vivienda de reemplazo; no se debe bloquear por pendientes de otras filas.

    if (app.modoSeleccionActual === "PRECARGA") {
        const reemplazo = siguienteReemplazoVivienda();
        if (!reemplazo) return false;

        app.viviendas.push(crearRegistroVivienda(
            reemplazo,
            app.viviendas.length + 1,
            "Reemplazo",
            "REEMPLAZO_VIVIENDA"
        ));
        return true;
    }

    // En modo ALEATORIO el universo es exclusivamente el conteo real de campo.
    const usadas = new Set(app.viviendas.map(v => String(v.vivienda)));
    const candidatos = Array.from(
        { length: Number(app.conteoRealActual) },
        (_, i) => String(i + 1)
    ).filter(v => !usadas.has(v));

    if (!candidatos.length) return false;

    const viv = candidatos[Math.floor(Math.random() * candidatos.length)];
    app.viviendas.push({
        orden: app.viviendas.length + 1,
        vivienda: viv,
        idVivienda: app.manzanaActual.mgn + "-" + viv,
        aleatorio: Math.random(),
        seleccionada: true,
        estado: "Reemplazo",
        resultado: "Pendiente",
        fuente: "ALEATORIO_REEMPLAZO",
        hogarEncuestar: 1,
        esReemplazoVivienda: true
    });
    return true;
}

// Alias conservado para compatibilidad con cualquier llamada antigua.
function activarReemplazoVivienda() {
    return activarSiguienteReemplazoVivienda();
}

// ==================================================
// REEMPLAZO DE MANZANA
// ==================================================

// ==================================================

function recorridoActualCompleto() {

    return app.viviendas.length > 0 &&
           app.viviendas.every(v => v.resultado !== "Pendiente");

}

function puedeActivarReemplazoManzana() {
    if (!app.grupoActual) return false;
    if (efectivasGrupo() >= metaGrupo()) return false;
    if (!recorridoActualCompleto()) return false;
    if (app.reemplazoManzanaActual >= app.grupoActual.reemplazos.length) return false;

    // REGLA AISLADA — NO CAMBIA LA SELECCIÓN:
    // En modo ALEATORIO el universo de la manzana es EXCLUSIVAMENTE el
    // conteo real digitado en campo. Por tanto, la manzana queda agotada
    // cuando ya no existe ningún número de vivienda de 1..conteoRealActual
    // que pueda visitarse.
    //
    // En modo PRECARGA se conserva exactamente la lógica anterior: la
    // disponibilidad de reemplazos se determina con el archivo de
    // reemplazos de vivienda del muestrista.
    if (app.modoSeleccionActual === "ALEATORIO") {
        const conteo = Number(app.conteoRealActual);
        if (!Number.isInteger(conteo) || conteo <= 0) return false;

        const usadas = new Set(
            app.viviendas.map(v => String(v.vivienda))
        );
        const quedanViviendasEnUniverso = Array.from(
            { length: conteo },
            (_, i) => String(i + 1)
        ).some(v => !usadas.has(v));

        // Si todavía queda al menos una vivienda del universo real,
        // NO se habilita aún la manzana de reemplazo.
        if (quedanViviendasEnUniverso) return false;

        return true;
    }

    // Modo PRECARGA: mantener intacta la lógica que ya funcionaba.
    if (siguienteReemplazoVivienda() !== null) return false;

    return true;
}

function obtenerAccion(v) {
    if (v.resultado === "Efectiva") return "Finalizada";
    if (v.resultado === "Rechazo" ||
        v.resultado === "Nadie atiende" ||
        v.resultado === "Informante idóneo ausente" ||
        v.resultado === "No cumple filtros" ||
        v.resultado === "Comercial" ||
        v.resultado === "Desocupado") return "Visitar reemplazo";
    if (v.resultado === "Inseguridad") return "Decisión supervisor";
    return "Visitar";
}

function generarResumen() {
    const total = app.viviendas.length;
    const pendientes = app.viviendas.filter(v => v.resultado === "Pendiente").length;
    const efectivas = efectivasGrupo();
    const rechazos = app.viviendas.filter(v => v.resultado === "Rechazo").length;
    const nadie = app.viviendas.filter(v => v.resultado === "Nadie atiende").length;
    const inseguridad = app.viviendas.filter(v => v.resultado === "Inseguridad").length;
    const comercial = app.viviendas.filter(v => v.resultado === "Comercial").length;
    const desocupado = app.viviendas.filter(v => v.resultado === "Desocupado").length;

    return `
        <div class="resumen">
            <b>Manzana actual:</b> ${escaparHTML(app.manzanaActual?.mgn || "")}
            &nbsp; | &nbsp; <b>Tipo:</b> ${escaparHTML(app.manzanaActual?.tipo || "")}
            &nbsp; | &nbsp; <b>Meta grupo:</b> ${metaGrupo()}
            &nbsp; | &nbsp; <b>Universo actual:</b> ${app.conteoRealActual || 0}
            &nbsp; | &nbsp; <b>Visitadas actual:</b> ${total}
            &nbsp; | &nbsp; <b>Pendientes:</b> ${pendientes}
            &nbsp; | &nbsp; <b>Efectivas grupo:</b> ${efectivas}
            &nbsp; | &nbsp; <b>Rechazos actual:</b> ${rechazos}
            &nbsp; | &nbsp; <b>Nadie atiende actual:</b> ${nadie}
            &nbsp; | &nbsp; <b>Inseguridad actual:</b> ${inseguridad}
            &nbsp; | &nbsp; <b>Comercial actual:</b> ${comercial}
            &nbsp; | &nbsp; <b>Desocupado actual:</b> ${desocupado}
        </div>
    `;
}

function tablaViviendas(viviendas, editable = true) {
    let html = "<div class='tabla-scroll'><table>";
    html += `
        <tr>
            <th>Orden</th>
            <th>Vivienda</th>
            <th>ID_VIV</th>
            <th>Estado</th>
            <th>Resultado</th>
            <th>Siguiente acción</th>
        </tr>`;

    viviendas.forEach((v, i) => {
        const resultado = editable
            ? `<select onchange="cambiarResultado(${i}, this.value)">
                ${resultados.map(r => `<option value="${escaparHTML(r)}" ${v.resultado === r ? "selected" : ""}>${escaparHTML(r)}</option>`).join("")}
               </select>`
            : `<span>${escaparHTML(v.resultado)}</span>`;

        html += `
            <tr class="${v.seleccionada ? "seleccionada" : "reserva"}">
                <td>${v.orden}</td>
                <td>${escaparHTML(v.vivienda)}</td>
                <td><b>${escaparHTML(v.idVivienda)}</b></td>
                <td>${escaparHTML(v.estado)}</td>
                <td>${resultado}</td>
                <td>${escaparHTML(obtenerAccion(v))}</td>
            </tr>`;
    });

    return html + "</table></div>";
}

function mostrarTabla() {
    if (!app.viviendas.length && !app.historialManzanas.length && app.estadoRecorrido !== "INCIDENCIA_MANZANA") {
        document.getElementById("resultado").innerHTML = "";
        return;
    }

    const editable = app.estadoRecorrido !== "FINALIZADA" && app.estadoRecorrido !== "INCIDENCIA_MANZANA";
    const cierrePorAgotamiento = cicloAgotadoSinMeta();
    const puedeOperarAcciones = app.estadoRecorrido !== "FINALIZADA" && (app.estadoRecorrido !== "INCIDENCIA_MANZANA" || cierrePorAgotamiento);
    let html = "<h2>Recorrido de la manzana</h2>";
    html += generarResumen();

    if (app.estadoRecorrido === "FINALIZADA") {
        html += `<div class="bloque-solo-lectura"><b>🔒 MANZANA FINALIZADA — SOLO LECTURA.</b> Los resultados ya cerrados no pueden modificarse.</div>`;
    } else if (app.estadoRecorrido === "INCIDENCIA_MANZANA") {
        html += `<div class="bloque-incidencia"><b>⚠ MANZANA NO TRABAJADA — ${escaparHTML(app.motivoManzanaCompleto || app.motivoManzana || "Incidencia de campo")}</b><br>La manzana quedó cerrada y se activó la manzana de reemplazo correspondiente.</div>`;
    } else if (app.estadoRecorrido === "PARCIAL") {
        html += `<div class="grupo-progreso"><b>Recorrido en curso.</b> Puede guardar parcialmente para retomarlo posteriormente.</div>`;
    }

    app.historialManzanas.forEach((h) => {
        html += `
            <div class="bloque-historial-manzana">
                <div class="titulo-historial">
                    <b>${h.tipo === "PADRE" ? "Manzana de muestra" : "Manzana de reemplazo " + (h.reemplazoNumero || "")}</b>
                    &nbsp; | &nbsp; MGN: ${escaparHTML(h.mgn)}
                    &nbsp; | &nbsp; Conteo: ${h.conteoReal}
                    &nbsp; | &nbsp; Efectivas: ${(h.viviendas || []).filter(v => v.resultado === "Efectiva").length}
                </div>
                ${tablaViviendas(h.viviendas || [], false)}
            </div>`;
    });

    // Una manzana recién activada como reemplazo todavía no tiene conteo ni
    // selección. En ese punto no debe aparecer como una tabla con "Conteo: null".
    // El formulario superior es el único que debe solicitar el conteo real.
    const manzanaActualIniciada = !!app.manzanaActual && (
        app.viviendas.length > 0 ||
        Number.isInteger(app.conteoRealActual)
    );

    if (editable && app.manzanaActual && manzanaActualIniciada) {
        html += `
            <div class="panel-resultado-manzana">
                <div><b>Resultado de la manzana</b><span class="ayuda-manzana">Si la manzana no puede trabajarse, se cierra como incidencia y se activa su manzana de reemplazo.</span></div>
                <select id="resultadoManzana" onchange="cambiarResultadoManzana(this.value)">
                    <option value="">Seleccione...</option>
                    <option value="TRABAJADA" ${app.resultadoManzana === "TRABAJADA" ? "selected" : ""}>Se puede trabajar</option>
                    <option value="NO_TRABAJADA" ${app.resultadoManzana === "NO_TRABAJADA" ? "selected" : ""}>No se puede trabajar</option>
                </select>
                <div id="motivoManzanaPanel"></div>
            </div>`;
    }

    if (manzanaActualIniciada && app.resultadoManzana === "TRABAJADA") {
        html += `
            <div class="bloque-manzana-actual">
                <div class="titulo-actual">
                    <b>${app.manzanaActual.tipo === "PADRE" ? "Manzana de muestra" : "Manzana de reemplazo " + app.manzanaActual.reemplazoNumero}</b>
                    &nbsp; | &nbsp; MGN: ${escaparHTML(app.manzanaActual.mgn)}
                    &nbsp; | &nbsp; Conteo: ${app.conteoRealActual}
                </div>
                ${tablaViviendas(app.viviendas, editable)}
            </div>`;
    } else if (manzanaActualIniciada && !app.resultadoManzana) {
        html += `
            <div class="grupo-progreso">
                <b>Antes de iniciar el recorrido de viviendas debe registrar el resultado de la manzana.</b>
                Seleccione <b>Se puede trabajar</b> para habilitar las viviendas, o <b>No se puede trabajar</b> para registrar el motivo y activar el reemplazo.
            </div>`;
    } else if (app.manzanaActual && app.manzanaActual.tipo === "REEMPLAZO" && !manzanaActualIniciada) {
        html += `
            <div class="grupo-progreso">
                <b>Manzana de reemplazo ${app.manzanaActual.reemplazoNumero} activada.</b>
                Ingrese el conteo real de viviendas en el formulario superior para iniciar la selección.
            </div>`;
    }

    if (app.estadoRecorrido === "INCIDENCIA_MANZANA" && puedeActivarReemplazoManzanaPorIncidencia()) {
        const numeroReemplazo = app.reemplazoManzanaActual + 1;
        const faltan = metaGrupo() - efectivasGrupo();
        html += `
            <div class="bloque-reemplazo-manzana">
                <b>La manzana fue marcada como NO TRABAJADA.</b>
                <p>Motivo: <b>${escaparHTML(app.motivoManzanaCompleto || app.motivoManzana || "Incidencia de campo")}</b></p>
                <p>Aún faltan ${faltan} encuesta(s) efectivas. Se habilita la manzana de reemplazo ${numeroReemplazo}, respetando el orden de la muestra.</p>
                <button onclick="mostrarFormularioReemplazoManzana()">ACTIVAR REEMPLAZO DE MANZANA ${numeroReemplazo}</button>
                <div id="formConteoReemplazo"></div>
            </div>`;
    } else if (editable && puedeActivarReemplazoManzana()) {
        const numeroReemplazo = app.reemplazoManzanaActual + 1;
        const faltan = metaGrupo() - efectivasGrupo();
        html += `
            <div class="bloque-reemplazo-manzana">
                <b>La manzana fue recorrida y aún faltan ${faltan} encuesta(s) efectivas.</b>
                <p>Se habilita la manzana de reemplazo ${numeroReemplazo}, respetando el orden de la muestra.</p>
                <button onclick="mostrarFormularioReemplazoManzana()">ACTIVAR REEMPLAZO DE MANZANA ${numeroReemplazo}</button>
                <div id="formConteoReemplazo"></div>
            </div>`;
    }

    const puedeCerrarUI = cicloListoParaCerrar();
    const puedeGuardarParcialUI = !!app.viviendas.length &&
        app.estadoRecorrido !== "FINALIZADA" &&
        app.estadoRecorrido !== "INCIDENCIA_MANZANA" &&
        efectivasGrupo() < metaGrupo() &&
        !cicloAgotadoSinMeta();

    html += `
        <div class="acciones-recorrido">
            <div class="estado-recorrido">
                <b>Estado del recorrido:</b> ${escaparHTML(app.estadoRecorrido || "NUEVO")}
                &nbsp; | &nbsp; <b>Sincronización:</b> ${escaparHTML(app.sincronizacionActual || "PENDIENTE")}
                &nbsp; | &nbsp; <b>ID:</b> ${escaparHTML(app.idRecorrido || "Sin asignar")}
            </div>
            ${puedeOperarAcciones ? `
                ${puedeGuardarParcialUI ? `<button id="btnParcial" class="secundario" onclick="guardarRecorridoParcial()">GUARDAR RECORRIDO PARCIAL</button>` : ""}
                ${puedeCerrarUI ? `<button id="btnFinalizar" onclick="finalizarYGuardarRecorrido()">CERRAR Y SINCRONIZAR GRUPO</button>` : ""}` : `
                <button disabled>${app.estadoRecorrido === "INCIDENCIA_MANZANA" ? "MANZANA NO TRABAJADA — SOLO LECTURA" : "MANZANA FINALIZADA — SOLO LECTURA"}</button>`}
        </div>`;
    html += generarEstadoGrupo();
    document.getElementById("resultado").innerHTML = html;
    renderizarPanelResultadoManzana();
    actualizarBotonesRecorrido();
}


const motivosIncidenciaManzana = [
    "Inseguridad",
    "Manzana no existe",
    "Manzana no localizada",
    "Acceso imposible",
    "Otro"
];

function renderizarPanelResultadoManzana() {
    const panel = document.getElementById("motivoManzanaPanel");
    if (!panel) return;
    if (app.resultadoManzana !== "NO_TRABAJADA") {
        panel.innerHTML = "";
        return;
    }

    const detalleActual = app.detalleMotivoManzana || "";
    const motivoActual = app.motivoManzana || "";
    panel.innerHTML = `
        <label for="motivoManzana">Motivo de no realización <span class="campo-obligatorio">*</span></label>
        <select id="motivoManzana" onchange="cambiarMotivoIncidenciaManzana(this.value)">
            <option value="">Seleccione el motivo...</option>
            ${motivosIncidenciaManzana.map(m => `<option value="${escaparHTML(m)}" ${motivoActual === m ? "selected" : ""}>${escaparHTML(m)}</option>`).join("")}
        </select>
        <div id="detalleMotivoManzanaPanel">
            ${motivoActual ? `
                <label for="detalleMotivoManzana">${motivoActual === "Otro" ? "¿Cuál es el otro motivo?" : "Explique brevemente el motivo"} <span class="campo-obligatorio">*</span></label>
                <textarea id="detalleMotivoManzana" rows="3" maxlength="500" placeholder="Escriba el motivo...">${escaparHTML(detalleActual)}</textarea>
                <button type="button" class="secundario" onclick="confirmarIncidenciaManzanaDesdeFormulario()">CONFIRMAR RESULTADO DE LA MANZANA</button>
            ` : ""}
        </div>
        <div class="ayuda-incidencia">El motivo y su explicación son obligatorios para cualquier manzana que no pueda trabajarse.</div>`;
}

function cambiarMotivoIncidenciaManzana(motivo) {
    if (app.estadoRecorrido === "FINALIZADA" || app.estadoRecorrido === "INCIDENCIA_MANZANA") return;
    app.motivoManzana = motivo || "";
    app.detalleMotivoManzana = "";
    renderizarPanelResultadoManzana();
}

function confirmarIncidenciaManzanaDesdeFormulario() {
    const motivo = document.getElementById("motivoManzana")?.value || "";
    const detalle = document.getElementById("detalleMotivoManzana")?.value.trim() || "";
    confirmarIncidenciaManzana(motivo, detalle);
}

function cambiarResultadoManzana(valor) {
    if (app.estadoRecorrido === "FINALIZADA" || app.estadoRecorrido === "INCIDENCIA_MANZANA") return;
    if (valor === "TRABAJADA") {
        app.resultadoManzana = "TRABAJADA";
        app.motivoManzana = "";
        guardarSeleccion();
        mostrarTabla();
        return;
    }
    if (valor === "NO_TRABAJADA") {
        app.resultadoManzana = "NO_TRABAJADA";
        app.motivoManzana = "";
        mostrarTabla();
    }
}

function confirmarIncidenciaManzana(motivo, detalle = "") {
    detalle = String(detalle || "").trim();
    if (!motivo || app.estadoRecorrido === "FINALIZADA" || app.estadoRecorrido === "INCIDENCIA_MANZANA") return;
    if (!detalle) {
        mostrarAvisoCRC("Debe explicar el motivo antes de confirmar el resultado de la manzana.");
        renderizarPanelResultadoManzana();
        return;
    }

    const tieneResultados = app.viviendas.some(v => v.resultado && v.resultado !== "Pendiente");
    const advertencia = tieneResultados
        ? "\n\nYa existen resultados diligenciados en esta manzana. Se conservarán en el registro, pero la manzana quedará cerrada como incidencia."
        : "";

    const mensajeConfirmacion =
        `¿Confirma cerrar la manzana como NO TRABAJADA por: ${motivo}?${advertencia}\n\n` +
        "La manzana quedará cerrada y el reemplazo se habilitará en el bloque inferior del recorrido.";

    mostrarConfirmacionCRC(mensajeConfirmacion, "Confirmar cierre de manzana").then(confirmar => {
        if (!confirmar) {
            app.resultadoManzana = "";
            app.motivoManzana = "";
            app.detalleMotivoManzana = "";
            app.motivoManzanaCompleto = "";
            mostrarTabla();
            return;
        }

        app.resultadoManzana = "NO_TRABAJADA";
        app.motivoManzana = motivo;
        app.detalleMotivoManzana = detalle;
        app.motivoManzanaCompleto = `${motivo}: ${detalle}`;
        app.estadoRecorrido = "INCIDENCIA_MANZANA";
        app.modoSoloLectura = true;

        // La incidencia se conserva localmente, pero NO se sincroniza todavía.
        // Si aún existe un reemplazo, el grupo continúa abierto. La
        // sincronización ocurre únicamente cuando el grupo completo se cierre.
        guardarSeleccion();
        mostrarTabla();
        renderizarHistorico();

        const siguiente = app.grupoActual?.reemplazos?.[app.reemplazoManzanaActual];
        if (!siguiente) {
            mostrarAvisoCRC(`✓ Incidencia registrada: ${motivo}.\n\nNo hay una manzana de reemplazo disponible en el archivo operativo para este grupo.`, "success");
            return;
        }

        // NO cambiar todavía la manzana actual. El reemplazo se activa
        // explícitamente desde el bloque inferior, igual que el flujo normal.
        mostrarAvisoCRC(`✓ Incidencia registrada: ${motivo}.\n\nLa manzana quedó cerrada. El reemplazo de manzana ${app.reemplazoManzanaActual + 1} quedó disponible en el bloque inferior.`, "success");
    });

}

function puedeActivarReemplazoManzanaPorIncidencia() {
    if (app.estadoRecorrido !== "INCIDENCIA_MANZANA") return false;
    if (!app.grupoActual) return false;
    if (efectivasGrupo() >= metaGrupo()) return false;
    return app.reemplazoManzanaActual < app.grupoActual.reemplazos.length;
}

function activarReemplazoManzanaPorIncidencia() {
    // Conservamos este nombre por compatibilidad con versiones anteriores.
    // La activación ahora pasa siempre por el formulario INLINE de conteo.
    mostrarFormularioReemplazoManzana();
}

function generarEstadoGrupo() {
    if (!app.grupoActual) return "";

    const efectivas = efectivasGrupo();
    const meta = metaGrupo();

    if (efectivas >= meta) {
        return `<div class="grupo-cerrado">✓ Meta del grupo alcanzada: ${efectivas} de ${meta} efectivas.</div>`;
    }

    return `<div class="grupo-progreso">Grupo: ${efectivas} de ${meta} efectivas.</div>`;
}

function puedeAbrirFormularioReemplazoManzana() {
    if (!app.grupoActual) return false;
    if (efectivasGrupo() >= metaGrupo()) return false;

    const esIncidencia = app.estadoRecorrido === "INCIDENCIA_MANZANA";
    const esRecorridoAgotado = app.estadoRecorrido !== "FINALIZADA" && puedeActivarReemplazoManzana();

    if (!esIncidencia && !esRecorridoAgotado) return false;
    return app.reemplazoManzanaActual < app.grupoActual.reemplazos.length;
}

function mostrarFormularioReemplazoManzana() {
    if (!puedeAbrirFormularioReemplazoManzana()) return;

    const numeroReemplazo = app.reemplazoManzanaActual + 1;
    const siguiente = app.grupoActual.reemplazos[app.reemplazoManzanaActual];
    if (!siguiente) return;

    const contenedor = document.getElementById("formConteoReemplazo");
    if (!contenedor) return;

    contenedor.innerHTML = `
        <div class="form-conteo-reemplazo">
            <label>Conteo real de viviendas — Manzana de reemplazo ${numeroReemplazo}</label>
            <input type="number" id="conteoReemplazo" min="1" step="1" placeholder="Digite el conteo real">
            <div class="ayuda-reemplazo">MGN: <b>${escaparHTML(siguiente.mgn)}</b> | Viviendas según muestra: <b>${siguiente.tvivienda}</b> | Faltan efectivas del grupo: <b>${metaGrupo() - efectivasGrupo()}</b></div>
            <button onclick="confirmarReemplazoManzana()">CONTINUAR CON ESTA MANZANA</button>
        </div>`;

    document.getElementById("conteoReemplazo")?.focus();
}

function confirmarReemplazoManzana() {
    if (!puedeAbrirFormularioReemplazoManzana()) return;

    const siguiente = app.grupoActual.reemplazos[app.reemplazoManzanaActual];
    if (!siguiente) return;

    const conteoNumero = parseInt(document.getElementById("conteoReemplazo")?.value, 10);
    const faltan = metaGrupo() - efectivasGrupo();

    if (!Number.isInteger(conteoNumero) || conteoNumero <= 0) {
        mostrarAvisoCRC("Debe ingresar un conteo válido de viviendas.");
        return;
    }

    // Guardamos la manzana que acaba de cerrarse dentro del mismo recorrido.
    const eraIncidencia = app.estadoRecorrido === "INCIDENCIA_MANZANA";
    app.historialManzanas.push({
        mgn: app.manzanaActual.mgn,
        tipo: app.manzanaActual.tipo,
        reemplazoNumero: app.manzanaActual.reemplazoNumero || 0,
        conteoReal: app.conteoRealActual,
        modoSeleccion: app.modoSeleccionActual,
        viviendas: JSON.parse(JSON.stringify(app.viviendas || [])),
        resultadoManzana: eraIncidencia ? "NO_TRABAJADA" : (app.resultadoManzana || "TRABAJADA"),
        motivoManzana: eraIncidencia ? (app.motivoManzana || "Incidencia de campo") : "",
        estadoRecorrido: eraIncidencia ? "INCIDENCIA_MANZANA" : app.estadoRecorrido
    });

    app.reemplazoManzanaActual++;
    app.manzanaActual = siguiente;
    app.idRecorrido = generarIdRecorrido();
    app.llaveActual = null;
    app.viviendas = [];
    app.conteoRealActual = conteoNumero;
    app.modoSeleccionActual = "ALEATORIO";
    app.estadoRecorrido = "EN_PROCESO";
    app.modoSoloLectura = false;
    app.resultadoManzana = "";
    app.motivoManzana = "";
    app.detalleMotivoManzana = "";
    app.motivoManzanaCompleto = "";
    app.sincronizacionActual = "PENDIENTE";
    app.ultimaActualizacion = null;
    app.fechaTrabajo = new Date().toISOString();

    prepararContextoManzana(siguiente);
    document.getElementById("manzana").value = siguiente.mgn;
    document.getElementById("conteoReal").value = conteoNumero;
    document.getElementById("conteoReal").disabled = false;
    actualizarEstadoConteo();
    mostrarGrupoReemplazos();

    // Una manzana de reemplazo utiliza exclusivamente su conteo real de campo.
    generarSeleccionAleatoria(conteoNumero, faltan);
    app.viviendas.forEach(v => v.estado = "Manzana reemplazo " + siguiente.reemplazoNumero);

    app.llaveActual = generarLlave();
    guardarSeleccion();
    guardarSnapshotYSincronizar("SELECCION_GENERADA");
    mostrarTabla();
    renderizarHistorico();
    actualizarBotonesRecorrido();
}

// ==================================================
// RESUMEN DE ARCHIVOS / ESTADO
// ==================================================

function mostrarResumenDatos() {
    const contenedor = document.getElementById("resumenDatos");
    if (!contenedor) {
        console.warn("No existe #resumenDatos; se omite el resumen visual sin detener la aplicación.");
        return;
    }
    const mgnPrincipales = app.muestra.map(f => claveMgn(f.MGN)).filter(Boolean);
    contenedor.innerHTML = `
        <div class="tarjetas">
            <div><strong>${new Set(mgnPrincipales).size}</strong><span>manzanas con muestra</span></div>
            <div><strong>${app.muestra.length}</strong><span>registros de vivienda</span></div>
            <div><strong>${app.grupos.size}</strong><span>grupos de reemplazo</span></div>
            <div><strong>${app.reemplazosManzanas.length}</strong><span>registros de manzana</span></div>
            <div><strong>${app.reemplazosViviendas.length}</strong><span>registros de reemplazo de vivienda</span></div>
        </div>`;
}

function cambiarEstado(mensaje, tipo) {
    const elemento = document.getElementById("estadoCarga");
    if (!elemento) {
        console.warn("No existe #estadoCarga:", mensaje);
        return;
    }
    elemento.textContent = mensaje;
    elemento.className = "estado " + tipo;
}

function habilitar(...ids) {
    ids.forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.disabled = false;
    });
}
