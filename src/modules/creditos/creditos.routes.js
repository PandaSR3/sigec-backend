const { Router } = require('express');
const controller = require('./creditos.controller');
const reembolsosController = require('../reembolsos/reembolsos.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/persona/:idPersona', authorize('CREDITO_REGISTRAR'), controller.listarPorPersona);
router.get('/:id', authorize('CREDITO_REGISTRAR'), controller.obtener);
router.post('/:id/aplicar', authorize('CREDITO_REGISTRAR'), controller.aplicar); // { idContratoDestino, monto }

// Reembolsos de un credito puntual (permiso distinto al de aplicar credito)
router.post('/:idCredito/reembolsos', authorize('REEMBOLSO_REGISTRAR'), reembolsosController.solicitar);
router.get('/:idCredito/reembolsos', authorize('REEMBOLSO_REGISTRAR'), reembolsosController.listarPorCredito);

module.exports = router;
