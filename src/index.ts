import express from 'express';
import cors from 'cors';
import { pool } from './db';

const app = express();

app.use(cors());
app.use(express.json());

// 1. Autenticación de Partera por PIN
app.post('/api/v1/parteras/login-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    const result = await pool.query('SELECT id, nombre FROM parteras WHERE pin = $1', [pin]);
    
    if (result.rows.length > 0) {
      res.status(200).json({ perfil: result.rows[0], token: 'token-simulado-123' });
    } else {
      res.status(401).json({ error: 'PIN incorrecto' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error en el servidor al autenticar' });
  }
});

// 2. Registrar Hoja de Referencia (Envío del Formulario)
app.post('/api/v1/referencias', async (req, res) => {
  try {
    const { parteraId, centroSalud, usuaria, motivosReferencia } = req.body;
    
    const query = `
      INSERT INTO hojas_referencia 
      (partera_id, centro_salud, nombre_usuaria, edad, sexo, localidad_usuaria, municipio_usuaria, motivos_referencia) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `;
    
    const values = [
      parteraId, 
      centroSalud, 
      usuaria.nombre, 
      usuaria.edad, 
      usuaria.sexo, 
      usuaria.localidad, 
      usuaria.municipio, 
      JSON.stringify(motivosReferencia)
    ];
    
    const result = await pool.query(query, values);
    res.status(201).json({ mensaje: 'Hoja de referencia guardada con éxito', referencia: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al guardar la hoja de referencia' });
  }
});

// 3. Obtener Historial de Referencias (Para desplegar en el Dashboard)
app.get('/api/v1/referencias', async (_req, res) => {
  try {
    const query = `
      SELECT hr.*, c.medico_nombre, c.diagnostico, c.tratamiento, c.observaciones_partera 
      FROM hojas_referencia hr
      LEFT JOIN contrareferencias c ON hr.id = c.hoja_referencia_id
      ORDER BY hr.fecha_creacion DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al consultar las referencias' });
  }
});

// 4. Responder Contrareferencia Médica
app.post('/api/v1/referencias/:id/contrareferencia', async (req, res) => {
  try {
    const { id } = req.params;
    const { medicoNombre, diagnostico, tratamiento, observacionesPartera } = req.body;
    
    await pool.query(
      'INSERT INTO contrareferencias (hoja_referencia_id, medico_nombre, diagnostico, tratamiento, observaciones_partera) VALUES ($1, $2, $3, $4, $5)',
      [id, medicoNombre, diagnostico, tratamiento, observacionesPartera]
    );

    await pool.query("UPDATE hojas_referencia SET estado = 'CONTRAREFERIDO' WHERE id = $1", [id]);

    res.status(201).json({ mensaje: 'Contrareferencia guardada y estado actualizado' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al procesar la contrareferencia' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Backend de Parteras activo en http://localhost:${PORT}`);
});

// 5. Registrar Calendario de Atención al Niño(a) (Formato Oficial No. 3 - SSO)
app.post('/api/v1/calendario-nino', async (req, res) => {
  try {
    const {
      parteraId,
      datosNino,
      estadoNutricional,
      tipoLactancia,
      canalizaciones,
      cierreAdministrativo
    } = req.body;

    const query = `
      INSERT INTO calendario_nino (
        partera_id, nombre_nino, edad_meses, nombre_madre, localidad, municipio,
        fecha_atencion, estado_nutricional, tipo_lactancia, canalizaciones,
        mes_informado, nombre_supervisor, centro_salud_adscripcion, huella_firmada, es_copia_centro_salud
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    // Maneja id de prueba (1) si el frontend envía un identificador simulado
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
  } catch (error) {
    console.error('Error al insertar el calendario del niño:', error);
    res.status(500).json({ error: 'Error interno al guardar el registro del niño' });
  }
});

// 5. Registrar Calendario de Atención a la Mujer
app.post('/api/v1/calendario-mujer', async (req, res) => {
  try {
    const {
      parteraId,
      datosUsuaria,
      controlPrenatal,
      embarazoComplicaciones,
      complicacionesHemorragicas,
      partoNormal,
      partoComplicado,
      puerperio,
      alertaMuerteMaterna,
      cierreAdministrativo
    } = req.body;

    const query = `
      INSERT INTO calendario_mujer (
        partera_id,
        nombre_mujer, edad, fecha_consulta, localidad, municipio,
        mes_embarazo_activo, acido_folico_entregado, sulfato_ferroso_entregado, vacuna_tetanos, muac_embarazo,
        embarazo_referido, sintomas_embarazo,
        aborto_dolor_hemorragia_referido, complicaciones_hemorragicas,
        tipo_parto_normal, resultado_parto_normal,
        parto_complicado_referido, resultado_parto_complicado,
        muac_puerperio, puerperio_complicado_referido, sintomas_puerperio,
        muerte_materna_registrada, etapa_muerte_materna,
        mes_informado, nombre_supervisor, centro_salud_adscripcion, huella_firmada
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      RETURNING id, partera_id, creado_en;
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
        parteraId: nuevoRegistro.partera_id,
        creadoEn: nuevoRegistro.creado_en
      }
    });
  } catch (error) {
    console.error('Error al registrar calendario:', error);
    res.status(500).json({ error: 'Error interno al guardar en la base de datos' });
  }
});

// ==========================================
// MÓDULO ADMINISTRATIVO (Jurisdicción Sanitaria No. 2)
// ==========================================

// A. Catálogo de Unidades Médicas CLUES
app.get('/api/v1/admin/unidades-medicas', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM unidades_medicas ORDER BY nombre_unidad ASC');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error al obtener unidades médicas:', error);
    res.status(500).json({ error: 'Error al consultar unidades médicas' });
  }
});

