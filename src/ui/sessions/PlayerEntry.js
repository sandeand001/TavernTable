export function playerGameURL(href) {
  const source = new URL(href);
  const destination = new URL('./', source);
  destination.searchParams.set('player', '1');
  destination.hash = source.hash;
  return destination.href;
}

if (typeof window !== 'undefined' && window.location.pathname.endsWith('/player.html'))
  window.location.replace(playerGameURL(window.location.href));
