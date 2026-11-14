const MAX_EVENT_BYTES = 32 * 1024 * 1024;
const STALLED_MS = 60000;
const failure = (code, message, status = 503) =>
  Object.assign(new Error(message), { code, status });
const invalid = () => failure('invalid-cloud-stream', 'The live stream returned an invalid event.');
const changed = () =>
  failure('account-changed', 'The signed-in account changed. Reopen its live campaigns.', 409);

export default class CloudEventStream {
  constructor({ response, controller, account, credential, signal = null }) {
    this.reader = response.body.getReader();
    this.controller = controller;
    this.signal = signal;
    this.cancel = () => this._abort(failure('stream-closed', 'The live stream was closed.', 409));
    this.isCurrent = credential.isCurrent;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    this.encoder = new TextEncoder();
    this.buffer = '';
    this.bufferBytes = 0;
    this.frameBytes = 0;
    this.data = [];
    this.type = 'message';
    this.id = null;
    this.ended = false;
    this.eof = false;
    this.readFailed = false;
    this.reading = false;
    this.error = null;
    this.stopIdentity = () => {};
    this._progress();
    signal?.addEventListener('abort', this.cancel, { once: true });
    if (signal?.aborted) {
      this.cancel();
      throw this.error;
    }
    try {
      this.stopIdentity = account.subscribe(
        (identity) => {
          if (identity?.uid !== credential.uid || identity.emailVerified !== true)
            this._abort(changed());
        },
        () =>
          this._abort(
            failure('identity-unavailable', 'Live account identity could not be verified.')
          )
      );
    } catch (error) {
      console.error('[cloud-event-stream]', {
        code: 'identity-observation-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
      this._abort(failure('identity-unavailable', 'Live account identity could not be verified.'));
      throw this.error;
    }
    if (this.ended) this.stopIdentity();
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  _progress() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(
      () =>
        this._abort(
          failure(
            'cloud-stream-timeout',
            'The live stream stopped responding. Reconnect online.',
            504
          )
        ),
      STALLED_MS
    );
  }

  _abort(error) {
    this.error ??= error;
    void this.close().catch((closing) => {
      console.error('[cloud-event-stream]', {
        code: 'stream-close-failed',
        kind: closing instanceof Error ? 'error' : 'non-error',
      });
    });
  }

  _line() {
    const found = /[\r\n]/.exec(this.buffer);
    if (!found) return null;
    const index = found.index;
    if (this.buffer[index] === '\r' && index + 1 === this.buffer.length && !this.eof) return null;
    const length = index + (this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1);
    const consumed = this.buffer.slice(0, length);
    const bytes = this.encoder.encode(consumed).byteLength;
    this.bufferBytes -= bytes;
    this.frameBytes += bytes;
    if (this.frameBytes > MAX_EVENT_BYTES) throw invalid();
    const line = this.buffer.slice(0, index);
    this.buffer = this.buffer.slice(length);
    return line;
  }

  _field(line) {
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'event') this.type = value;
    if (name === 'data') this.data.push(value);
    if (name === 'id') {
      if (!/^(?:0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw invalid();
      this.id = value;
    }
  }

  _event() {
    this.frameBytes = 0;
    const text = this.data.join('\n');
    this.data = [];
    const type = this.type;
    this.type = 'message';
    if (!text) return null;
    let event;
    try {
      event = JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) throw invalid();
      throw error;
    }
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      !['checkpoint', 'delta', 'resync', 'closed', 'status', 'owner-head'].includes(type) ||
      event.kind !== type
    )
      throw invalid();
    const generation =
      event.checkpoint?.generation ?? event.delta?.generation ?? event.head?.generation;
    if (
      generation !== undefined &&
      (!Number.isSafeInteger(generation) ||
        generation < 0 ||
        this.id === null ||
        Number(this.id) !== generation)
    )
      throw invalid();
    if (
      type === 'closed' &&
      (Object.keys(event).length !== 2 ||
        typeof event.code !== 'string' ||
        !/^[a-z][a-z-]{0,99}$/.test(event.code))
    )
      throw invalid();
    return event;
  }

  async next() {
    if (this.error) throw this.error;
    if (this.ended) return { done: true, value: undefined };
    if (this.reading)
      throw failure('invalid-cloud-stream-consumer', 'Read live events sequentially.', 400);
    this.reading = true;
    try {
      for (;;) {
        if (!this.isCurrent()) throw changed();
        if (this.error) throw this.error;
        if (this.ended) return { done: true, value: undefined };
        const line = this._line();
        if (line !== null) {
          if (line !== '') {
            this._field(line);
            continue;
          }
          const event = this._event();
          if (!event) continue;
          if (event.kind === 'closed') await this.close();
          return { done: false, value: event };
        }
        if (this.bufferBytes + this.frameBytes > MAX_EVENT_BYTES) throw invalid();
        if (this.eof) {
          if (this.buffer.length || this.data.length) throw invalid();
          await this.close();
          return { done: true, value: undefined };
        }
        let chunk;
        try {
          chunk = await this.reader.read();
        } catch (error) {
          this.readFailed = true;
          if (this.error) throw this.error;
          if (this.ended) return { done: true, value: undefined };
          console.error('[cloud-event-stream]', {
            code: 'stream-read-failed',
            kind: error instanceof Error ? 'error' : 'non-error',
          });
          throw failure('cloud-stream-unavailable', 'The live stream disconnected. Retry online.');
        }
        const { value, done } = chunk;
        if (!this.isCurrent()) throw changed();
        if (this.error) throw this.error;
        if (this.ended) return { done: true, value: undefined };
        if (done) {
          this.eof = true;
          this.buffer += this.decoder.decode();
        } else {
          if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw invalid();
          this.bufferBytes += value.byteLength;
          this.buffer += this.decoder.decode(value, { stream: true });
          this._progress();
        }
      }
    } catch (error) {
      this.error ??=
        error?.code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ||
        (error instanceof TypeError && error.message.includes('encoded data'))
          ? invalid()
          : error;
      await this.close();
      throw this.error;
    } finally {
      this.reading = false;
    }
  }

  async close() {
    if (this.closing) return this.closing;
    this.ended = true;
    this.buffer = '';
    this.bufferBytes = 0;
    this.frameBytes = 0;
    this.data = [];
    clearTimeout(this.timeout);
    this.signal?.removeEventListener('abort', this.cancel);
    this.stopIdentity();
    this.closing = (async () => {
      const cancellation = this.readFailed ? Promise.resolve() : this.reader.cancel();
      this.controller.abort();
      try {
        await cancellation;
      } catch (error) {
        console.error('[cloud-event-stream]', {
          code: 'stream-close-failed',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
        throw failure('cloud-stream-close-failed', 'The live stream could not close cleanly.');
      } finally {
        this.reader.releaseLock();
      }
    })();
    return this.closing;
  }

  async return() {
    await this.close();
    return { done: true, value: undefined };
  }
}
