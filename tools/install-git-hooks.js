function developmentDependenciesOmitted() {
  return (
    process.env.npm_config_omit?.split(',').includes('dev') ||
    process.env.npm_config_production === 'true' ||
    process.env.NODE_ENV === 'production'
  );
}

async function installGitHooks() {
  if (developmentDependenciesOmitted()) return;
  const { default: install } = await import('husky');
  const message = install();
  if (message) console.log(message);
}

installGitHooks().catch((error) => {
  console.error('[install-git-hooks]', error);
  process.exitCode = 1;
});
