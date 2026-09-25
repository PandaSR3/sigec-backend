const { Router } = require('express');
const controller = require('./reembolsos.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);
router.use(authorize('REEMBOLSO_REGISTRAR'));

router.get('/:id', controller.obtener);
router.post('/:id/aprobar', controller.aprobar);
router.post('/:id/rechazar', controller.rechazar); // { motivo }
router.post('/:id/pagar', controller.pagar);

module.exports = router;
