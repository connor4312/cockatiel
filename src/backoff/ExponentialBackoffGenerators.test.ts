import { expect } from 'chai';
import { restore, stub } from 'sinon';
import { IExponentialBackoffOptions } from './ExponentialBackoff.js';
import {
  decorrelatedJitterGenerator,
  fullJitterGenerator,
  halfJitterGenerator,
  noJitterGenerator,
} from './ExponentialBackoffGenerators.js';

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

  describe('exponent', () => {
    const makeOptions = (
      generator: IExponentialBackoffOptions<any>['generator'],
      overrides: Partial<IExponentialBackoffOptions<any>>,
    ): IExponentialBackoffOptions<any> => ({
      generator,
      maxDelay: 1_000_000,
      exponent: 2,
      initialDelay: 100,
      ...overrides,
    });

    const run = (options: IExponentialBackoffOptions<any>, steps: number) => {
      const delays: number[] = [];
      let state: any;
      for (let i = 0; i < steps; i++) {
        const [delay, next] = options.generator(state, options);
        delays.push(delay);
        state = next;
      }
      return delays;
    };

    afterEach(() => restore());

    it('noJitterGenerator uses the exponent', () => {
      expect(run(makeOptions(noJitterGenerator, { exponent: 3 }), 5)).to.deep.equal([
        100, 300, 900, 2700, 8100,
      ]);
      expect(run(makeOptions(noJitterGenerator, { exponent: 2 }), 5)).to.deep.equal([
        100, 200, 400, 800, 1600,
      ]);
    });

    it('noJitterGenerator is constant with an exponent of 1', () => {
      expect(run(makeOptions(noJitterGenerator, { exponent: 1 }), 5)).to.deep.equal([
        100, 100, 100, 100, 100,
      ]);
    });

    it('noJitterGenerator clamps to maxDelay, including on overflow', () => {
      const options = makeOptions(noJitterGenerator, { exponent: 3, maxDelay: 1000 });
      expect(run(options, 4)).to.deep.equal([100, 300, 900, 1000]);

      // 3 ** 1000 overflows to Infinity
      expect(noJitterGenerator(1000, options)[0]).to.equal(1000);
    });

    it('fullJitterGenerator uses the exponent', () => {
      stub(Math, 'random').returns(0.5);
      expect(run(makeOptions(fullJitterGenerator, { exponent: 3 }), 5)).to.deep.equal([
        50, 150, 450, 1350, 4050,
      ]);
      expect(run(makeOptions(fullJitterGenerator, { exponent: 1 }), 5)).to.deep.equal([
        50, 50, 50, 50, 50,
      ]);
    });

    it('halfJitterGenerator uses the exponent', () => {
      stub(Math, 'random').returns(0.5);
      expect(run(makeOptions(halfJitterGenerator, { exponent: 3 }), 5)).to.deep.equal([
        75, 225, 675, 2025, 6075,
      ]);
      expect(run(makeOptions(halfJitterGenerator, { exponent: 1 }), 5)).to.deep.equal([
        75, 75, 75, 75, 75,
      ]);
    });

    it('decorrelatedJitterGenerator uses the exponent', () => {
      stub(Math, 'random').returns(0.5);
      const flat = run(makeOptions(decorrelatedJitterGenerator, { exponent: 1 }), 20);
      const steep = run(makeOptions(decorrelatedJitterGenerator, { exponent: 3 }), 20);
      expect(Math.max(...flat)).to.be.lt(100);
      expect(steep[steep.length - 1]).to.be.gt(100_000);
    });
  });

  it('fixes issue #86', () => {
    const options: IExponentialBackoffOptions<any> = {
      generator: decorrelatedJitterGenerator,
      maxDelay: 15 * 60_000,
      exponent: 2,
      initialDelay: 45_000,
    };

    let state: any;
    for (let k = 1; k < 3000; k++) {
      const [delay, nextState] = decorrelatedJitterGenerator(state, options);
      expect(delay).to.not.be.NaN;
      expect(delay).to.be.gte(0);
      state = nextState;
    }
  });
});
