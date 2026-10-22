/**
 * Run async jobs one at a time, in the order they were queued. A job that throws
 * rejects its own promise; the jobs queued after it still run.
 */
export const createSerialQueue = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return run;
  };
};
