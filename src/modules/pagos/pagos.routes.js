const { Router } = require('express');
const controller = require('./pagos.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.post('/:idContrato/pagos', authorize('PAGO_REGISTRAR'), controller.registrar);
router.get('/:idContrato/pagos', authorize('PAGO_REGISTRAR'), controller.listarPorContrato);

module.exports = router;
