const rateLimiter = require("../src/middleware/simpleRateLimiter");

describe("simpleRateLimiter middleware", () => {
  test("allows requests up to the limit and blocks after", () => {
    const ip = `127.0.0.${Date.now() % 100}`;
    const req = { ip };
    const res = { flash: jest.fn(), redirect: jest.fn() };
    const next = jest.fn();

    // call MAX_ATTEMPTS times (internal MAX_ATTEMPTS is 6)
    for (let i = 0; i < 6; i++) {
      rateLimiter(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(6);

    // Next call should trigger redirect
    rateLimiter(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith("/login");
    expect(res.flash).toHaveBeenCalled();
  });
});
