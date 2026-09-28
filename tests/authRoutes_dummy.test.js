jest.mock("../src/models/userModel", () => ({
  createUser: jest.fn(),
  findUserByEmail: jest.fn().mockResolvedValue(null),
  findUserById: jest.fn().mockResolvedValue(null),
  updateUserAccount: jest.fn(),
  updateUserLastLogin: jest.fn(),
}));

const request = require("supertest");
const bcrypt = require("bcryptjs");

describe("POST /login with missing user triggers dummy bcrypt compare", () => {
  let compareSpy;
  let app;

  beforeAll(() => {
    compareSpy = jest.spyOn(bcrypt, "compare");
    // require app after mocking modules
    app = require("../src/app");
  });

  afterAll(() => {
    compareSpy.mockRestore();
  });

  test("returns redirect and performs dummy compare when user not found", async () => {
    const email = "nouser@example.com";
    const password = "somepassword";

    const res = await request(app).post("/login").send({ email, password });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
    expect(compareSpy).toHaveBeenCalledWith(password, expect.any(String));
  });
});