app.post('/api/v1/admin/unidades-medicas', async (req, res) => {
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
  } catch (error) {
    console.error('Error al registrar unidad médica:', error);
    res.status(500).json({ error: 'Error al registrar la unidad médica' });
  }
});

// B. Gestión de Usuarios Institucionales SSO
app.get('/api/v1/admin/usuarios-sso', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM usuarios_sso ORDER BY creado_en DESC');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error al listar usuarios SSO:', error);
    res.status(500).json({ error: 'Error al consultar usuarios institucionales' });
  }
});

app.post('/api/v1/admin/usuarios-sso', async (req, res) => {
  try {
    const { nombre, apellidoPaterno, apellidoMaterno, curp, correoInstitucional, telefono, rol, unidadMedicaId, municipio } = req.body;
    const query = `
      INSERT INTO usuarios_sso (nombre, apellido_paterno, apellido_materno, curp, correo_institucional, telefono, rol, unidad_medica_id, municipio)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, correo_institucional, rol, estado;
    `;
    const values = [nombre, apellidoPaterno, apellidoMaterno, curp, correoInstitucional, telefono || null, rol, unidadMedicaId || null, municipio];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Cuenta de servidor público creada exitosamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al registrar usuario SSO:', error);
    res.status(500).json({ error: 'Error al crear la cuenta institucional' });
  }
});

// C. Acreditación de Parteras Tradicionales
app.get('/api/v1/admin/parteras', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM parteras ORDER BY nombre ASC');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error al listar parteras:', error);
    res.status(500).json({ error: 'Error al consultar padrón de parteras' });
  }
});

app.post('/api/v1/admin/parteras', async (req, res) => {
  try {
    const { nombre, apellidoPaterno, apellidoMaterno, curp, lenguaMaterna, telefonoRecaudo, municipio, comunidadBarrio, unidadMedicaAdscritaId, pinAcceso } = req.body;
    const query = `
      INSERT INTO parteras (nombre, apellido_paterno, apellido_materno, curp, lengua_materna, telefono_recaudo, municipio, comunidad_barrio, unidad_medica_adscrita_id, pin_acceso, estado_acreditacion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACREDITADA')
      RETURNING id, nombre, apellido_paterno, estado_acreditacion;
    `;
    const values = [nombre, apellidoPaterno, apellidoMaterno, curp, lenguaMaterna, telefonoRecaudo, municipio, comunidadBarrio, unidadMedicaAdscritaId || null, pinAcceso || '0000'];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Partera tradicional acreditada exitosamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al registrar partera:', error);
    res.status(500).json({ error: 'Error al acreditar partera tradicional' });
  }
});

// D. Responder Contrareferencia Médica
app.put('/api/v1/admin/referencias/:id/contrareferencia', async (req, res) => {
  try {
    const { id } = req.params;
    const { medicoAtendio, unidadAtencionId, diagnosticoOficial, conductaMedica, estatus } = req.body;

    // Nota: Asegúrate de tener las columnas correspondientes en la tabla contrareferencias o en hojas_referencia
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
  } catch (error) {
    console.error('Error al responder contrareferencia:', error);
    res.status(500).json({ error: 'Error al procesar la contrareferencia médica' });
  }
});
