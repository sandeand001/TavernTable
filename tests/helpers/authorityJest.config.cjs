const path = require('node:path');
const rootDir = path.resolve(__dirname, '..', '..');
const config = require(path.join(rootDir, 'jest.config.js'));
const authorityRoot = process.env.TAVERNTABLE_AUTHORITY_TREE || rootDir;

module.exports = {
  ...config,
  rootDir,
  moduleNameMapper: {
    ...config.moduleNameMapper,
    '^.*[\\\\/]PlayerPublicProtocol\\.js$': path.join(
      authorityRoot,
      'src',
      'campaigns',
      'PlayerPublicProtocol.js'
    ),
    '^.*[\\\\/]PlayerCommandProtocol\\.js$': path.join(
      authorityRoot,
      'src',
      'campaigns',
      'PlayerCommandProtocol.js'
    ),
  },
};
