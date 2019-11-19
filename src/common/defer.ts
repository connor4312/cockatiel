export const defer = <T>() => {
  let resolve: (value: T) => void;
  let reject: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { resolve: resolve!, reject: reject!, promise };
};
