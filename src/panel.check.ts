// `orca plugin check` renders the panel once per scenario. The requests stand in for the worker,
// so check never shells out to the real `orca` CLI or `gh`.
import { defineCheck } from 'orca/testing'
import { busySnapshot, quietSnapshot } from '../core/fixture.ts'

const answering = (snapshot: ReturnType<typeof busySnapshot>) => ({
  'overview.snapshot': () => snapshot,
  'overview.refresh': () => snapshot
})

export default defineCheck({
  busy: { requests: answering(busySnapshot()) },
  quiet: { requests: answering(quietSnapshot()) }
})
