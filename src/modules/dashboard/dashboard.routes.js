const { Router } = require('express');
const controller = require('./dashboard.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.get('/asesor', authorize('DASHBOARD_ASESOR'), controller.asesor);
router.get('/cobranzas', authorize('DASHBOARD_COBRANZAS'), controller.cobranzas);
router.get('/ceo', authorize('DASHBOARD_CEO'), controller.ceo);

module.exports = router;
