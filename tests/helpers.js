function mockWebhook(page, status = 200) {
  return page.route('**/webhook/**', route =>
    route.fulfill({ status, body: 'ok', contentType: 'text/plain' })
  );
}

module.exports = { mockWebhook };
