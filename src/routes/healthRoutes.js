const express = require('express');

const router = express.Router();

// Process liveness only: no session, authentication or database work.
router.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok' });
});

module.exports = router;
