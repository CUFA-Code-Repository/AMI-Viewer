// Minimal uPlot stand-in for headless data-prep tests. Only the static helpers
// buildUplotData touches at module/build time are provided.
const stub = function () {};
stub.paths = {
  stepped: () => () => {},
};
export default stub;
