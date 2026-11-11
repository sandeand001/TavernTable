import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { readCharacterImage } from '../../../../src/ui/characters/characterImages.js';
import CharacterImagesEditor from '../../../../src/ui/characters/CharacterImagesEditor.js';
import CharacterSheetContent from '../../../../src/ui/components/CharacterSheetContent.js';
import CampaignWorkspace from '../../../../src/campaigns/CampaignWorkspace.js';
import { fetchBundledResource } from '../../../helpers/bundledResources.js';
import { testIndexedDB } from '../../../helpers/indexedDB.js';
import { CHARACTER_IMAGE_FILE_LIMIT } from '../../../../src/config/characters/CharacterImages.js';
import { ErrorHandler } from '../../../../src/utils/error/ErrorHandler.js';

globalThis.TextDecoder ??= TextDecoder;

const encoded = `data:image/jpeg;base64,${btoa('\xff\xd8\xff')}`;
let images;
let width;
let height;
let autoLoad;
let decodeError;
let context;

beforeEach(() => {
  images = [];
  width = 800;
  height = 1200;
  autoLoad = true;
  decodeError = false;
  context = { fillRect: jest.fn(), drawImage: jest.fn() };
  jest.spyOn(globalThis, 'FileReader').mockImplementation(() => ({
    result: encoded,
    readAsDataURL() {
      this.onload();
    },
  }));
  jest.spyOn(globalThis, 'Image').mockImplementation(() => {
    const image = {
      naturalWidth: width,
      naturalHeight: height,
      set src(value) {
        this.source = value;
        if (autoLoad) Promise.resolve().then(() => this[decodeError ? 'onerror' : 'onload']?.());
      },
    };
    images.push(image);
    return image;
  });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(encoded);
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('portrait preparation center-crops to at most 512 square pixels and encodes a portable JPEG', async () => {
  const file = new File(['image'], 'portrait.png', { type: 'image/png' });
  expect(await readCharacterImage(file, 'portraitImage')).toBe(encoded);
  expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 200, 800, 800, 0, 0, 512, 512);
  expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
  const canvas = HTMLCanvasElement.prototype.toDataURL.mock.contexts[0];
  expect([canvas.width, canvas.height]).toEqual([512, 512]);
});

test('artwork preserves the full body aspect ratio and limits its longest side to 1024 pixels', async () => {
  await readCharacterImage(
    new File(['image'], 'body.webp', { type: 'image/webp' }),
    'artworkImage'
  );
  expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 683, 1024);
  const canvas = HTMLCanvasElement.prototype.toDataURL.mock.contexts[0];
  expect([canvas.width, canvas.height]).toEqual([683, 1024]);
});

test('small images are not upscaled', async () => {
  width = 64;
  height = 32;
  await readCharacterImage(
    new File(['image'], 'small.jpg', { type: 'image/jpeg' }),
    'portraitImage'
  );
  expect(context.drawImage).toHaveBeenCalledWith(images[0], 16, 0, 32, 32, 0, 0, 32, 32);
});

test.each([
  new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' }),
  new File([], 'empty.png', { type: 'image/png' }),
  { type: 'image/png', size: CHARACTER_IMAGE_FILE_LIMIT + 1 },
])('unsupported, empty and oversized image uploads fail before decoding', async (file) => {
  await expect(readCharacterImage(file, 'portraitImage')).rejects.toThrow();
  expect(FileReader).not.toHaveBeenCalled();
});

test('invalid file decoding and unavailable canvas preparation report explicit errors', async () => {
  const file = new File(['broken'], 'broken.png', { type: 'image/png' });
  decodeError = true;
  await expect(readCharacterImage(file, 'portraitImage')).rejects.toThrow('could not be opened');
  decodeError = false;
  HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
  await expect(readCharacterImage(file, 'portraitImage')).rejects.toThrow('canvas is required');
});

test('unreasonably large decoded dimensions are rejected', async () => {
  width = 10000;
  height = 5000;
  await expect(
    readCharacterImage(new File(['image'], 'large.png', { type: 'image/png' }), 'artworkImage')
  ).rejects.toThrow('40 megapixels');
});

test('changing characters during image preparation cannot save the upload onto either character', async () => {
  autoLoad = false;
  const onSave = jest.fn();
  const onError = jest.fn();
  const editor = new CharacterImagesEditor({ onSave, onError });
  editor.update({ id: 'first', name: 'First' });
  const uploading = editor._changeImage(
    'portraitImage',
    new File(['image'], 'portrait.png', { type: 'image/png' })
  );
  await Promise.resolve();
  editor.update({ id: 'second', name: 'Second' });
  images[0].onload();
  await uploading;
  expect(onSave).not.toHaveBeenCalled();
  expect(onError.mock.calls[0][0].message).toContain('character changed');
  expect(editor.root.getAttribute('aria-busy')).toBe('false');
  editor.destroy();
});

