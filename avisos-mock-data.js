// =====================================================
//  AVISOS · Datos mock (Fase 1 — sin backend)
//  Respeta el contrato de datos definitivo:
//  tipo: 'informacion' | 'evento' | 'local_cerrado'
//  destinatarios.modo: 'todos' | 'sucursal' | 'empleado' | 'administracion'
//  estado se DERIVA en avisos.js (no se guarda acá), salvo 'archivado'
// =====================================================

(function () {
  'use strict';

  function hoyMas(dias) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  const MOCK = [
    // 1. Local cerrado para una sucursal (activo, hoy)
    {
      id: 'AVI-001',
      tipo: 'local_cerrado',
      titulo: 'LOCAL CERRADO',
      mensaje: 'El local permanecerá cerrado por refacciones.',
      fechaDesde: hoyMas(0),
      fechaHasta: hoyMas(2),
      destinatarios: { modo: 'sucursal', ids: ['09'] },
      canales: { calendario: true, banner: true, email: true, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-1),
    },
    // 2. Evento para todos
    {
      id: 'AVI-002',
      tipo: 'evento',
      titulo: 'Reunión de equipo',
      mensaje: 'Reunión general de cierre de temporada.',
      fechaDesde: hoyMas(6),
      fechaHasta: hoyMas(6),
      destinatarios: { modo: 'todos' },
      canales: { calendario: true, banner: true, email: false, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-2),
    },
    // 3. Evento para una sola sucursal
    {
      id: 'AVI-003',
      tipo: 'evento',
      titulo: 'Capacitación de producto',
      mensaje: 'Capacitación sobre la nueva línea de tablas.',
      fechaDesde: hoyMas(3),
      fechaHasta: hoyMas(3),
      destinatarios: { modo: 'sucursal', ids: ['01'] },
      canales: { calendario: true, banner: true, email: false, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-1),
    },
    // 4. Aviso para varias sucursales (Paseo + Wave)
    {
      id: 'AVI-004',
      tipo: 'informacion',
      titulo: 'Nuevo uniforme',
      mensaje: 'A partir de la semana que viene se entrega el uniforme nuevo.',
      fechaDesde: hoyMas(-4),
      fechaHasta: hoyMas(20),
      destinatarios: { modo: 'sucursal', ids: ['01', '05'] },
      canales: { calendario: false, banner: true, email: false, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-4),
    },
    // 5. Comunicado para Administración
    {
      id: 'AVI-005',
      tipo: 'informacion',
      titulo: 'Cierre de balance mensual',
      mensaje: 'Recordatorio: entregar planillas antes del día 10.',
      fechaDesde: hoyMas(-1),
      fechaHasta: hoyMas(4),
      destinatarios: { modo: 'administracion' },
      canales: { calendario: false, banner: true, email: true, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-1),
    },
    // 6. Aviso para un empleado específico
    {
      id: 'AVI-006',
      tipo: 'informacion',
      titulo: 'Certificado pendiente',
      mensaje: 'Falta que subas el certificado médico de la semana pasada.',
      fechaDesde: hoyMas(-2),
      fechaHasta: hoyMas(5),
      destinatarios: { modo: 'empleado', nombres: ['Juan Pérez'], sucursalId: '09' },
      canales: { calendario: false, banner: true, email: false, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-2),
    },
    // 7. Aviso urgente
    {
      id: 'AVI-007',
      tipo: 'informacion',
      titulo: 'Mañana no hay reparto',
      mensaje: 'El camión de distribución no sale mañana por desperfecto.',
      fechaDesde: hoyMas(0),
      fechaHasta: hoyMas(1),
      destinatarios: { modo: 'todos' },
      canales: { calendario: false, banner: true, email: false, whatsapp: false },
      prioridad: 'urgente',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(0),
    },
    // 8. Aviso programado (fecha futura)
    {
      id: 'AVI-008',
      tipo: 'local_cerrado',
      titulo: 'LOCAL CERRADO',
      mensaje: 'Cierre por feriado.',
      fechaDesde: hoyMas(12),
      fechaHasta: hoyMas(13),
      destinatarios: { modo: 'sucursal', ids: ['01'] },
      canales: { calendario: true, banner: true, email: true, whatsapp: false },
      prioridad: 'normal',
      archivado: false,
      autor: 'Admin',
      fechaCreacion: hoyMas(-1),
    },
    // 9. Aviso archivado
    {
      id: 'AVI-009',
      tipo: 'evento',
      titulo: 'Capacitación stock',
      mensaje: 'Capacitación de carga de stock — ya realizada.',
      fechaDesde: hoyMas(-40),
      fechaHasta: hoyMas(-40),
      destinatarios: { modo: 'sucursal', ids: ['05', '09'] },
      canales: { calendario: true, banner: false, email: false, whatsapp: false },
      prioridad: 'normal',
      archivado: true,
      autor: 'Admin',
      fechaCreacion: hoyMas(-42),
    },
  ];

  // Lista mínima de empleados para el selector de destinatarios
  // "Empleado(s)" del formulario (Fase 2) — no existía ninguna fuente
  // de empleados en el contrato de Fase 1, hacía falta para poder
  // probar ese modo de destinatario con datos mock coherentes.
  const EMPLEADOS = [
    { nombre: 'Juan Pérez',    sucursalId: '09' },
    { nombre: 'Lucía Gómez',   sucursalId: '01' },
    { nombre: 'Martín Silva',  sucursalId: '05' },
    { nombre: 'Ana Torres',    sucursalId: '12' },
  ];

  window.CROMA_AVISOS_MOCK = MOCK;
  window.CROMA_EMPLEADOS_MOCK = EMPLEADOS;
})();
