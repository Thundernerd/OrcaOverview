// Pure: parses the TSV the launch-tickets skill's survey.sh prints.
//   source: <issues|files> (<main>)
//   <status>\t<id>\t<title>\t<blockers>\t<ref>
import type { TicketCounts } from './protocol.ts'

export function parseSurvey(stdout: string, now: number): TicketCounts {
  const counts: TicketCounts = {
    ready: 0,
    blocked: 0,
    launched: 0,
    owned: 0,
    claimed: 0,
    readyTitles: [],
    fetchedAt: now,
    error: null
  }
  for (const line of stdout.split('\n')) {
    const [status, id, title] = line.split('\t')
    if (status === 'ready' || status === 'blocked' || status === 'launched' || status === 'owned' || status === 'claimed') {
      counts[status] += 1
      if (status === 'ready' && id) counts.readyTitles.push(`${id} ${title ?? ''}`.trim())
    }
  }
  return counts
}

export function failedSurvey(error: string, now: number, previous: TicketCounts | null): TicketCounts {
  return previous
    ? { ...previous, error, fetchedAt: now }
    : { ready: 0, blocked: 0, launched: 0, owned: 0, claimed: 0, readyTitles: [], fetchedAt: now, error }
}
