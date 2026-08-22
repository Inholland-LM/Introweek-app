import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export type CompetitionRoundCode = 'hag' | 'sx' | 'city_game' | 'pov_final'
export type FinaleState = {
  phase: 'preparation' | 'ready' | 'revealing' | 'final'
  revealOrder: string[]
  nextIndex: number
  lastRevealedClassCode: string | null
  lastRevealedPoints: number | null
  revealSequence: number
  revealedAt: string | null
}

const emptyFinale: FinaleState = { phase: 'preparation', revealOrder: [], nextIndex: 0, lastRevealedClassCode: null, lastRevealedPoints: null, revealSequence: 0, revealedAt: null }

function mapFinale(value: unknown): FinaleState {
  const item = (value ?? {}) as Record<string, unknown>
  const phase = ['ready', 'revealing', 'final'].includes(String(item.phase)) ? item.phase as FinaleState['phase'] : 'preparation'
  return {
    phase,
    revealOrder: Array.isArray(item.revealOrder) ? item.revealOrder.map(String) : [],
    nextIndex: Number(item.nextIndex ?? 0),
    lastRevealedClassCode: item.lastRevealedClassCode ? String(item.lastRevealedClassCode) : null,
    lastRevealedPoints: item.lastRevealedPoints === null || item.lastRevealedPoints === undefined ? null : Number(item.lastRevealedPoints),
    revealSequence: Number(item.revealSequence ?? 0),
    revealedAt: item.revealedAt ? String(item.revealedAt) : null,
  }
}

export async function fetchFinaleState() {
  if (!supabase) return emptyFinale
  const { data, error } = await supabase.rpc('get_competition_finale_state')
  if (error) throw error
  return mapFinale(data)
}

export function useCompetitionFinale() {
  const [state, setState] = useState<FinaleState>(emptyFinale)
  useEffect(() => {
    let active = true
    const refresh = () => fetchFinaleState().then((next) => { if (active) setState(next) }).catch(() => undefined)
    void refresh()
    if (!supabase) return () => { active = false }
    const client = supabase
    const channel = client.channel('competition-finale-updates').on('broadcast', { event: 'finale-changed' }, refresh).subscribe()
    return () => { active = false; void client.removeChannel(channel) }
  }, [])
  return state
}

export async function fetchRoundScores() {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_competition_round_scores')
  if (error) throw error
  return (data ?? []) as Array<{ class_code: string; round_code: CompetitionRoundCode; points: number; published: boolean }>
}

export async function saveRoundScores(roundCode: CompetitionRoundCode, scores: Array<{ classCode: string; points: number }>, publish = false) {
  if (!supabase) throw new Error('De beveiligde scoreverbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('save_competition_round_scores', { requested_round_code: roundCode, requested_scores: scores, requested_publish: publish })
  if (error) throw error
  if (publish) await broadcastFinaleChange({ scoreVersion: Number(data ?? 0) })
}

export async function lockFinaleOrder(order: string[]) {
  if (!supabase) throw new Error('De beveiligde finale-verbinding is niet beschikbaar.')
  const { error } = await supabase.rpc('lock_competition_finale_order', { requested_order: order })
  if (error) throw error
  await broadcastFinaleChange({ locked: true })
}

export async function revealNextFinalist(classCode: string) {
  if (!supabase) throw new Error('De beveiligde finale-verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('reveal_next_competition_finalist', { requested_class_code: classCode })
  if (error) throw error
  await broadcastFinaleChange(data)
}

async function broadcastFinaleChange(payload: unknown) {
  window.dispatchEvent(new CustomEvent('competition-score-changed', { detail: payload }))
  if (!supabase) return
  const scoreChannel = supabase.channel('competition-score-updates')
  const finaleChannel = supabase.channel('competition-finale-updates')
  await scoreChannel.send({ type: 'broadcast', event: 'score-changed', payload })
  await finaleChannel.send({ type: 'broadcast', event: 'finale-changed', payload })
  await Promise.all([supabase.removeChannel(scoreChannel), supabase.removeChannel(finaleChannel)])
}
