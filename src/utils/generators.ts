const NO_VALUE = Symbol('NO_VALUE')

export async function lastX<A>(as: AsyncGenerator<A>): Promise<A> {
  let lastValue: A | typeof NO_VALUE = NO_VALUE
  for await (const a of as) {
    lastValue = a
  }
  if (lastValue === NO_VALUE) {
    throw new Error('No items in generator')
  }
  return lastValue
}

export async function returnValue<A>(
  as: AsyncGenerator<unknown, A>,
): Promise<A> {
  let e
  do {
    e = await as.next()
  } while (!e.done)
  return e.value
}

type QueuedGenerator<A> = (
  | {
      done: false
      value: Awaited<A>
    }
  | {
      done: true
      value: void
    }
) & {
  generator: AsyncGenerator<A, void>
  promise: Promise<QueuedGenerator<A>>
}

// Run all generators concurrently up to a concurrency cap, yielding values as they come in
export async function* all<A>(
  generators: AsyncGenerator<A, void>[],
  concurrencyCap = Infinity,
): AsyncGenerator<A, void> {
  const next = (generator: AsyncGenerator<A, void>) => {
    const promise: Promise<QueuedGenerator<A>> = generator
      .next()
      .then(result =>
        result.done === true
          ? {
              done: true,
              value: undefined,
              generator,
              promise,
            }
          : {
              done: false,
              value: result.value as Awaited<A>,
              generator,
              promise,
            },
      )
    return promise
  }
  const waiting = [...generators]
  const promises = new Set<Promise<QueuedGenerator<A>>>()

  // Start initial batch up to concurrency cap
  while (promises.size < concurrencyCap && waiting.length > 0) {
    const gen = waiting.shift()!
    promises.add(next(gen))
  }

  while (promises.size > 0) {
    const queued = await Promise.race(promises)
    promises.delete(queued.promise)

    if (!queued.done) {
      promises.add(next(queued.generator))
      // TODO: Clean this up
      if (queued.value !== undefined) {
        yield queued.value as Awaited<A>
      }
    } else if (waiting.length > 0) {
      // Start a new generator when one finishes
      const nextGen = waiting.shift()!
      promises.add(next(nextGen))
    }
  }
}

export async function toArray<A>(
  generator: AsyncGenerator<A, void>,
): Promise<A[]> {
  const result: A[] = []
  for await (const a of generator) {
    result.push(a)
  }
  return result
}

export async function* fromArray<T>(values: T[]): AsyncGenerator<T, void> {
  for (const value of values) {
    yield value
  }
}
