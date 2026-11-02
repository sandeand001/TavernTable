import { CHARACTER_IMAGE_FIELDS } from '../../config/characters/CharacterImages.js';
import { readCharacterImage } from './characterImages.js';

const LABELS = {
  portraitImage: { heading: 'Token portrait (headshot)', label: 'token portrait' },
  artworkImage: { heading: 'Character artwork (full body)', label: 'character artwork' },
};

export default class CharacterImagesEditor {
  // -- Initialization --

  constructor({ onSave, onError }) {
    this.onSave = onSave;
    this.onError = onError;
    this.character = null;
    this.busy = false;
    this.saving = false;
    this.disposed = false;
    this.root = document.createElement('section');
    this.root.className = 'sheet-image-editor';
    this.root.setAttribute('aria-label', 'Character images');
    this.root.innerHTML = `<h4>Character images</h4>
      <p class="sheet-reference">Upload JPEG, PNG or WebP files under 10 MB. Portraits are center-cropped
        to a square for circular tactical tokens. Separate artwork keeps its full proportions.
        Images are resized and saved locally with this character.</p>
      <div class="sheet-image-grid">${CHARACTER_IMAGE_FIELDS.map((field) => {
        const { heading, label } = LABELS[field];
        return `<section class="sheet-image-card" aria-label="${heading}">
          <h4>${heading}</h4>
          <div class="sheet-image-preview" data-image-kind="${field}">
            <img alt="${heading}" hidden><span class="sheet-image-placeholder"></span>
          </div>
          <div class="sheet-entry-actions">
            <button type="button" data-character-image-upload="${field}" aria-label="Upload ${label}">Upload image</button>
            <button type="button" data-character-image-remove="${field}" aria-label="Remove ${label}">Remove</button>
            <input type="file" accept="image/jpeg,image/png,image/webp" data-character-image-input="${field}"
              aria-label="${heading} image file" hidden>
          </div>
        </section>`;
      }).join('')}</div>`;
    this.root.addEventListener('click', (event) => {
      const upload = event.target.closest('[data-character-image-upload]');
      if (upload) {
        this.root
          .querySelector(`[data-character-image-input="${upload.dataset.characterImageUpload}"]`)
          .click();
      }
      const remove = event.target.closest('[data-character-image-remove]');
      if (remove) void this._changeImage(remove.dataset.characterImageRemove);
    });
    this.root.addEventListener('change', (event) => {
      const input = event.target;
      if (!input.dataset.characterImageInput || !input.files?.[0]) return;
      void this._changeImage(input.dataset.characterImageInput, input.files[0]).finally(() => {
        input.value = '';
      });
    });
    for (const field of CHARACTER_IMAGE_FIELDS) {
      const image = this.root.querySelector(`[data-image-kind="${field}"] img`);
      image.addEventListener('error', () => {
        const source = this.character?.[field];
        if (!this.disposed && source && image.getAttribute('src') === source) {
          this.onError(
            new Error(
              `The ${LABELS[field].label} could not be displayed. Remove it or upload a valid image.`
            )
          );
        }
      });
    }
    this.update(null);
  }

  // -- Character and save state --

  update(character) {
    this.character = character;
    for (const field of CHARACTER_IMAGE_FIELDS) {
      const preview = this.root.querySelector(`[data-image-kind="${field}"]`);
      const image = preview.querySelector('img');
      const placeholder = preview.querySelector('span');
      const source = character?.[field];
      image.hidden = !source;
      if (source) {
        if (image.getAttribute('src') !== source) image.src = source;
        image.alt = `${character.name} ${LABELS[field].label}`;
      } else {
        image.removeAttribute('src');
      }
      placeholder.hidden = !!source;
      placeholder.textContent =
        field === 'portraitImage' ? character?.name || 'No character' : 'No artwork';
    }
    this._syncControls();
  }

  setSaving(saving) {
    this.saving = saving;
    this._syncControls();
  }

  clear() {
    this.update(null);
  }

  destroy() {
    this.disposed = true;
    this.clear();
  }

  // -- Image changes --

  async _changeImage(field, file = null) {
    if (this.busy || this.saving) {
      this.onError(new Error('Wait for the current image or character save to finish'));
      return;
    }
    this.busy = true;
    this._syncControls();
    try {
      if (!CHARACTER_IMAGE_FIELDS.includes(field))
        throw new Error('Choose a portrait or character artwork');
      const id = this.character?.id;
      if (!id) throw new Error('Open a saved character before adding images');
      const image = file ? await readCharacterImage(file, field) : null;
      if (this.disposed) return;
      if (this.character?.id !== id) {
        throw new Error(
          'The character changed before the image was ready. Choose the image again.'
        );
      }
      await this.onSave(id, field, image);
    } catch (error) {
      if (!this.disposed) this.onError(error);
    } finally {
      this.busy = false;
      this._syncControls();
    }
  }

  _syncControls() {
    const disabled = !this.character || this.busy || this.saving || this.disposed;
    this.root.setAttribute('aria-busy', String(this.busy || this.saving));
    for (const input of this.root.querySelectorAll('input, button')) {
      input.disabled =
        disabled ||
        (input.dataset.characterImageRemove &&
          !this.character?.[input.dataset.characterImageRemove]);
    }
  }
}
