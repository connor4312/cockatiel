import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiSubset from 'chai-subset';
import * as sinon from 'sinon';
import { afterEach } from 'vitest';

// Import sinon-chai dynamically since it's an ES module
const sinonChai = await import('sinon-chai').then(m => m.default);

// Configure chai
chai.use(chaiAsPromised);
chai.use(sinonChai);
chai.use(chaiSubset);

// Override global expect with chai expect
(globalThis as any).expect = chai.expect;
(globalThis as any).stub = sinon.stub;
(globalThis as any).after = afterEach; // Map after to afterEach for compatibility

// Clean up sinon stubs after each test
afterEach(() => {
  sinon.restore();
});

// Declare global types
declare global {
  const expect: typeof chai.expect;
  const stub: typeof sinon.stub;
  const after: typeof afterEach;
}