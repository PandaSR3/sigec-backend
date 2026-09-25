const service = require('./contratos.service');
const asyncHandler = require('../../utils/asyncHandler');

const crear = asyncHandler(async (req, res) => {
  const resultado = await service.crear(req.user.idEmpresa, req.body, req.user.idUsuario);
  res.status(201).json(resultado);
});

const obtener = asyncHandler(async (req, res) => {
  const resultado = await service.obtenerConCronograma(req.params.id);
  if (!resultado) return res.status(404).json({ error: 'Contrato no encontrado' });
  res.json(resultado);
});

const misContratos = asyncHandler(async (req, res) => {
  const contratos = await service.listarPorAsesor(req.user.idUsuario, req.user.idEmpresa);
  res.json(contratos);
});

const listarTodos = asyncHandler(async (req, res) => {
  const contratos = await service.listarTodos(req.user.idEmpresa);
  res.json(contratos);
});

module.exports = { crear, obtener, misContratos, listarTodos };
