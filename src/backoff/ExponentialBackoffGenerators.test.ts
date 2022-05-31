import { expect } from 'chai';
import { IExponentialBackoffOptions } from './ExponentialBackoff';
import {
  decorrelatedJitterGenerator,
  fullJitterGenerator,
  halfJitterGenerator,
  noJitterGenerator,
} from './ExponentialBackoffGenerators';

describe('ExponentialBackoff Generators', () => {
  const generators = [
    { name: 'noJitterGenerator', generator: noJitterGenerator },
    { name: 'fullJitterGenerator', generator: fullJitterGenerator },
    { name: 'halfJitterGenerator', generator: halfJitterGenerator },
    { name: 'decorrelatedJitterGenerator', generator: decorrelatedJitterGenerator },
  ];

  for (const { name, generator } of generators) {
    it(`${name} is sane`, () => {
      const options: IExponentialBackoffOptions<any> = {
        generator,
        maxDelay: 30000,
        exponent: 2,
        initialDelay: 128,
      };

      for (let i = 0; i < 10; i++) {
        let state: any;
        for (let k = 1; k < 100; k++) {
          const [delay, nextState] = generator(state, options);
          expect(delay).to.be.gte(0);
          expect(delay).to.be.lte(Math.min(30000, options.initialDelay * 2 ** k));
          state = nextState;
        }
      }
    });
  }
});
