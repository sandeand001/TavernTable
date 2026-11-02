import {
  CHARACTER_IMAGE_FIELDS,
  CHARACTER_IMAGE_FILE_LIMIT,
  CHARACTER_IMAGE_SIZES,
  CHARACTER_IMAGE_TYPES,
} from '../../config/characters/CharacterImages.js';
import { validateCharacterImage } from '../../entities/characters/characterImages.js';

export async function readCharacterImage(file, field) {
  if (!CHARACTER_IMAGE_FIELDS.includes(field))
    throw new Error('Choose a portrait or character artwork');
  if (!file || !CHARACTER_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP image');
  }
  if (!file.size || file.size > CHARACTER_IMAGE_FILE_LIMIT) {
    throw new Error('Choose an image smaller than 10 MB');
  }
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('The image file could not be read'));
      else resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error('The image file could not be read'));
    reader.onabort = () => reject(new Error('Image upload cancelled'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const loaded = new Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () =>
      reject(new Error('The image could not be opened. Choose a valid JPEG, PNG or WebP file.'));
    loaded.src = source;
  });
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height || width * height > 40000000) {
    throw new Error('Choose an image with valid dimensions and no more than 40 megapixels');
  }
  const canvas = document.createElement('canvas');
  const maximum = CHARACTER_IMAGE_SIZES[field];
  const portrait = field === 'portraitImage';
  const side = Math.min(width, height);
  const scale = Math.min(1, maximum / (portrait ? side : Math.max(width, height)));
  canvas.width = Math.max(1, Math.round((portrait ? side : width) * scale));
  canvas.height = Math.max(1, Math.round((portrait ? side : height) * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A canvas is required to prepare character images');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (portrait) {
    context.drawImage(
      image,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height
    );
  } else {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  const result = canvas.toDataURL('image/jpeg', 0.8);
  validateCharacterImage(result);
  return result;
}
