const service = require('./remesas.service');
const asyncHandler = require('../../utils/asyncHandler');

const generar = asyncHandler(async (req, res) => {
  const { periodo } = req.body;
  if (!periodo) return res.status(400).json({ error: 'periodo es requerido (formato YYYY-MM)' });
  const resultado = await service.generar(req.user.idEmpresa, periodo, req.user.idUsuario);
  res.status(201).json(resultado);
});

const refrescar = asyncHandler(async (req, res) => {
  const resultado = await service.refrescar(req.params.id, req.user.idUsuario);
  res.json(resultado);
});

const enviar = asyncHandler(async (req, res) => {
  const remesa = await service.enviar(req.params.id, req.user.idUsuario);
  res.json(remesa);
});

const observar = asyncHandler(async (req, res) => {
  const remesa = await service.observar(req.params.id, req.user.idUsuario, req.body.motivo);
  res.json(remesa);
});

const rechazar = asyncHandler(async (req, res) => {
  const remesa = await service.rechazar(req.params.id, req.user.idUsuario, req.body.motivo);
  res.json(remesa);
});

const procesar = asyncHandler(async (req, res) => {
  const resultado = await service.procesar(req.params.id, req.user.idUsuario);
  res.json(resultado);
});

const obtener = asyncHandler(async (req, res) => {
  const resultado = await service.obtener(req.params.id);
  if (!resultado) return res.status(404).json({ error: 'Remesa no encontrada' });
  res.json(resultado);
});

const listar = asyncHandler(async (req, res) => {
  const remesas = await service.listar(req.user.idEmpresa);
  res.json(remesas);
});

module.exports = { generar, refrescar, enviar, observar, rechazar, procesar, obtener, listar };
