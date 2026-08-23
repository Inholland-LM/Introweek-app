import { useEffect, useMemo, useState } from 'react'
import { standings as classDefaults, type Standing, type TeamScoreHistory } from './data'
import type { MasterContent } from './import/parseWorkbook'
import { supabase } from './lib/supabase'

type ScoreRow = {
  classCode: string
  totalPoints: number
  history: TeamScoreHistory[]
}

const cacheKey = 'lm-you-competition-scores-v1'
const realtimeEnabled = import.meta.env.VITE_REALTIME_ENABLED === 'true'
const scorePollIntervalMs = 30_000

function parseHistory(value: unknown): TeamScoreHistory[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const item = entry as Record<string, unknown>
    const date = new Date(String(item.awardedAt ?? ''))
    return {
      id: String(item.id ?? ''),
      title: String(item.title ?? 'Punten toegekend'),
      points: Number(item.points ?? 0),
      category: ['POV-foto', 'Experience', 'City Game', 'Bonus', 'Vlaggenparade'].includes(String(item.category))
        ? String(item.category) as TeamScoreHistory['category']
        : 'Bonus',
      awardedAt: Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('nl-NL', { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(date),
    }
  })
}

function readCache(): { version: number; rows: ScoreRow[] } | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { version?: number; rows?: ScoreRow[] } | null
    return parsed && Number.isFinite(parsed.version) && Array.isArray(parsed.rows)
      ? { version: Number(parsed.version), rows: parsed.rows }
      : null
  } catch {
    return null
  }
}

async function fetchScores(cachedVersion: number | null, force = false) {
  if (!supabase) return null
  const { data: versionData, error: versionError } = await supabase.rpc('get_competition_score_version')
  if (versionError) throw versionError
  const version = Number(versionData ?? 0)
  if (!force && cachedVersion === version) return null

  const { data, error } = await supabase.rpc('list_competition_scores')
  if (error) throw error
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    classCode: String(item.class_code),
    totalPoints: Number(item.total_points ?? 0),
    history: parseHistory(item.history),
  }))
  localStorage.setItem(cacheKey, JSON.stringify({ version, rows }))
  return { version, rows }
}

export function useCompetitionStandings(classes: MasterContent['classes'] | undefined) {
  const cached = useMemo(readCache, [])
  const [version, setVersion] = useState<number | null>(cached?.version ?? null)
  const [rows, setRows] = useState<ScoreRow[]>(cached?.rows ?? [])

  useEffect(() => {
    let active = true
    const refresh = async (force = false) => {
      try {
        const next = await fetchScores(version, force)
        if (active && next) {
          setVersion(next.version)
          setRows(next.rows)
        }
      } catch {
        // De laatst bekende stand blijft bruikbaar als de verbinding tijdelijk wegvalt.
      }
    }

    void refresh()
    const handleLocalUpdate = () => { void refresh(true) }
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('competition-score-changed', handleLocalUpdate)
    window.addEventListener('focus', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    const timer = window.setInterval(handleVisible, scorePollIntervalMs)
    const client = supabase
    const channel = client && realtimeEnabled
      ? client.channel('competition-score-updates').on('broadcast', { event: 'score-changed' }, handleLocalUpdate).subscribe()
      : null
    return () => {
      active = false
      window.removeEventListener('competition-score-changed', handleLocalUpdate)
      window.removeEventListener('focus', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
      window.clearInterval(timer)
      if (client && channel) void client.removeChannel(channel)
    }
  }, [version])

  return useMemo(() => {
    const scoreByClass = new Map(rows.map((row) => [row.classCode, row]))
    const classMeta = (classes?.filter((item) => item.active).length ? classes.filter((item) => item.active) : classDefaults)
    const unsorted: Standing[] = classMeta.map((item) => {
      const fallback = classDefaults.find((entry) => entry.classCode === item.classCode)
      const score = scoreByClass.get(item.classCode)
      return {
        rank: 0,
        classCode: item.classCode,
        country: item.country || fallback?.country || item.classCode,
        flag: item.flag || fallback?.flag || '',
        points: score?.totalPoints ?? 0,
        history: score?.history ?? [],
      }
    }).sort((a, b) => b.points - a.points || a.classCode.localeCompare(b.classCode, 'nl'))

    let previousPoints: number | null = null
    let currentRank = 0
    return unsorted.map((item, index) => {
      if (previousPoints !== item.points) currentRank = index + 1
      previousPoints = item.points
      return { ...item, rank: currentRank }
    })
  }, [classes, rows])
}
