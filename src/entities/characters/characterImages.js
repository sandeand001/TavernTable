import {
  CHARACTER_IMAGE_DATA_LIMIT,
  CHARACTER_IMAGE_TYPES,
} from '../../config/characters/CharacterImages.js';

export function validateCharacterImage(value) {
  if (value === undefined || value === null) return;
  const invalid = () => {
    throw new Error('Character images must be embedded JPEG, PNG or WebP images under 1 MB');
  };
  if (typeof value !== 'string' || value.length > CHARACTER_IMAGE_DATA_LIMIT) invalid();
  const separator = value.indexOf(';base64,');
  const type = value.slice(5, separator);
  const data = value.slice(separator + 8);
  if (
    !value.startsWith('data:') ||
    !CHARACTER_IMAGE_TYPES.includes(type) ||
    !data.length ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    invalid();
  const header = atob(data.slice(0, 32));
  const signature =
    type === 'image/jpeg'
      ? header.startsWith('\xff\xd8\xff')
      : type === 'image/png'
        ? header.startsWith('\x89PNG\r\n\x1a\n')
        : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
  if (!signature) invalid();
}
