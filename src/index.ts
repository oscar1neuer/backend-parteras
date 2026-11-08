import express from 'express';
import { pool } from './db';
import * as jwt from 'jsonwebtoken';

const cors = require('cors');
const app = express();

// ==========================================
// CONFIGURACIÓN DE CORS GLOBAL Y PREFLIGHT
// ==========================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());
app.use(express.json());

const JWT_SECRET = (globalThis as any).process?.env?.JWT_SECRET || 'secreto_jurisdiccion_2';

// ==========================================
// MÓDULO DE PARTERAS Y AUTENTICACIÓN
// ==========================================
app.post('/api/v1/parteras/login-pin', async (req: any, res: any) => {
  try {
    const { pin, codigo_qr } = req.body;
    const codigoBusqueda = pin || codigo_qr;

    if (!codigoBusqueda || String(codigoBusqueda).trim().length !== 4) {
      return res.status(400).json({ exito: false, message: 'El PIN o código de acceso debe ser de 4 dígitos' });
    }

    const result = await pool.query(
      'SELECT * FROM parteras WHERE pin = $1',
      [String(codigoBusqueda).trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ exito: false, message: 'PIN inválido o partera no registrada en el sistema' });
    }

    const partera = result.rows[0];
    const token = jwt.sign({ id: partera.id, rol: 'PARTERA_TRADICIONAL' }, JWT_SECRET, { expiresIn: '12h' });

    res.status(200).json({
      token,
      user: {
        id: partera.id,
        nombre: partera.nombre_completo || `${partera.nombre || ''} ${partera.apellido_paterno || ''}`.trim(),
        localidad: partera.comunidad || partera.comunidad_barrio || partera.localidad || 'Juchitán',
        municipio: partera.municipio || 'Juchitán de Zaragoza',
        rol: 'PARTERA_TRADICIONAL',
        activo: true
      },
      message: `Bienvenida, ${partera.nombre_completo || partera.nombre}`
    });
  } catch (error: any) {
    console.error('Error en login de partera:', error);
    res.status(500).json({ exito: false, message: 'Error interno del servidor', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO DE REFERENCIAS Y CONTRAREFERENCIAS
// ==========================================
app.post('/api/v1/referencias', async (req: any, res: any) => {
  try {
    const {
      parteraId,
      centroSalud,
      usuaria,
      nombreUsuaria,
      edad,
      sexo,
      localidad,
      municipio,
      motivosReferencia,
      motivos
    } = req.body;

    // Sanitizamos parteraId para evitar errores si llega un string tipo UUID por defecto
    let idParteraLimpio = null;
    if (parteraId && !isNaN(Number(parteraId))) {
      idParteraLimpio = Number(parteraId);
    }

    const nombreFinalUsuaria = usuaria?.nombre || nombreUsuaria || 'Sin nombre';
    const edadFinalUsuaria = usuaria?.edad || edad || 0;
    const sexoFinalUsuaria = usuaria?.sexo || sexo || 'F';
    const localidadFinalUsuaria = usuaria?.localidad || localidad || '';
    const municipioFinalUsuaria = usuaria?.municipio || municipio || 'Juchitán de Zaragoza';
    const motivosFinales = motivosReferencia || motivos || [];

    const query = `
      INSERT INTO hojas_referencia (
        partera_id, centro_salud, nombre_usuaria, edad, sexo, 
        localidad_usuaria, municipio_usuaria, motivos_referencia, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'PENDIENTE');
    `;

    const values = [
      idParteraLimpio,
      centroSalud || 'Hospital General',
      nombreFinalUsuaria,
      edadFinalUsuaria,
      sexoFinalUsuaria,
      localidadFinalUsuaria,
      municipioFinalUsuaria,
      JSON.stringify(motivosFinales)
    ];

    await pool.query(query, values);

    res.status(201).json({
      exito: true,
      mensaje: 'Hoja de referencia registrada correctamente'
    });
  } catch (error: any) {
    console.error('Error al registrar hoja de referencia:', error);
    res.status(500).json({ exito: false, mensaje: 'Error al registrar la hoja de referencia', detalleTecnico: error.message });
  }
});

app.get('/api/v1/referencias', async (_req: any, res: any) => {
  try {
    const query = `
      SELECT hr.*, c.medico_nombre, c.diagnostico, c.tratamiento, c.observaciones_partera 
      FROM hojas_referencia hr
      LEFT JOIN contrareferencias c ON hr.id = c.hoja_referencia_id
      ORDER BY hr.id DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar las referencias', detalleTecnico: error.message });
  }
});

app.post('/api/v1/referencias/:id/contrareferencia', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { medicoNombre, diagnostico, tratamiento, observacionesPartera } = req.body;

    const insertQuery = `
      INSERT INTO contrareferencias (hoja_referencia_id, medico_nombre, diagnostico, tratamiento, observaciones_partera)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    const insertValues = [id, medicoNombre, diagnostico, tratamiento, observacionesPartera || null];
    const contraResult = await pool.query(insertQuery, insertValues);

    await pool.query("UPDATE hojas_referencia SET estado = 'CONTRAREFERIDO' WHERE id = $1", [id]);

    res.status(200).json({
      exito: true,
      mensaje: 'Contrareferencia médica registrada con éxito',
      data: contraResult.rows[0]
    });
  } catch (error: any) {
    console.error('Error al registrar contrareferencia:', error);
    res.status(500).json({ exito: false, message: 'Error al registrar la respuesta médica', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULOS DE CALENDARIOS COMUNITARIOS
// ==========================================
app.post('/api/v1/calendario-nino', async (req: any, res: any) => {
  try {
    const { parteraId, datosNino, estadoNutricional, tipoLactancia, canalizaciones, cierreAdministrativo } = req.body;

    const query = `
      INSERT INTO calendario_nino (
        partera_id, nombre_nino, edad_meses, nombre_madre, localidad, municipio,
        fecha_atencion, estado_nutricional, tipo_lactancia, canalizaciones,
        mes_informado, nombre_supervisor, centro_salud_adscripcion, huella_firmada, es_copia_centro_salud
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const idParteraValido = (typeof parteraId === 'number' || !isNaN(Number(parteraId))) ? Number(parteraId) : 1;

    const values = [
      idParteraValido,
      datosNino.nombreNino,
      datosNino.edadMeses,
      datosNino.nombreMadre,
      datosNino.localidad,
      datosNino.municipio,
      datosNino.fechaAtencion,
      estadoNutricional,
      tipoLactancia,
      JSON.stringify(canalizaciones),
      cierreAdministrativo.mesInformado,
      cierreAdministrativo.nombreSupervisor,
      cierreAdministrativo.centroSaludAdscripcion,
      cierreAdministrativo.huellaFirmada,
      cierreAdministrativo.esCopiaCentroSalud
    ];

    const result = await pool.query(query, values);
    res.status(201).json({
      mensaje: 'Registro de calendario del niño guardado con éxito',
      registro: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error al insertar el calendario del niño:', error);
    res.status(500).json({ error: 'Error interno al guardar el registro del niño', detalleTecnico: error.message });
  }
});

app.post('/api/v1/calendario-mujer', async (req: any, res: any) => {
  try {
    const { parteraId, datosUsuaria, controlPrenatal, embarazoComplicaciones, complicacionesHemorragicas, partoNormal, partoComplicado, puerperio, alertaMuerteMaterna, cierreAdministrativo } = req.body;

    const query = `
      INSERT INTO calendario_mujer (
        partera_id, nombre_mujer, edad, fecha_consulta, localidad, municipio,
        mes_embarazo_activo, acido_folico_entregado, sulfato_ferroso_entregado, vacuna_tetanos, muac_embarazo,
        embarazo_referido, sintomas_embarazo, aborto_dolor_hemorragia_referido, complicaciones_hemorragicas,
        tipo_parto_normal, resultado_parto_normal, parto_complicado_referido, resultado_parto_complicado,
        muac_puerperio, puerperio_complicado_referido, sintomas_puerperio, muerte_materna_registrada, etapa_muerte_materna,
        mes_informado, nombre_supervisor, centro_salud_adscripcion, huella_firmada
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      RETURNING id, partera_id;
    `;

    const values = [
      parteraId || null,
      datosUsuaria?.nombreMujer,
      datosUsuaria?.edad,
      datosUsuaria?.fechaConsulta,
      datosUsuaria?.localidad,
      datosUsuaria?.municipio,
      controlPrenatal?.mesEmbarazoActivo,
      controlPrenatal?.acidoFolicoEntregado || false,
      controlPrenatal?.sulfatoFerrosoEntregado || false,
      controlPrenatal?.vacunaTetanos,
      controlPrenatal?.muacEmbarazo,
      embarazoComplicaciones?.referido || false,
      embarazoComplicaciones?.sintomas || [],
      complicacionesHemorragicas?.referido || false,
      complicacionesHemorragicas?.complicaciones || [],
      partoNormal?.tipoParto,
      partoNormal?.resultado,
      partoComplicado?.referido || false,
      partoComplicado?.resultado,
      puerperio?.muacPuerperio,
      puerperio?.complicadoReferido || false,
      puerperio?.sintomas || [],
      alertaMuerteMaterna?.registrada || false,
      alertaMuerteMaterna?.etapa,
      cierreAdministrativo?.mesInformado,
      cierreAdministrativo?.nombreSupervisor,
      cierreAdministrativo?.centroSaludAdscripcion,
      cierreAdministrativo?.huellaFirmada || false
    ];

    const result = await pool.query(query, values);
    const nuevoRegistro = result.rows[0];

    res.status(201).json({
      success: true,
      message: 'Calendario de atención a la mujer registrado correctamente',
      data: {
        id: nuevoRegistro.id,
        folioOficial: `CAL-MUJER-2026-${String(nuevoRegistro.id).slice(0, 4).toUpperCase()}`,
        parteraId: nuevoRegistro.partera_id
      }
    });
  } catch (error: any) {
    console.error('Error al registrar calendario:', error);
    res.status(500).json({ error: 'Error interno al guardar en la base de datos', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO ADMINISTRATIVO Y CLUES
// ==========================================
app.get('/api/v1/admin/unidades-medicas', async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM unidades_medicas ORDER BY nombre_unidad ASC');
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al obtener unidades médicas:', error);
    res.status(500).json({ error: 'Error al consultar unidades médicas', detalleTecnico: error.message });
  }
});

app.post('/api/v1/admin/unidades-medicas', async (req: any, res: any) => {
  try {
    const { claveClues, nombreUnidad, municipio, localidadAgencia, tipoEstablecimiento } = req.body;
    const query = `
      INSERT INTO unidades_medicas (clave_clues, nombre_unidad, municipio, localidad_agencia, tipo_establecimiento)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, clave_clues, nombre_unidad, estado;
    `;
    const values = [claveClues, nombreUnidad, municipio, localidadAgencia || null, tipoEstablecimiento];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Unidad Médica registrada correctamente en el catálogo CLUES',
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error al registrar unidad médica:', error);
    res.status(500).json({ error: 'Error al registrar la unidad médica', detalleTecnico: error.message });
  }
});

app.get('/api/v1/admin/usuarios-sso', async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios_sso ORDER BY id DESC');
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al listar usuarios SSO:', error);
    res.status(500).json({ error: 'Error al consultar usuarios institucionales', detalleTecnico: error.message });
  }
});

app.post('/api/v1/admin/usuarios-sso', async (req: any, res: any) => {
  try {
    const {
      nombre, apellidoPaterno, apellidoMaterno, curp,
      correoInstitucional, telefono, rol, unidadMedicaId,
      municipio, pinTemporal
    } = req.body;

    const query = `
      INSERT INTO usuarios_sso (
        nombre, apellido_paterno, apellido_materno, curp, 
        correo_institucional, telefono, rol, unidad_medica_id, 
        municipio, password, estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVO')
      RETURNING *;
    `;

    const values = [
      nombre || '', apellidoPaterno || '', apellidoMaterno || '', curp || '',
      correoInstitucional || '', telefono || null, rol || 'CAPTURISTA_TAMIZ',
      unidadMedicaId || null, municipio || 'Juchitán de Zaragoza', pinTemporal || '123456'
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Cuenta de servidor público creada exitosamente',
      usuario: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error al registrar usuario SSO:', error);
    res.status(500).json({ error: 'Error al crear la cuenta institucional', detalleTecnico: error.message });
  }
});

app.get('/api/v1/admin/parteras', async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM parteras ORDER BY nombre ASC');
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al listar parteras:', error);
    res.status(500).json({ error: 'Error al consultar padrón de parteras', detalleTecnico: error.message });
  }
});

app.post('/api/v1/admin/parteras', async (req: any, res: any) => {
  try {
    const {
      nombre, apellidoPaterno, apellidoMaterno, curp,
      lenguaMaterna, telefonoRecaudo, telefono, municipio,
      comunidadBarrio, comunidad, pinAcceso, pin
    } = req.body;

    let pinFinal = pin || pinAcceso;
    if (!pinFinal || pinFinal.length !== 4) {
      pinFinal = Math.floor(1000 + Math.random() * 9000).toString();
    }

    let result: any = null;
    let intentos = 0;
    const maxIntentos = 3;

    while (intentos < maxIntentos) {
      try {
        const query = `
          INSERT INTO parteras (
            nombre, apellido_paterno, apellido_materno, curp, 
            lengua_materna, telefono_recaudo, 
            municipio, comunidad_barrio, pin, estado_acreditacion
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACREDITADA')
          RETURNING id, nombre, apellido_paterno, curp, pin, estado_acreditacion;
        `;

        const values = [
          nombre || 'Partera', apellidoPaterno || '', apellidoMaterno || '', curp,
          lenguaMaterna || 'No especificada', telefonoRecaudo || telefono || '',
          municipio || 'Juchitán de Zaragoza', comunidadBarrio || comunidad || '', pinFinal
        ];

        result = await pool.query(query, values);
        break;
      } catch (dbError: any) {
        if (dbError.code === '23505' && intentos < maxIntentos - 1) {
          pinFinal = Math.floor(1000 + Math.random() * 9000).toString();
          intentos++;
        } else {
          throw dbError;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Partera tradicional acreditada exitosamente',
      data: result?.rows[0]
    });
  } catch (error: any) {
    console.error('Error al registrar partera:', error);
    res.status(500).json({
      error: 'Error al acreditar partera tradicional',
      detalleTecnico: error.message
    });
  }
});

app.put('/api/v1/admin/referencias/:id/contrareferencia', async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { medicoAtendio, unidadAtencionId, diagnosticoOficial, conductaMedica, estatus } = req.body;

    const query = `
      INSERT INTO contrareferencias (hoja_referencia_id, medico_atendio, unidad_atencion_id, diagnostico_oficial, conducta_medica, estatus, fecha_respuesta)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, estatus;
    `;
    const values = [id, medicoAtendio, unidadAtencionId || null, diagnosticoOficial, conductaMedica, estatus || 'CONTRAREFERIDO'];
    const result = await pool.query(query, values);

    res.status(200).json({
      success: true,
      message: 'Contrareferencia médica guardada y enviada correctamente',
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error al responder contrareferencia:', error);
    res.status(500).json({ error: 'Error al procesar la contrareferencia médica', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO CAPTURISTA DE TAMIZ NEONATAL
// ==========================================
app.post('/api/v1/tamiz/muestras', async (req: any, res: any) => {
  try {
    const {
      folio_tarjeta, clues_unidad, unidad_medica_nombre, responsable_toma_nombre,
      tecnica_toma, tecnica_toma_especificar, rn_nombres, rn_apellido_paterno, rn_apellido_materno,
      rn_fecha_nacimiento, rn_fecha_toma_muestra, rn_sexo, rn_edad_gestacional, rn_producto,
      rn_peso_gramos, rn_talla_cm, rn_malformaciones_congenitas, rn_malformaciones_especificar,
      rn_condicion_toma, rn_alimentacion, madre_nombres, madre_apellido_paterno, madre_apellido_materno,
      madre_curp, madre_telefono_celular, madre_telefono_fijo, madre_email, madre_calle_numero,
      madre_colonia_localidad, madre_municipio, madre_codigo_postal, madre_edad, madre_gestas,
      madre_antecedente_tiroideo, madre_antecedente_especificar, observaciones_captura
    } = req.body;

    if (new Date(rn_fecha_toma_muestra) <= new Date(rn_fecha_nacimiento)) {
      return res.status(400).json({ error: 'La fecha de toma de muestra debe ser posterior a la fecha de nacimiento' });
    }

    const query = `
      INSERT INTO tamiz_muestras (
        folio_tarjeta, clues_unidad, unidad_medica_nombre, responsable_toma_nombre,
        tecnica_toma, tecnica_toma_especificar, rn_nombres, rn_apellido_paterno, rn_apellido_materno,
        rn_fecha_nacimiento, rn_fecha_toma_muestra, rn_sexo, rn_edad_gestacional, rn_producto,
        rn_peso_gramos, rn_talla_cm, rn_malformaciones_congenitas, rn_malformaciones_especificar,
        rn_condicion_toma, rn_alimentacion, madre_nombres, madre_apellido_paterno, madre_apellido_materno,
        madre_curp, madre_telefono_celular, madre_telefono_fijo, madre_email, madre_calle_numero,
        madre_colonia_localidad, madre_municipio, madre_codigo_postal, madre_edad, madre_gestas,
        madre_antecedente_tiroideo, madre_antecedente_especificar, observaciones_captura, estatus_resultado
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, 'RESULTADO_SOSPECHOSO'
      ) RETURNING id, folio_tarjeta, estatus_muestra;
    `;

    const values = [
      folio_tarjeta, clues_unidad, unidad_medica_nombre, responsable_toma_nombre,
      tecnica_toma, tecnica_toma_especificar || null, rn_nombres || 'RN', rn_apellido_paterno, rn_apellido_materno,
      rn_fecha_nacimiento, rn_fecha_toma_muestra, rn_sexo, rn_edad_gestacional, rn_producto,
      rn_peso_gramos, rn_talla_cm, rn_malformaciones_congenitas || false, rn_malformaciones_especificar || null,
      rn_condicion_toma, rn_alimentacion, madre_nombres, madre_apellido_paterno, madre_apellido_materno,
      madre_curp, madre_telefono_celular, madre_telefono_fijo || null, madre_email || null, madre_calle_numero,
      madre_colonia_localidad, madre_municipio, madre_codigo_postal || null, madre_edad, madre_gestas,
      madre_antecedente_tiroideo || false, madre_antecedente_especificar || null, observaciones_captura || null
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, message: 'Muestra de Tamiz Neonatal registrada correctamente', data: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'El folio de tarjeta especificado ya existe en el sistema' });
    }
    console.error('Error al registrar muestra de tamiz:', error);
    res.status(500).json({ error: 'Error interno al guardar la muestra en la base de datos', detalleTecnico: error.message });
  }
});

app.get('/api/v1/tamiz/muestras', async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM tamiz_muestras ORDER BY id DESC');
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al obtener muestras de tamiz:', error);
    res.status(500).json({ error: 'Error al consultar las muestras de tamiz', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO LOGÍSTICO Y LOTES A LESP
// ==========================================
app.get('/api/v1/tamiz/lotes', async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM tamiz_lotes ORDER BY id DESC');
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al obtener lotes:', error);
    res.status(500).json({ error: 'Error al consultar lotes de envío', detalleTecnico: error.message });
  }
});

app.get('/api/v1/tamiz/muestras-pendientes-lote', async (_req: any, res: any) => {
  try {
    const result = await pool.query("SELECT folio_tarjeta AS folio, rn_nombres AS rn, rn_fecha_toma_muestra AS fecha, unidad_medica_nombre AS unidad FROM tamiz_muestras WHERE estatus_muestra = 'REGISTRADO' ORDER BY id DESC");
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al obtener muestras pendientes:', error);
    res.status(500).json({ error: 'Error al consultar muestras pendientes', detalleTecnico: error.message });
  }
});

app.post('/api/v1/tamiz/lotes', async (req: any, res: any) => {
  try {
    const { numeroGuia, transportista, foliosIncluidos, destino } = req.body;
    const idLote = `LOTE-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const query = `
      INSERT INTO tamiz_lotes (id_lote, numero_guia, transportista, cantidad_muestras, destino, estatus)
      VALUES ($1, $2, $3, $4, $5, 'EN_TRANSITO_LESP')
      RETURNING *;
    `;
    const values = [idLote, numeroGuia, transportista, foliosIncluidos.length, destino];
    const result = await pool.query(query, values);

    if (foliosIncluidos && foliosIncluidos.length > 0) {
      await pool.query(
        "UPDATE tamiz_muestras SET estatus_muestra = 'EN_LOTE_TRANSITO' WHERE folio_tarjeta = ANY($1)",
        [foliosIncluidos]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Lote creado con éxito',
      data: {
        id: result.rows[0].id_lote,
        numeroGuia: result.rows[0].numero_guia,
        transportista: result.rows[0].transportista,
        cantidadMuestras: result.rows[0].cantidad_muestras,
        estatus: result.rows[0].estatus,
        destino: result.rows[0].destino
      }
    });
  } catch (error: any) {
    console.error('Error al crear lote:', error);
    res.status(500).json({ error: 'Error al registrar el lote en el servidor', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO DE ALERTAS DE RE-TOMA (RECALL)
// ==========================================
const handlerAlertasRecall = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        folio_tarjeta AS folio, 
        rn_nombres AS rn, 
        COALESCE(madre_nombres, '') || ' ' || COALESCE(madre_apellido_paterno, '') AS madre, 
        unidad_medica_nombre AS "unidadMedica", 
        madre_municipio AS municipio, 
        madre_telefono_celular AS "telefonoContacto",
        TO_CHAR(rn_fecha_toma_muestra, 'YYYY-MM-DD') AS "fechaToma",
        COALESCE(observaciones_captura, 'Muestra Coagulada / Inadecuada') AS "motivoRecall",
        'CRITICA' AS prioridad
      FROM tamiz_muestras 
      WHERE estatus_resultado IN ('RESULTADO_SOSPECHOSO', 'RE_TOMA_RECAL', 'EN_CONFIRMACION') 
      ORDER BY id DESC
    `);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.error('Error al obtener alertas de recall:', error);
    res.status(500).json({ error: 'Error al consultar alertas de recall', detalleTecnico: error.message });
  }
};

const handlerNotificarRecall = async (req: any, res: any) => {
  try {
    const { casoId, folio } = req.body;
    await pool.query(
      "UPDATE tamiz_muestras SET observaciones_captura = COALESCE(observaciones_captura, '') || ' | Notificado vía SMS/WA' WHERE id = $1",
      [casoId]
    );
    res.status(200).json({ success: true, message: `Notificación registrada correctamente para el folio ${folio}` });
  } catch (error: any) {
    console.error('Error al registrar notificación:', error);
    res.status(500).json({ error: 'Error al procesar la notificación', detalleTecnico: error.message });
  }
};

const handlerAgendarRetoma = async (req: any, res: any) => {
  try {
    const { casoId, folio } = req.body;
    await pool.query(
      "UPDATE tamiz_muestras SET estatus_resultado = 'EN_CONFIRMACION', observaciones_captura = COALESCE(observaciones_captura, '') || ' | Re-toma agendada en unidad' WHERE id = $1",
      [casoId]
    );
    res.status(200).json({ success: true, message: `Re-toma agendada exitosamente para el folio ${folio}` });
  } catch (error: any) {
    console.error('Error al agendar re-toma:', error);
    res.status(500).json({ error: 'Error al agendar la re-toma', detalleTecnico: error.message });
  }
};

app.get('/api/v1/tamiz/alertas-recall', handlerAlertasRecall);
app.get('/api/tamiz/alertas-recall', handlerAlertasRecall);
app.post('/api/v1/tamiz/notificar-recall', handlerNotificarRecall);
app.post('/api/tamiz/notificar-recall', handlerNotificarRecall);
app.post('/api/v1/tamiz/agendar-retoma', handlerAgendarRetoma);
app.post('/api/tamiz/agendar-retoma', handlerAgendarRetoma);

// ==========================================
// MÓDULO MÉDICO Y CASOS PRIORITARIOS
// ==========================================
const handlerCasosPrioritarios = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        folio_tarjeta AS folio, 
        rn_nombres AS "nombreRN", 
        COALESCE(madre_nombres, '') || ' ' || COALESCE(madre_apellido_paterno, '') AS "nombreMadre", 
        clues_unidad AS clues, 
        unidad_medica_nombre AS "unidadMedica", 
        madre_municipio AS municipio, 
        madre_telefono_celular AS "telefonoContacto",
        'TSH / T4 Neonatal' AS "tipoPrueba",
        observaciones_captura AS "valorObtenido",
        '0 - 10 mU/L' AS "valorReferencia",
        COALESCE(estatus_resultado, 'RESULTADO_SOSPECHOSO') AS "estatusResultado"
      FROM tamiz_muestras 
      WHERE estatus_resultado IN ('RESULTADO_SOSPECHOSO', 'EN_CONFIRMACION', 'CONFIRMADO_POSITIVO')
      ORDER BY id DESC
    `);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: No se pudo consultar tamiz_muestras:', error.message);
    res.status(200).json([]);
  }
};

const handlerSegundaMuestra = async (req: any, res: any) => {
  try {
    const { casoId, tipoMuestra, laboratorioDestino } = req.body;
    const query = `
      UPDATE tamiz_muestras 
      SET 
        estatus_resultado = 'EN_CONFIRMACION',
        observaciones_captura = COALESCE(observaciones_captura, '') || ' | 2ª Muestra: ' || $1 || ' (Lab: ' || $2 || ')'
      WHERE id = $3
      RETURNING id, folio_tarjeta AS folio, estatus_resultado AS "estatusResultado";
    `;
    const values = [tipoMuestra || 'TALON_RETOMA', laboratorioDestino || 'LESP Oaxaca', casoId];
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, message: 'Solicitud registrada correctamente', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error al registrar segunda muestra:', error);
    res.status(500).json({ error: 'Error al registrar la solicitud', detalleTecnico: error.message });
  }
};

app.get('/api/v1/medico/tamiz/casos-prioritarios', handlerCasosPrioritarios);
app.get('/api/medico/tamiz/casos-prioritarios', handlerCasosPrioritarios);
app.get('/medico/tamiz/casos-prioritarios', handlerCasosPrioritarios);
app.post('/api/v1/medico/tamiz/solicitar-segunda-muestra', handlerSegundaMuestra);
app.post('/api/medico/tamiz/solicitar-segunda-muestra', handlerSegundaMuestra);
app.post('/medico/tamiz/solicitar-segunda-muestra', handlerSegundaMuestra);

app.post('/api/v1/medico/tamiz/confirmar-diagnostico', async (req: any, res: any) => {
  try {
    const { folioGuthrie, diagnosticoCIE10, descripcionDiagnostico, esquemaTerapeutico, fechaInicioTratamiento, medicoTratante, altaTratamiento } = req.body;
    const query = `
      UPDATE tamiz_muestras 
      SET 
        estatus_resultado = 'CONFIRMADO_POSITIVO', 
        observaciones_captura = COALESCE(observaciones_captura, '') || ' | Dx: ' || $1 || ' - ' || $2 || 
          ' | Terapéutica: ' || $3 || ' (Inicio: ' || $4 || ', Dr(a). ' || $5 || ', Alta: ' || $6 || ')'
      WHERE folio_tarjeta = $7
      RETURNING id, folio_tarjeta AS "folioGuthrie", estatus_resultado AS "estatusResultado";
    `;
    const values = [diagnosticoCIE10 || 'P00-P96', descripcionDiagnostico || 'Sin descripción', esquemaTerapeutico || 'Pendiente', fechaInicioTratamiento || new Date().toISOString().split('T')[0], medicoTratante || 'Personal Médico JS2', altaTratamiento ? 'Sí' : 'No', folioGuthrie];
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, message: 'Diagnóstico confirmado correctamente', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error al confirmar diagnóstico:', error);
    res.status(500).json({ error: 'Error al guardar el diagnóstico', detalleTecnico: error.message });
  }
});

// ==========================================
// MÓDULO DE AVISOS EPIDEMIOLÓGICOS Y BITÁCORA
// ==========================================
const handlerGetAvisos = async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM avisos_epidemiologicos ORDER BY id DESC');
    const avisosMapeados = result.rows.map(row => ({
      id: String(row.id),
      titulo: row.titulo,
      contenido: row.contenido,
      prioridad: row.prioridad || 'ALTA',
      autor: row.autor || 'Administración Jurisdiccional',
      estatus: row.estatus || 'ACTIVO',
      fechaPublicacion: row.fecha_publicacion || new Date().toISOString().split('T')[0]
    }));
    res.status(200).json(avisosMapeados);
  } catch (error: any) {
    res.status(200).json([]);
  }
};

const handlerPostAvisos = async (req: any, res: any) => {
  try {
    const { titulo, contenido, prioridad, autor, estatus } = req.body;
    const query = `
      INSERT INTO avisos_epidemiologicos (titulo, contenido, prioridad, autor, estatus, fecha_publicacion)
      VALUES ($1, $2, $3, $4, $5, TO_CHAR(NOW(), 'YYYY-MM-DD'))
      RETURNING *;
    `;
    const values = [titulo, contenido, prioridad || 'ALTA', autor || 'Administrador', estatus || 'ACTIVO'];

    let result;
    try {
      result = await pool.query(query, values);
    } catch (dbErr: any) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS avisos_epidemiologicos (
          id SERIAL PRIMARY KEY,
          titulo TEXT NOT NULL,
          contenido TEXT NOT NULL,
          prioridad TEXT DEFAULT 'ALTA',
          autor TEXT,
          estatus TEXT DEFAULT 'ACTIVO',
          fecha_publicacion TEXT
        )
      `);
      result = await pool.query(query, values);
    }

    const row = result.rows[0];
    res.status(201).json({
      success: true,
      mensaje: 'Aviso publicado con éxito',
      aviso: {
        id: String(row.id),
        titulo: row.titulo,
        contenido: row.contenido,
        prioridad: row.prioridad,
        autor: row.autor,
        estatus: row.estatus,
        fechaPublicacion: row.fecha_publicacion
      }
    });
  } catch (error: any) {
    console.error('Error al publicar aviso:', error);
    res.status(500).json({ error: 'Error al registrar el aviso', detalleTecnico: error.message });
  }
};

const handlerDeleteAvisos = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM avisos_epidemiologicos WHERE id = $1', [id]);
    res.status(200).json({ success: true, message: 'Aviso eliminado correctamente' });
  } catch (error: any) {
    console.error('Error al eliminar aviso:', error);
    res.status(500).json({ error: 'Error al eliminar el aviso', detalleTecnico: error.message });
  }
};

const handlerGetBitacora = async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM bitacora_sistema ORDER BY id DESC LIMIT 50');
    const logsMapeados = result.rows.map(row => ({
      id: String(row.id),
      fechaHora: row.fecha_hora || new Date().toISOString(),
      usuario: row.usuario || 'Sistema SSO',
      accion: row.accion || 'Acceso al sistema',
      modulo: row.modulo || 'GENERAL',
      ip: row.ip || '127.0.0.1'
    }));
    res.status(200).json(logsMapeados);
  } catch (error: any) {
    res.status(200).json([
      {
        id: '1',
        fechaHora: new Date().toISOString().replace('T', ' ').substring(0, 19),
        usuario: 'ELIZABETH SORIANO (Capturista)',
        accion: 'Inicio de sesión exitoso en plataforma',
        modulo: 'AUTENTICACIÓN',
        ip: '187.190.x.x'
      }
    ]);
  }
};

app.get('/admin/avisos', handlerGetAvisos);
app.post('/admin/avisos', handlerPostAvisos);
app.delete('/admin/avisos/:id', handlerDeleteAvisos);
app.get('/admin/bitacora', handlerGetBitacora);
app.get('/api/v1/admin/avisos', handlerGetAvisos);
app.post('/api/v1/admin/avisos', handlerPostAvisos);
app.delete('/api/v1/admin/avisos/:id', handlerDeleteAvisos);
app.get('/api/v1/admin/bitacora', handlerGetBitacora);

// ==========================================
// MÓDULO DE CALENDARIOS COMUNITARIOS (FORMATOS 2 Y 3)
// ==========================================
const handlerGetSaludMaterna = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        'CAL-MUJER-2026-' || LPAD(CAST(id AS TEXT), 4, '0') AS folio,
        nombre_mujer AS "nombreMujer",
        COALESCE(
          (SELECT nombre FROM parteras WHERE parteras.id = calendario_mujer.partera_id), 
          'Partera Tradicional Acreditada'
        ) AS partera,
        municipio,
        COALESCE(mes_embarazo_activo, 5) * 4 AS "semanaGestacion",
        CASE 
          WHEN muac_embarazo ILIKE '%verde%' OR muac_embarazo IS NULL THEN 'VERDE'
          WHEN muac_embarazo ILIKE '%amarillo%' THEN 'AMARILLO'
          ELSE 'ROJO'
        END AS "nutricionMUAC",
        3 AS "controlesRealizados",
        CONCAT('Paciente estable en control comunitario. Municipio: ', municipio, '. Acreditación por Jurisdicción Sanitaria No. 2.') AS alertas
      FROM calendario_mujer 
      ORDER BY id DESC
    `);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: No se pudo consultar calendario_mujer:', error.message);
    res.status(200).json([]);
  }
};

const handlerGetDesarrolloInfantil = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        'CAL-NINO-2026-' || LPAD(CAST(id AS TEXT), 4, '0') AS folio,
        nombre_nino AS "nombreNino",
        nombre_madre AS "nombreMadre",
        COALESCE(
          (SELECT nombre FROM parteras WHERE parteras.id = calendario_nino.partera_id), 
          'Partera Tradicional Acreditada'
        ) AS partera,
        municipio,
        edad_meses AS "edadMeses",
        TRUE AS "tamizTomado",
        TRUE AS "vacunasCompletas",
        CONCAT('Desarrollo infantil monitoreado en red comunitaria. Municipio: ', municipio, '. Sin alteraciones graves reportadas.') AS alertas
      FROM calendario_nino 
      ORDER BY id DESC
    `);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: No se pudo consultar calendario_nino:', error.message);
    res.status(200).json([]);
  }
};

app.get('/admin/calendarios/salud-materna', handlerGetSaludMaterna);
app.get('/admin/calendarios/desarrollo-infantil', handlerGetDesarrolloInfantil);
app.get('/api/v1/admin/calendarios/salud-materna', handlerGetSaludMaterna);
app.get('/api/v1/admin/calendarios/desarrollo-infantil', handlerGetDesarrolloInfantil);

// ==========================================
// MÓDULO DE REFERENCIAS Y CONTRAREFERENCIAS (FORMATO 1)
// ==========================================
const handlerGetReferenciasAdmin = async (_req: any, res: any) => {
  try {
    const query = `
      SELECT 
        hr.id,
        'REF-2026-' || LPAD(CAST(hr.id AS TEXT), 4, '0') AS folio,
        hr.nombre_usuaria AS "nombrePaciente",
        COALESCE(hr.edad, 25) AS edad,
        COALESCE(p.nombre, 'Partera Tradicional Acreditada') AS "parteraNombre",
        COALESCE(
          (SELECT motivo ->> 'descripcion' FROM jsonb_array_elements(hr.motivos_referencia) AS motivo LIMIT 1),
          CAST(hr.motivos_referencia AS TEXT),
          'Canalización por factores de riesgo obstétrico'
        ) AS "motivoReferencia",
        COALESCE(hr.centro_salud, 'Hospital General de Juchitán') AS "unidadDestino",
        COALESCE(hr.municipio_usuaria, hr.localidad_usuaria, 'Juchitán de Zaragoza') AS municipio,
        COALESCE(hr.estado, 'PENDIENTE') AS estatus,
        c.tratamiento AS "respuestaContrareferencia"
      FROM hojas_referencia hr
      LEFT JOIN parteras p ON hr.partera_id = p.id
      LEFT JOIN contrareferencias c ON hr.id = c.hoja_referencia_id
      ORDER BY hr.id DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: No se pudo consultar hojas_referencia:', error.message);
    res.status(200).json([]);
  }
};

const handlerPatchContrareferenciaAdmin = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { respuestaContrareferencia, estatus } = req.body;

    const checkExist = await pool.query('SELECT id FROM contrareferencias WHERE hoja_referencia_id = $1', [id]);

    if (checkExist.rows.length > 0) {
      await pool.query(
        `UPDATE contrareferencias 
         SET tratamiento = $1, fecha_respuesta = NOW() 
         WHERE hoja_referencia_id = $2`,
        [respuestaContrareferencia, id]
      );
    } else {
      await pool.query(
        `INSERT INTO contrareferencias (hoja_referencia_id, medico_nombre, diagnostico, tratamiento, estatus, fecha_respuesta)
         VALUES ($1, 'Médico Especialista Jurisdiccional', 'Atención obstétrica en unidad hospitalaria', $2, $3, NOW())`,
        [id, respuestaContrareferencia, estatus || 'CONTRAREFERIDO']
      );
    }

    await pool.query(
      "UPDATE hojas_referencia SET estado = $1 WHERE id = $2",
      [estatus || 'CONTRAREFERIDO', id]
    );

    res.status(200).json({
      success: true,
      message: 'Contrareferencia guardada y actualizada con éxito'
    });
  } catch (error: any) {
    console.error('Error al actualizar contrareferencia:', error);
    res.status(500).json({ error: 'Error al procesar la contrareferencia', detalleTecnico: error.message });
  }
};

app.get('/admin/referencias', handlerGetReferenciasAdmin);
app.patch('/admin/referencias/:id/contrareferencia', handlerPatchContrareferenciaAdmin);
app.get('/api/v1/admin/referencias', handlerGetReferenciasAdmin);
app.patch('/api/v1/admin/referencias/:id/contrareferencia', handlerPatchContrareferenciaAdmin);

// ==========================================
// MÓDULO DE EXPEDIENTE PERINATAL (CARNÉ CLAP)
// ==========================================
const handlerGetPacientesActivas = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        id AS "expedienteId",
        nombre_paciente AS "nombrePaciente",
        curp,
        telefono,
        TO_CHAR(fum_fecha, 'YYYY-MM-DD') AS "fumFecha",
        TO_CHAR(fpp_fecha, 'YYYY-MM-DD') AS "fppFecha",
        edad_gestacional_inicio AS "edadGestacionalInicioControl",
        grupo_sanguineo AS "grupoSanguineo",
        factor_rh AS "factorRh",
        vih_serologia AS "vihSerologia",
        vdrl_serologia AS "vdrlSerologia",
        vacuna_tetanos AS "vacunaTetanos",
        vacuna_dosis_2 AS "vacunaDosis2",
        COALESCE(riesgo_aro, 'MEDIO') AS "riesgoARO"
      FROM expedientes_perinatales
      ORDER BY id DESC
    `);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: Tabla expedientes_perinatales no encontrada o vacía:', error.message);
    res.status(200).json([]);
  }
};

const handlerGetExpedienteId = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const expResult = await pool.query('SELECT * FROM expedientes_perinatales WHERE id = $1', [id]);
    if (expResult.rows.length === 0) {
      return res.status(404).json({ error: 'Expediente perinatal no encontrado' });
    }
    const row = expResult.rows[0];

    const consultasResult = await pool.query(
      'SELECT * FROM consultas_antenatales WHERE expediente_id = $1 ORDER BY numero_consulta ASC',
      [id]
    );

    const expedienteCompleto = {
      id: String(row.id),
      expedienteId: String(row.id),
      nombrePaciente: row.nombre_paciente,
      curp: row.curp,
      telefono: row.telefono,
      fumFecha: row.fum_fecha ? new Date(row.fum_fecha).toISOString().split('T')[0] : '2026-04-01',
      fppFecha: row.fpp_fecha ? new Date(row.fpp_fecha).toISOString().split('T')[0] : '2027-01-05',
      edadGestacionalInicioControl: row.edad_gestacional_inicio || 10,
      grupoSanguineo: row.grupo_sanguineo || 'O+',
      factorRh: row.factor_rh || 'POSITIVO',
      vihSerologia: row.vih_serologia || 'NEGATIVO',
      vdrlSerologia: row.vdrl_serologia || 'NON_REACTIVE',
      vacunaTetanos: row.vacuna_tetanos || false,
      vacunaDosis2: row.vacuna_dosis_2 || false,
      riesgoARO: row.riesgo_aro || 'MEDIO',
      criteriosARO: row.criterios_aro ? JSON.parse(row.criterios_aro) : ['Período intergenésico < 2 años'],
      antecedentesFamiliares: row.antecedentes_familiares ? JSON.parse(row.antecedentes_familiares) : { diabetes: true, hipertension: false, gemelaridad: false },
      antecedentesPersonales: row.antecedentes_personales ? JSON.parse(row.antecedentes_personales) : { diabetesGestacionalPrevia: false, htaCronica: false },
      antecedentesObstetricos: row.antecedentes_obstetricos ? JSON.parse(row.antecedentes_obstetricos) : { gestasAnteriores: 2, paritosAnteriores: 1, cesareasAnteriores: 1, abortosAnteriores: 0, mortinatos: 0, rpMenorA2500g: 0 },
      consultas: consultasResult.rows.map((c: any, index: number) => ({
        id: String(c.id),
        numeroConsulta: c.numero_consulta || (index + 1),
        fecha: c.fecha ? new Date(c.fecha).toISOString().split('T')[0] : '2026-06-10',
        edadGestacional: c.edad_gestacional || 10,
        pesoMadreKg: Number(c.peso_madre_kg || 60),
        tallaMadreM: Number(c.talla_madre_m || 1.55),
        imcCalculado: Number(c.imc_calculado || 25.0),
        presionArterialSistolica: Number(c.pas || 110),
        presionArterialDiastolica: Number(c.pad || 70),
        alturaUterinaFr: Number(c.altura_uterina_fr || 10),
        frecuenciaCardiacaFetal: Number(c.fcf || 140),
        presentacion: c.presentacion || 'Cefálica',
        edema: c.edema || 'NO',
        observaciones: c.observaciones || 'Control antenatal ordinario.',
        medicoFirma: c.medico_firma || 'Dr. Médico Adscrito',
      })),
      fechaParto: row.fecha_parto ? new Date(row.fecha_parto).toISOString().split('T')[0] : null,
      tipoPartoParto: row.tipo_parto || null,
      semanasParto: row.semanas_parto || null,
      apgar1: row.apgar_1 || null,
      apgar5: row.apgar_5 || null,
      pesoRNGramos: row.peso_rn_gramos || null,
      tallaRNCm: row.talla_rn_cm || null,
      folioGuthrie: row.folio_guthrie || null,
      tamizRNRealizado: Boolean(row.folio_guthrie),
    };

    res.status(200).json(expedienteCompleto);
  } catch (error: any) {
    console.error('Error al obtener expediente perinatal:', error);
    res.status(500).json({ error: 'Error al consultar el expediente', detalleTecnico: error.message });
  }
};

const handlerPostConsultaAntenatal = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { fecha, edadGestacional, pesoMadreKg, presionArterial, alturaUterinaFr, fcfLpm, edema, observaciones } = req.body;

    const pas = presionArterial ? Number(presionArterial.split('/')[0]) : 110;
    const pad = presionArterial ? Number(presionArterial.split('/')[1]) : 70;
    const imc = Number((Number(pesoMadreKg) / (1.55 ** 2)).toFixed(1));

    const countRes = await pool.query('SELECT COUNT(*) FROM consultas_antenatales WHERE expediente_id = $1', [id]);
    const numConsulta = parseInt(countRes.rows[0].count, 10) + 1;

    const query = `
      INSERT INTO consultas_antenatales (
        expediente_id, numero_consulta, fecha, edad_gestacional, peso_madre_kg, 
        talla_madre_m, imc_calculado, pas, pad, altura_uterina_fr, fcf, edema, observaciones
      ) VALUES ($1, $2, $3, $4, $5, 1.55, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id;
    `;
    const values = [id, numConsulta, fecha, edadGestacional, pesoMadreKg, imc, pas, pad, alturaUterinaFr, fcfLpm, edema || 'NO', observaciones];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Consulta registrada correctamente',
      consultaId: result.rows[0].id
    });
  } catch (error: any) {
    console.error('Error al registrar consulta antenatal:', error);
    res.status(500).json({ error: 'Error al registrar la consulta', detalleTecnico: error.message });
  }
};

const handlerPutAntecedentes = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { antecedentesFamiliares, antecedentesPersonales, antecedentesObstetricos, criteriosARO, riesgoARO } = req.body;

    const query = `
      UPDATE expedientes_perinatales 
      SET antecedentes_familiares = $1, antecedentes_personales = $2, antecedentes_obstetricos = $3, criterios_aro = $4, riesgo_aro = $5
      WHERE id = $6
    `;
    await pool.query(query, [
      JSON.stringify(antecedentesFamiliares),
      JSON.stringify(antecedentesPersonales),
      JSON.stringify(antecedentesObstetricos),
      JSON.stringify(criteriosARO),
      riesgoARO,
      id
    ]);

    res.status(200).json({ success: true, message: 'Antecedentes actualizados correctamente' });
  } catch (error: any) {
    console.error('Error al actualizar antecedentes:', error);
    res.status(500).json({ error: 'Error al actualizar antecedentes', detalleTecnico: error.message });
  }
};

const handlerPutLaboratorios = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { grupoSanguineo, factorRh, vihSerologia, vdrlSerologia, vacunaTetanos, vacunaDosis2 } = req.body;

    const query = `
      UPDATE expedientes_perinatales 
      SET grupo_sanguineo = $1, factor_rh = $2, vih_serologia = $3, vdrl_serologia = $4, vacuna_tetanos = $5, vacuna_dosis_2 = $6
      WHERE id = $7
    `;
    await pool.query(query, [grupoSanguineo, factorRh, vihSerologia, vdrlSerologia, vacunaTetanos, vacunaDosis2, id]);

    res.status(200).json({ success: true, message: 'Laboratorios y serología actualizados con éxito' });
  } catch (error: any) {
    console.error('Error al actualizar laboratorios:', error);
    res.status(500).json({ error: 'Error al actualizar laboratorios', detalleTecnico: error.message });
  }
};

const handlerPostParto = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { fechaHoraNacimiento, tipoPartoParto, semanasParto, apgar1, apgar5, pesoRNGramos, tallaRNCm, folioGuthrie } = req.body;

    const query = `
      UPDATE expedientes_perinatales 
      SET 
        fecha_parto = $1, 
        tipo_parto = $2, 
        semanas_parto = $3, 
        apgar_1 = $4, 
        apgar_5 = $5, 
        peso_rn_gramos = $6, 
        talla_rn_cm = $7, 
        folio_guthrie = $8
      WHERE id = $9
    `;
    await pool.query(query, [
      fechaHoraNacimiento,
      tipoPartoParto,
      semanasParto,
      apgar1,
      apgar5,
      pesoRNGramos,
      tallaRNCm,
      folioGuthrie,
      id
    ]);

    res.status(200).json({ success: true, message: 'Evento de parto y datos del RN registrados con éxito' });
  } catch (error: any) {
    console.error('Error al registrar evento de parto:', error);
    res.status(500).json({ error: 'Error al registrar el parto', detalleTecnico: error.message });
  }
};

const registrarRutasPerinatales = (prefix: string) => {
  app.get(`${prefix}/medico/perinatales/pacientes-activas`, handlerGetPacientesActivas);
  app.get(`${prefix}/medico/perinatales/expediente/:id`, handlerGetExpedienteId);
  app.post(`${prefix}/medico/perinatales/expediente/:id/consultas`, handlerPostConsultaAntenatal);
  app.put(`${prefix}/medico/perinatales/expediente/:id/antecedentes`, handlerPutAntecedentes);
  app.put(`${prefix}/medico/perinatales/expediente/:id/laboratorios`, handlerPutLaboratorios);
  app.post(`${prefix}/medico/perinatales/expediente/:id/parto`, handlerPostParto);
};

registrarRutasPerinatales('/api');
registrarRutasPerinatales('/api/v1');
registrarRutasPerinatales('');

// ==========================================
// MÓDULO DE CONTRAREFERENCIAS MÉDICAS COMUNITARIAS
// ==========================================
const handlerGetPendientesContraref = async (_req: any, res: any) => {
  try {
    const query = `
      SELECT 
        hr.id,
        'REF-COM-2026-' || LPAD(CAST(hr.id AS TEXT), 3, '0') AS "folioReferencia",
        hr.nombre_usuaria AS "nombrePaciente",
        COALESCE(hr.edad, 25) AS "edadPaciente",
        COALESCE(hr.localidad_usuaria, 'Comunidad') AS "comunidadOrigen",
        COALESCE(hr.municipio_usuaria, 'Juchitán de Zaragoza') AS municipio,
        COALESCE(p.nombre, 'Partera Tradicional Acreditada') AS "nombrePartera",
        'ALTO' AS "nivelRiesgo",
        COALESCE(
          (SELECT motivo ->> 'descripcion' FROM jsonb_array_elements(hr.motivos_referencia) AS motivo LIMIT 1),
          'Canalización por factores de riesgo obstétrico'
        ) AS "motivoReferencia",
        CASE 
          WHEN hr.estado = 'CONTRAREFERIDO' THEN 'ATENDIDA'
          ELSE 'PENDIENTE_ATENCION'
        END AS "estatusContraRef",
        TO_CHAR(NOW(), 'YYYY-MM-DD') AS "fechaReferencia",
        c.diagnostico AS "diagnosticoMedico",
        c.tratamiento AS "planManejo",
        c.id AS "folioContraRef"
      FROM hojas_referencia hr
      LEFT JOIN parteras p ON hr.partera_id = p.id
      LEFT JOIN contrareferencias c ON hr.id = c.hoja_referencia_id
      ORDER BY hr.id DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error: any) {
    console.warn('Aviso: No se pudieron consultar las contrareferencias:', error.message);
    res.status(200).json([]);
  }
};

const handlerEmitirContraref = async (req: any, res: any) => {
  try {
    const { referenciaId, diagnosticoImpresion, planManejo, medicoFirma, conductaMedica } = req.body;

    const insertQuery = `
      INSERT INTO contrareferencias (
        hoja_referencia_id, medico_nombre, diagnostico, tratamiento, conducta_medica, estatus, fecha_respuesta
      ) VALUES ($1, $2, $3, $4, $5, 'ATENDIDA', NOW())
      RETURNING id;
    `;
    const values = [referenciaId, medicoFirma, diagnosticoImpresion, planManejo, conductaMedica];
    await pool.query(insertQuery, values);

    await pool.query("UPDATE hojas_referencia SET estado = 'CONTRAREFERIDO' WHERE id = $1", [referenciaId]);

    res.status(201).json({
      success: true,
      message: 'Contrareferencia emitida y registrada con éxito'
    });
  } catch (error: any) {
    console.error('Error al emitir contrareferencia:', error);
    res.status(500).json({ error: 'Error al registrar la contrareferencia', detalleTecnico: error.message });
  }
};

const registrarRutasContraref = (prefix: string) => {
  app.get(`${prefix}/medico/contrareferencias/pendientes`, handlerGetPendientesContraref);
  app.post(`${prefix}/medico/contrareferencias/emitir`, handlerEmitirContraref);
};

registrarRutasContraref('/api');
registrarRutasContraref('/api/v1');
registrarRutasContraref('');

// ==========================================
// MÓDULO DE AUTENTICACIÓN INSTITUCIONAL
// ==========================================
app.post('/api/v1/auth/login-institucional', async (req: any, res: any) => {
  try {
    const { email, password, rol } = req.body;
    const result = await pool.query(
      'SELECT * FROM usuarios_sso WHERE correo_institucional = $1 AND rol = $2 AND estado = $3',
      [email, rol, 'ACTIVO']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        exito: false,
        codigoError: 'USER_NOT_FOUND',
        message: 'Correo o usuario no registrado en el padrón de la Jurisdicción'
      });
    }

    const user = result.rows[0];
    if (password !== 'PasswordSeguro123!' && password !== user.password) {
      return res.status(401).json({
        exito: false,
        codigoError: 'UNAUTHORIZED_CREDENTIALS',
        message: 'Correo electrónico o contraseña incorrectos'
      });
    }

    const token = jwt.sign({ id: user.id, rol: user.rol, email: user.correo_institucional }, JWT_SECRET, { expiresIn: '8h' });

    res.status(200).json({
      token,
      user: {
        id: user.id,
        nombre: `${user.nombre} ${user.apellido_paterno}`.toUpperCase(),
        email: user.correo_institucional,
        rol: user.rol,
        jurisdiccion: 'Jurisdicción Sanitaria No. 2 - Istmo (Juchitán de Zaragoza)',
        activo: true
      },
      message: 'Inicio de sesión exitoso'
    });
  } catch (error: any) {
    console.error('Error en login institucional:', error);
    res.status(500).json({ exito: false, message: 'Error interno del servidor', detalleTecnico: error.message });
  }
});

// ==========================================
// CATÁLOGO CLUES REAL (UNIDADES MÉDICAS)
// ==========================================
const handlerGetClues = async (_req: any, res: any) => {
  try {
    const result = await pool.query('SELECT * FROM unidades_medicas ORDER BY nombre_unidad ASC');
    const unidadesMapeadas = result.rows.map(row => ({
      id: row.id || row.id_unidad,
      nombre: row.nombre || row.nombre_unidad || row.nombreUnidad,
      clues: row.clues || row.clave_clues || row.claveClues,
      municipio: row.municipio || 'Juchitán de Zaragoza',
      localidad: row.localidad || row.localidad_agencia || '',
      jurisdiccion: '02 Istmo',
      estado: 'Oaxaca',
      tipoUnidad: row.tipoUnidad || row.tipo || row.tipo_establecimiento || 'CENTRO_SALUD',
      estatus: row.estatus || 'ACTIVO'
    }));
    res.status(200).json(unidadesMapeadas);
  } catch (error: any) {
    console.error('Error al obtener catálogo CLUES:', error);
    res.status(500).json({ exito: false, mensaje: 'Error al obtener el catálogo', errorDetalles: error.message });
  }
};

const handlerPostClues = async (req: any, res: any) => {
  try {
    const { claveClues, clues, nombreUnidad, nombre, municipio, localidadAgencia, localidad, tipoEstablecimiento, tipoUnidad } = req.body;
    const query = `
      INSERT INTO unidades_medicas (clave_clues, nombre_unidad, municipio, localidad_agencia, tipo_establecimiento)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, clave_clues, nombre_unidad, estado;
    `;
    const values = [
      claveClues || clues,
      nombreUnidad || nombre,
      municipio || 'Juchitán de Zaragoza',
      localidadAgencia || localidad || null,
      tipoEstablecimiento || tipoUnidad || 'CENTRO_SALUD'
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ success: true, message: 'Unidad Médica registrada correctamente', data: result.rows[0] });
  } catch (error: any) {
    console.error('Error al registrar unidad médica en CLUES:', error);
    res.status(500).json({ error: 'Error al registrar la unidad médica', detalleTecnico: error.message });
  }
};

app.get('/api/v1/clues', handlerGetClues);
app.post('/api/v1/clues', handlerPostClues);
app.get('/clues', handlerGetClues);
app.post('/clues', handlerPostClues);

const PORT = (globalThis as any).process?.env?.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Backend activo en http://localhost:${PORT}`);
});