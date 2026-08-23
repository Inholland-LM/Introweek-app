import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export type CompetitionRoundCode = 'hag' | 'sx' | 'city_game' | 'pov_final'
export type CompetitionRoundScore = {
  class_code: string
  round_code: CompetitionRoundCode
  points: number
  confirmed: boolean
  published: boolean
  revision: number
}
export type CompetitionRoundScoreInput = {
  classCode: string
  points: number
  confirmed: boolean
  revision: number
}
export type FinaleState = {
  phase: 'preparation' | 'ready' | 'revealing' | 'final'
  revealOrder: string[]
  nextIndex: number
  lastRevealedClassCode: string | null
  lastRevealedPoints: number | null
  revealSequence: number
  revealedAt: string | null
  simulatedAt: string | null
}

const emptyFinale: FinaleState = { phase: 'preparation', revealOrder: [], nextIndex: 0, lastRevealedClassCode: null, lastRevealedPoints: null, revealSequence: 0, revealedAt: null, simulatedAt: null }
const realtimeEnabled = import.meta.env.VITE_REALTIME_ENABLED === 'true'
const finalePollIntervalMs = 10_000

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
    simulatedAt: item.simulatedAt ? String(item.simulatedAt) : null,
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
    const refresh = () => fetchFinaleState().then((next) => {
      if (!active) return
      setState((current) => {
        if (next.revealSequence !== current.revealSequence) {
          window.dispatchEvent(new CustomEvent('competition-score-changed', { detail: next }))
        }
        return next
      })
    }).catch(() => undefined)
    void refresh()
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const handleLocalUpdate = () => { void refresh() }
    window.addEventListener('focus', handleVisible)
    window.addEventListener('competition-finale-changed', handleLocalUpdate)
    document.addEventListener('visibilitychange', handleVisible)
    const timer = window.setInterval(handleVisible, finalePollIntervalMs)
    const client = supabase
    const channel = client && realtimeEnabled
      ? client.channel('competition-finale-updates').on('broadcast', { event: 'finale-changed' }, refresh).subscribe()
      : null
    return () => {
      active = false
      window.removeEventListener('focus', handleVisible)
      window.removeEventListener('competition-finale-changed', handleLocalUpdate)
      document.removeEventListener('visibilitychange', handleVisible)
      window.clearInterval(timer)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [])
  return state
}

export async function fetchRoundScores() {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('list_competition_round_scores')
  if (error) throw error
  return (data ?? []) as CompetitionRoundScore[]
}

export async function saveRoundScores(roundCode: CompetitionRoundCode, scores: CompetitionRoundScoreInput[], publish = false) {
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

export async function revealNextFinalist(classCode: string, confirmed: boolean) {
  if (!supabase) throw new Error('De beveiligde finale-verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('reveal_next_competition_finalist', {
    requested_class_code: classCode,
    requested_confirmation: confirmed,
  })
  if (error) throw error
  await broadcastFinaleChange(data)
}

export async function fetchCompetitionRehearsalStatus() {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('get_competition_rehearsal_status')
  if (error) throw error
  return Boolean(data)
}

export async function setCompetitionRehearsalMode(enabled: boolean) {
  if (!supabase) throw new Error('De beveiligde finale-verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('set_competition_rehearsal_mode', {
    requested_enabled: enabled,
    requested_confirmation: enabled ? 'START REPETITIE' : 'SLUIT REPETITIE',
  })
  if (error) throw error
  return Boolean(data)
}

export type CompetitionResetResult = {
  removedEvents: number
  removedScores: number
  clearedPovAwards: number
  scoreVersion: number
}

export async function resetCompetitionTest(confirmation: string) {
  if (!supabase) throw new Error('De beveiligde finale-verbinding is niet beschikbaar.')
  const { data, error } = await supabase.rpc('reset_competition_test', {
    requested_confirmation: confirmation,
  })
  if (error) throw error
  const result = (data ?? {}) as Partial<CompetitionResetResult>
  const mapped: CompetitionResetResult = {
    removedEvents: Number(result.removedEvents ?? 0),
    removedScores: Number(result.removedScores ?? 0),
    clearedPovAwards: Number(result.clearedPovAwards ?? 0),
    scoreVersion: Number(result.scoreVersion ?? 0),
  }
  await broadcastFinaleChange({ reset: true, ...mapped })
  return mapped
}

async function broadcastFinaleChange(payload: unknown) {
  window.dispatchEvent(new CustomEvent('competition-score-changed', { detail: payload }))
  window.dispatchEvent(new CustomEvent('competition-finale-changed', { detail: payload }))
  if (!supabase || !realtimeEnabled) return
  const scoreChannel = supabase.channel('competition-score-updates')
  const finaleChannel = supabase.channel('competition-finale-updates')
  await scoreChannel.send({ type: 'broadcast', event: 'score-changed', payload })
  await finaleChannel.send({ type: 'broadcast', event: 'finale-changed', payload })
  await Promise.all([supabase.removeChannel(scoreChannel), supabase.removeChannel(finaleChannel)])
}
