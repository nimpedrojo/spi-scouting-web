function renderPrivacy(_req, res) {
  return res.render('legal/privacy', {
    pageTitle: 'Política de privacidad',
  });
}

function renderLegalNotice(_req, res) {
  return res.render('legal/legal', {
    pageTitle: 'Aviso legal',
  });
}

module.exports = {
  renderPrivacy,
  renderLegalNotice,
};
