import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { validateCharacterImage } from '../../../../src/entities/characters/characterImages.js';
import {
  CHARACTER_BACKUP_LIMIT,
  CHARACTER_IMAGE_DATA_LIMIT,
} from '../../../../src/config/characters/CharacterImages.js';

const png = `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n')}`;
const jpeg = `data:image/jpeg;base64,${btoa('\xff\xd8\xff')}`;
const webp = `data:image/webp;base64,${btoa('RIFF0000WEBP')}`;

beforeEach(() => localStorage.clear());

test.each([undefined, null, png, jpeg, webp])('optional raster image %s is accepted', (image) => {
  expect(() => validateCharacterImage(image)).not.toThrow();
});

test.each([
  '',
  12,
  {},
  'https://example.com/portrait.png',
  'blob:temporary-image',
  'data:image/svg+xml;base64,PHN2Zz4=',
  'data:image/png;base64,!!!!',
  'data:image/png;base64,YWJj',
  'data:image/png;base64,/9j/',
  'data:image/jpeg;base64,/9j',
])('invalid or nonportable image %s is rejected', (image) => {
  expect(() => validateCharacterImage(image)).toThrow('embedded JPEG, PNG or WebP');
});

test('the embedded image size limit includes the data URI and is enforced at its boundary', () => {
  const prefix = 'data:image/jpeg;base64,';
  const length = Math.floor((CHARACTER_IMAGE_DATA_LIMIT - prefix.length) / 4) * 4;
  const image = `${prefix}/9j/${'A'.repeat(length - 4)}`;
  expect(image.length).toBeLessThanOrEqual(CHARACTER_IMAGE_DATA_LIMIT);
  expect(() => validateCharacterImage(image)).not.toThrow();
  expect(() => validateCharacterImage(`${image}AAAA`)).toThrow('under 1 MB');
});

test('images are optional on older records and image edits preserve rules and companion data', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const id = library.create('Aster');
  const original = library.get(id);
  expect(original.portraitImage).toBeUndefined();
  library.edit(id, { portraitImage: png, artworkImage: jpeg });
  expect(library.get(id)).toEqual({ ...original, portraitImage: png, artworkImage: jpeg });
  expect(() => library.edit(id, { portraitImage: 'data:image/png;base64,YWJj' })).toThrow();
  expect(library.get(id).portraitImage).toBe(png);
  const copy = library.import(library.export(id));
  expect(library.get(copy)).toMatchObject({ portraitImage: png, artworkImage: jpeg });
  library.edit(id, { portraitImage: null });
  expect(library.get(id)).toMatchObject({ portraitImage: null, artworkImage: jpeg });
});

test('the character import guard supports image-bearing backups but still rejects oversized input', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const id = library.create('Portable');
  const image = `data:image/jpeg;base64,/9j/${'A'.repeat(600000)}`;
  library.edit(id, { portraitImage: image, artworkImage: image });
  const backup = library.export(id);
  expect(backup.length).toBeGreaterThan(1000000);
  const copy = library.import(backup);
  expect(library.get(copy)).toMatchObject({ portraitImage: image, artworkImage: image });
  expect(() => library.import(' '.repeat(CHARACTER_BACKUP_LIMIT + 1))).toThrow('4 MB');
});
