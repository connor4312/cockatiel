import { bench, describe } from 'vitest';
import { EventEmitter } from './Event';

describe('EventEmitter', () => {
  const emitter0 = new EventEmitter();
  const emitter1 = new EventEmitter();
  emitter1.addListener(() => undefined);
  const emitter3 = new EventEmitter();
  emitter3.addListener(() => undefined);
  emitter3.addListener(() => undefined);
  emitter3.addListener(() => undefined);

  bench('0 listener', () => emitter0.emit(true));
  bench('1 listener', () => emitter1.emit(true));
  bench('3 listener', () => emitter3.emit(true));
});