import { createSerialQueue } from '../serial-queue';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('createSerialQueue', () => {
  it('runs a second job only after the first one finishes', async () => {
    const queue = createSerialQueue();
    const events: string[] = [];
    const gate = deferred();

    const first = queue(async () => {
      events.push('first start');
      await gate.promise;
      events.push('first end');
    });
    const second = queue(async () => {
      events.push('second start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first start', 'first end', 'second start']);
  });

  it('keeps the queue going after a job throws', async () => {
    const queue = createSerialQueue();
    const failing = queue(async () => {
      throw new Error('boom');
    });
    const next = queue(async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('resolves with the job result', async () => {
    const queue = createSerialQueue();
    await expect(queue(async () => 42)).resolves.toBe(42);
  });
});
