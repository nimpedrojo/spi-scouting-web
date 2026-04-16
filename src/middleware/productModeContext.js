const { resolveEffectiveProductMode } = require('../shared/services/productModeService');

async function attachProductModeContext(req, res, next) {
  if (!req.context) {
    req.context = {};
  }

  try {
    const productMode = await resolveEffectiveProductMode(req.context.club || null);
    req.context.productMode = productMode;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error attaching product mode context', error);
    req.context.productMode = null;
  }

  return next();
}

module.exports = {
  attachProductModeContext,
};
