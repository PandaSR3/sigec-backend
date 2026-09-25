const service = require('./pagos.service');
const asyncHandler = require('../../utils/asyncHandler');

const registrar = asyncHandler(async (req, res) => {
  const resultado = await service.registrar(req.params.idContrato, req.body, req.user.idUsuario);
  res.status(201).json(resultado);
});

const listarPorContrato = asyncHandler(async (req, res) => {
  const pagos = await service.listarPorContrato(req.params.idContrato);
  res.json(pagos);
});

module.exports = { registrar, listarPorContrato };
