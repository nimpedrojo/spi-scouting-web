// Application modules register maintenance intervals on import. Release those
// handles when each suite finishes, without forcing Jest to exit.
const intervalSpy = jest.spyOn(global, 'setInterval');

afterAll(() => {
  intervalSpy.mock.results.forEach(({ value }) => clearInterval(value));
  intervalSpy.mockRestore();
});