test('removing a portrait is independent of artwork and disables changes until the save acknowledges', async () => {
  let acknowledge;
  const onSave = jest.fn(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  const editor = new CharacterImagesEditor({ onSave, onError: jest.fn() });
  editor.update({ id: 'hero', name: 'Hero', portraitImage: encoded, artworkImage: encoded });
  const saving = editor._changeImage('portraitImage');
  expect(onSave).toHaveBeenCalledWith('hero', 'portraitImage', null);
  expect(editor.root.querySelector('[data-character-image-upload]').disabled).toBe(true);
  expect(editor.character.artworkImage).toBe(encoded);
  acknowledge(true);
  await saving;
  expect(editor.root.querySelector('[data-character-image-upload]').disabled).toBe(false);
  editor.destroy();
});

test('a real campaign sheet saves images, updates linked tokens, displays artwork on Bio, and restores after reopening', async () => {
  const workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Character images', ruleset: '2024' });
  const services = await workspace.open(campaign.id);
  const id = await services.library.create('Portrait hero');
  const first = { id: 'first', type: 'mannequin', name: 'Portrait hero', characterSheetId: id };
  const second = { id: 'second', type: 'knight', name: 'Portrait hero', characterSheetId: id };
  const adapter = { refreshTokenAppearance: jest.fn() };
  const gameManager = {
    placedTokens: [first, second],
    characterServices: services,
    token3DAdapter: adapter,
  };
  const sheet = new CharacterSheetContent({ gameManager, services });
  document.body.append(sheet.root);
  try {
    await sheet.show(first);
    sheet.setSettingsOpen(true);
    adapter.refreshTokenAppearance.mockClear();
    const portraitSave = sheet.imageEditor._changeImage(
      'portraitImage',
      new File(['image'], 'head.png', { type: 'image/png' })
    );
    expect(services.library.get(id).portraitImage).toBeUndefined();
    await portraitSave;
    expect(services.library.get(id).portraitImage).toBe(encoded);
    expect(adapter.refreshTokenAppearance).toHaveBeenCalledWith(first);
    expect(adapter.refreshTokenAppearance).toHaveBeenCalledWith(second);
    expect(sheet.root.querySelector('.sheet-identity-portrait').getAttribute('src')).toBe(encoded);
    await sheet.imageEditor._changeImage(
      'artworkImage',
      new File(['image'], 'body.png', { type: 'image/png' })
    );
    sheet.root.querySelector('[data-sheet-section="notes"]').click();
    const artwork = sheet.root.querySelector('.sheet-character-art img');
    expect(artwork.getAttribute('src')).toBe(encoded);
    expect(artwork.closest('.sheet-section').hidden).toBe(false);
    const reopened = await workspace.open(campaign.id);
    expect(reopened.library.get(id)).toMatchObject({
      portraitImage: encoded,
      artworkImage: encoded,
    });
    const copy = await services.library.import(services.library.export(id));
    expect(services.library.get(copy)).toMatchObject({
      portraitImage: encoded,
      artworkImage: encoded,
    });
    await sheet.imageEditor._changeImage('portraitImage');
    expect(services.library.get(id)).toMatchObject({ portraitImage: null, artworkImage: encoded });
    expect(sheet.root.querySelector('.sheet-identity-portrait')).toBeNull();
  } finally {
    sheet.destroy();
    workspace.close();
  }
}, 30000);

test('failed image writes leave the old portrait and surface the storage error instead of claiming success', async () => {
  const failure = new Error('Image save storage failure');
  const onSave = jest.fn().mockRejectedValue(failure);
  const onError = jest.fn();
  const editor = new CharacterImagesEditor({ onSave, onError });
  editor.update({ id: 'hero', name: 'Hero', portraitImage: encoded });
  await editor._changeImage('portraitImage');
  expect(editor.character.portraitImage).toBe(encoded);
  expect(onError).toHaveBeenCalledWith(failure);
  editor.destroy();
});

test('preview decoding failures report errors and stale failures after removal are ignored', () => {
  const onError = jest.fn();
  const editor = new CharacterImagesEditor({ onSave: jest.fn(), onError });
  editor.update({ id: 'hero', name: 'Hero', artworkImage: encoded });
  const image = editor.root.querySelector('[data-image-kind="artworkImage"] img');
  image.dispatchEvent(new Event('error'));
  expect(onError.mock.calls[0][0].message).toContain('character artwork could not be displayed');
  editor.update({ id: 'hero', name: 'Hero', artworkImage: null });
  image.dispatchEvent(new Event('error'));
  editor.destroy();
  image.dispatchEvent(new Event('error'));
  expect(onError).toHaveBeenCalledTimes(1);
});

test('image errors in a sheet use its visible error status and standard error handler', async () => {
  const handler = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const sheet = new CharacterSheetContent({ gameManager: { placedTokens: [] } });
  await sheet.imageEditor._changeImage('portraitImage');
  expect(sheet.status.textContent).toContain('Open a saved character');
  expect(sheet.status.classList.contains('sheet-error')).toBe(true);
  expect(handler).toHaveBeenCalled();
  sheet.destroy();
});
