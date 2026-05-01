/**
 * Puppeteer config — cache Chrome inside the project so it gets bundled
 * into the packaged Electron app and end users don't need anything installed.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: '../../puppeteer-cache',
};
