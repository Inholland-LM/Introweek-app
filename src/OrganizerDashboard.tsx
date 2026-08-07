import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Filter,
  Keyboard,
  MapPin,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import type { AppProfile } from './profile'
import { ImportPreviewPanel } from './import/ImportPreviewPanel'
import type { ImportPerson, ImportRole, MasterContent } from './import/parseWorkbook'
import { createPovPhotoUrl, fetchPovSubmissions, type PovSubmission } from './povUploads'
import { createInitialMasterContent, saveMasterContent } from './content'
import { supabase } from './lib/supabase'

type Props = {
  profile: AppProfile
  content: MasterContent | null
  onContentUpdated: () => void
  isWidescreen?: boolean
  onToggleWidescreen?: () => void
}

type TabId = 'people' | 'schedule' | 'pov' | 'messages' | 'settings'

type AnnouncementMessage = {
  id: string
  title: string
  body: string
  scheduledAt: string
  classCode: string
  channel: 'in-app' | 'brevo-email' | 'all'
  actionTarget: 'route' | 'programme' | 'notifications'
  status: 'sent' | 'scheduled'
}

const mockInitialMessages: AnnouncementMessage[] = [
  {
    id: 'msg-1',
    title: '🌧️ Locatiewijziging ivm regen',
    body: 'Het verzamelen om 14:00 is verplaatst naar de aula van Inholland Amsterdam.',
    scheduledAt: '2026-08-25T13:45:00+02:00',
    classCode: 'all',
    channel: 'all',
    actionTarget: 'programme',
    status: 'sent',
  },
  {
    id: 'msg-2',
    title: '🎁 Goodiebags ophalen',
    body: 'Vergeet je polsbandje niet te tonen bij de stand van het festivalterrein.',
    scheduledAt: '2026-08-25T16:00:00+02:00',
    classCode: 'LM1A',
    channel: 'in-app',
    actionTarget: 'notifications',
    status: 'sent',
  },
]

export function OrganizerDashboard({
  profile,
  content,
  onContentUpdated,
  isWidescreen = false,
  onToggleWidescreen,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('people')
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  // People State
  const [people, setPeople] = useState<ImportPerson[]>([
    { studentNumber: '689102', firstName: 'Sofia', namePrefix: null, lastName: 'Jansen', email: '689102@student.inholland.nl', role: 'student', classCode: 'LM1A', active: true },
    { studentNumber: '689103', firstName: 'Daan', namePrefix: 'de', lastName: 'Vries', email: 'daan.devries@inholland.nl', role: 'buddy', classCode: 'LM1A', active: true },
    { studentNumber: '689104', firstName: 'Mila', namePrefix: null, lastName: 'Bakker', email: 'mila.bakker@inholland.nl', role: 'poer', classCode: 'LM1A', active: true },
    { studentNumber: '689105', firstName: 'Prof.', namePrefix: 'van', lastName: 'Dijk', email: 'kees.vandijk@inholland.nl', role: 'interested_teacher', classCode: 'LM1A', active: true },
  ])
  const [personSearch, setPersonSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [classFilter, setClassFilter] = useState<string>('all')

  // New Person Modal
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<ImportRole>('interested_teacher')
  const [newClassCode, setNewClassCode] = useState('LM1A')
  const [showNewPersonModal, setShowNewPersonModal] = useState(false)

  // Edit Person Modal
  const [editingPersonEmail, setEditingPersonEmail] = useState<string | null>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editNamePrefix, setEditNamePrefix] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editStudentNumber, setEditStudentNumber] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<ImportRole>('student')
  const [editClassCode, setEditClassCode] = useState('LM1A')
  const [showEditPersonModal, setShowEditPersonModal] = useState(false)

  // POV Submissions State
  const [submissions, setSubmissions] = useState<PovSubmission[]>([])
  const [loadingPov, setLoadingPov] = useState(false)
  const [selectedPov, setSelectedPov] = useState<PovSubmission | null>(null)
  const [selectedPovUrl, setSelectedPovUrl] = useState('')
  const [pointsInput, setPointsInput] = useState('100')
  const [evaluatingPovId, setEvaluatingPovId] = useState<string | null>(null)
  const [evaluatedAssignmentIds, setEvaluatedAssignmentIds] = useState<Record<string, { points: number; winningSubmissionId: string }>>({})

  // Messages State
  const [messages, setMessages] = useState<AnnouncementMessage[]>(mockInitialMessages)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [msgClass, setMsgClass] = useState('all')
  const [msgChannel, setMsgChannel] = useState<'in-app' | 'brevo-email' | 'all'>('all')
  const [msgAction, setMsgAction] = useState<'route' | 'programme' | 'notifications'>('programme')
  const [msgSortOrder, setMsgSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [msgSuccess, setMsgSuccess] = useState('')

  // Schedule CMS State
  const [programmesList, setProgrammesList] = useState<any[]>([
    { id: 'prog-1', startTime: '13:00', title: 'Ontvangst eerstejaars', locationId: 'Inholland Amsterdam - Aula', description: 'Ontvangst, klasindeling en begeleiding naar de lokalen.' },
    { id: 'prog-2', startTime: '14:30', title: 'Ontdek de Sluisbuurt', locationId: 'Sluisbuurt Campus', description: 'Ontdek de school en voer de foto-opdracht uit.' },
    { id: 'prog-3', startTime: '15:00', title: 'Openingsceremonie', locationId: 'Balkon 2e verdieping', description: 'Gezamenlijke opening op het balkon van de tweede verdieping.' },
    { id: 'prog-4', startTime: '16:00', title: 'Vlaggenparade', locationId: 'Baggerbeest', description: 'Vertrek per klas richting Baggerbeest.' },
  ])
  const [editingProgrammeId, setEditingProgrammeId] = useState<string | null>(null)
  const [editTime, setEditTime] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [scheduleSuccess, setScheduleSuccess] = useState('')

  useEffect(() => {
    if (activeTab === 'pov') {
      void loadPovSubmissions()
    }
  }, [activeTab])

  async function loadPovSubmissions() {
    setLoadingPov(true)
    try {
      const data = await fetchPovSubmissions(0, 50)
      setSubmissions(data)
    } catch {
      // Fallback demo submissions if Supabase offline
      setSubmissions([
        {
          id: 'demo-pov-1',
          assignmentId: 'assign-1',
          assignmentTitle: 'Klasfoto op het NDSM-terrein',
          classCode: 'LM1A',
          uploaderName: 'Sofia Jansen',
          storagePath: 'demo/ndsm.jpg',
          caption: 'Klasse LM1A klaar voor de strijd!',
          byteSize: 240000,
          uploadedAt: new Date().toISOString(),
        },
        {
          id: 'demo-pov-2',
          assignmentId: 'assign-1',
          assignmentTitle: 'Klasfoto op het NDSM-terrein',
          classCode: 'LM1A',
          uploaderName: 'Daan de Vries',
          storagePath: 'demo/ndsm-2.jpg',
          caption: 'Tweede hoek van de klas',
          byteSize: 210000,
          uploadedAt: new Date().toISOString(),
        },
      ])
    } finally {
      setLoadingPov(false)
    }
  }

  // Keyboard Shortcuts Handler
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!selectedPov) return

      if (['1', '2', '3'].includes(event.key)) {
        const presetPoints: Record<string, string> = { '1': '50', '2': '100', '3': '150' }
        if (presetPoints[event.key]) setPointsInput(presetPoints[event.key])
      } else if (event.key === 'Enter') {
        void awardPointsToPov()
      } else if (event.key === 'Escape') {
        setSelectedPov(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPov, pointsInput])

  const [rejectedPovIds, setRejectedPovIds] = useState<Record<string, 'rejected' | 'deleted'>>({})

  function handleRejectPov(povId: string, mode: 'rejected' | 'deleted') {
    if (mode === 'deleted') {
      setSubmissions((prev) => prev.filter((s) => s.id !== povId))
    } else {
      setRejectedPovIds((prev) => ({ ...prev, [povId]: 'rejected' }))
    }
    setSelectedPov(null)
  }

  async function openPovModal(submission: PovSubmission) {
    setSelectedPov(submission)
    setPointsInput('100')
    try {
      const url = await createPovPhotoUrl(submission.storagePath)
      setSelectedPovUrl(url)
    } catch {
      setSelectedPovUrl('https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=800&q=80')
    }
  }

  async function awardPointsToPov() {
    if (!selectedPov) return
    const points = Number(pointsInput) || 100
    setEvaluatingPovId(selectedPov.id)

    // Mark assignment as evaluated with winning submission
    setEvaluatedAssignmentIds((prev) => ({
      ...prev,
      [`${selectedPov.classCode}-${selectedPov.assignmentId}`]: {
        points,
        winningSubmissionId: selectedPov.id,
      },
    }))

    setSelectedPov(null)
    setEvaluatingPovId(null)
  }

  function handleAddPerson() {
    if (!newFirstName || !newEmail) return
    setPeople((prev) => [
      ...prev,
      {
        studentNumber: String(Math.floor(100_000 + Math.random() * 900_000)),
        firstName: newFirstName,
        namePrefix: null,
        lastName: newLastName,
        email: newEmail,
        role: newRole,
        classCode: newClassCode,
        active: true,
      },
    ])
    setNewFirstName('')
    setNewLastName('')
    setNewEmail('')
    setShowNewPersonModal(false)
  }

  function openEditPersonModal(person: ImportPerson) {
    setEditingPersonEmail(person.email)
    setEditFirstName(person.firstName)
    setEditNamePrefix(person.namePrefix ?? '')
    setEditLastName(person.lastName)
    setEditStudentNumber(person.studentNumber ?? '')
    setEditEmail(person.email)
    setEditRole(person.role)
    setEditClassCode(person.classCode ?? 'LM1A')
    setShowEditPersonModal(true)
  }

  function handleSaveEditedPerson() {
    if (!editingPersonEmail || !editFirstName || !editEmail) return

    setPeople((prev) =>
      prev.map((p) =>
        p.email === editingPersonEmail
          ? {
              ...p,
              firstName: editFirstName,
              namePrefix: editNamePrefix.trim() || null,
              lastName: editLastName,
              studentNumber: editStudentNumber.trim() || null,
              email: editEmail,
              role: editRole,
              classCode: editClassCode,
            }
          : p
      )
    )

    setShowEditPersonModal(false)
    setEditingPersonEmail(null)
  }

  function handleDeletePerson(email: string) {
    if (window.confirm(`Weet je zeker dat je ${email} wilt verwijderen uit de lijst?`)) {
      setPeople((prev) => prev.filter((p) => p.email !== email))
    }
  }

  function handleSendBroadcast() {
    if (!msgTitle || !msgBody) return
    const newMsg: AnnouncementMessage = {
      id: `msg-${Date.now()}`,
      title: msgTitle,
      body: msgBody,
      scheduledAt: new Date().toISOString(),
      classCode: msgClass,
      channel: msgChannel,
      actionTarget: msgAction,
      status: 'sent',
    }

    setMessages((prev) => [newMsg, ...prev])
    setMsgSuccess(`Melding "${msgTitle}" succesvol verzonden!`)
    setMsgTitle('')
    setMsgBody('')
    window.setTimeout(() => setMsgSuccess(''), 4_000)
  }

function resolveLocationDetails(locationInput: string, existingLocations: Array<any>) {
  if (!locationInput) return null

  const matched = existingLocations.find(
    (loc) => loc && (loc.name.toLowerCase() === locationInput.toLowerCase() || loc.id === locationInput)
  )
  if (matched) return matched

  const presets: Record<string, { name: string; address: string; routeUrl?: string; lat: number; lng: number }> = {
    'sluisbuurt campus': { name: 'Hogeschool Inholland Amsterdam', address: 'Pina Bauschplein 4, 1095 PN Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', lat: 52.3702, lng: 4.9530 },
    'sluisbuurt': { name: 'Hogeschool Inholland Amsterdam', address: 'Pina Bauschplein 4, 1095 PN Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', lat: 52.3702, lng: 4.9530 },
    'inholland amsterdam': { name: 'Hogeschool Inholland Amsterdam', address: 'Pina Bauschplein 4, 1095 PN Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', lat: 52.3702, lng: 4.9530 },
    'inholland': { name: 'Hogeschool Inholland Amsterdam', address: 'Pina Bauschplein 4, 1095 PN Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', lat: 52.3702, lng: 4.9530 },
    'hogeschool inholland': { name: 'Hogeschool Inholland Amsterdam', address: 'Pina Bauschplein 4, 1095 PN Amsterdam', routeUrl: 'https://www.google.com/maps/search/?api=1&query=Hogeschool+Inholland+Amsterdam+Pina+Bauschplein+4', lat: 52.3702, lng: 4.9530 },
    'westergasfabriek': { name: 'Westergasfabriek', address: 'Gosschalklaan 3, 1014 DC Amsterdam', lat: 52.3861, lng: 4.8701 },
    'westergas': { name: 'Westergasfabriek', address: 'Gosschalklaan 3, 1014 DC Amsterdam', lat: 52.3861, lng: 4.8701 },
    'westergas fabriek': { name: 'Westergasfabriek', address: 'Gosschalklaan 3, 1014 DC Amsterdam', lat: 52.3861, lng: 4.8701 },
    'de duif': { name: 'De Duif', address: 'Prinsengracht 756, Amsterdam', routeUrl: 'https://maps.app.goo.gl/TzDtQjuwy45XLf9S7', lat: 52.3621, lng: 4.8974 },
    'sportcentrum de pijp': { name: 'Sportcentrum De Pijp', address: 'Lizzy Ansinghstraat 88, Amsterdam', routeUrl: 'https://maps.app.goo.gl/X5UauhuGxNfmSAwq6', lat: 52.3524, lng: 4.8942 },
    'ndsm-werf': { name: 'NDSM-werf', address: 'NDSM-Plein 1, Amsterdam', routeUrl: 'https://maps.app.goo.gl/NWYgPZzJN3uzpzHV6', lat: 52.4005, lng: 4.8925 },
    'ndsm': { name: 'NDSM-werf', address: 'NDSM-Plein 1, Amsterdam', routeUrl: 'https://maps.app.goo.gl/NWYgPZzJN3uzpzHV6', lat: 52.4005, lng: 4.8925 },
    'baggerbeest': { name: 'Baggerbeest', address: 'Eef Kamerbeekstraat 1006, Amsterdam', lat: 52.3708, lng: 4.9602 },
    'museumplein': { name: 'Museumplein', address: 'Museumplein, Amsterdam', lat: 52.3580, lng: 4.8810 },
    'vondelpark': { name: 'Vondelpark', address: 'Vondelpark, Amsterdam', lat: 52.3580, lng: 4.8686 },
    'rembrandtplein': { name: 'Rembrandtplein', address: 'Rembrandtplein, Amsterdam', lat: 52.3660, lng: 4.8967 },
    'leidseplein': { name: 'Leidseplein', address: 'Leidseplein, Amsterdam', lat: 52.3640, lng: 4.8827 },
    'oosterpark': { name: 'Oosterpark', address: 'Oosterpark, Amsterdam', lat: 52.3600, lng: 4.9200 },
    'artis': { name: 'Artis Zoo', address: 'Plantage Kerklaan 38-40, Amsterdam', lat: 52.3660, lng: 4.9165 },
    'tolhuistuin': { name: 'Tolhuistuin', address: 'IJpromenade 2, Amsterdam', lat: 52.3836, lng: 4.9009 },
    'brakke grond': { name: 'Brakke Grond', address: 'Nes 45, Amsterdam', lat: 52.3705, lng: 4.8938 },
    'melkweg': { name: 'Melkweg', address: 'Lijnbaansgracht 234A, Amsterdam', lat: 52.3648, lng: 4.8817 },
    'paradiso': { name: 'Paradiso', address: 'Weteringschans 6-8, Amsterdam', lat: 52.3622, lng: 4.8837 },
  }

  const key = locationInput.toLowerCase().trim()
  const matchedKey = Object.keys(presets).find((p) => key === p || key.includes(p) || p.includes(key))

  if (matchedKey) {
    const preset = presets[matchedKey]
    const newLocId = `loc-auto-${Date.now()}`
    return {
      id: newLocId,
      name: preset.name,
      address: preset.address,
      postalCode: '1095 MJ',
      city: 'Amsterdam',
      routeUrl: preset.routeUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(preset.name + ' Amsterdam')}`,
      latitude: preset.lat,
      longitude: preset.lng,
      active: true,
    }
  }

  const newLocId = `loc-auto-${Date.now()}`
  return {
    id: newLocId,
    name: locationInput,
    address: `${locationInput}, Amsterdam`,
    postalCode: '1000 AA',
    city: 'Amsterdam',
    routeUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Hogeschool Inholland Amsterdam ' + locationInput)}`,
    latitude: 52.3702,
    longitude: 4.9530,
    active: true,
  }
}

  function handleSaveProgrammeItem() {
    if (!editingProgrammeId || !editTitle) return

    const baseContent = content ?? createInitialMasterContent()
    const currentLocations = [...(baseContent.locations ?? [])]
    const resolvedLoc = resolveLocationDetails(editLocation, currentLocations)

    let updatedLocations = currentLocations
    let targetLocId = editLocation

    if (resolvedLoc) {
      targetLocId = resolvedLoc.name
      if (!currentLocations.some((l) => l.name.toLowerCase() === resolvedLoc.name.toLowerCase())) {
        updatedLocations = [...currentLocations, resolvedLoc]
      }
    }

    const updatedProgrammes = programmesList.map((item) =>
      item.id === editingProgrammeId
        ? {
            ...item,
            date: item.date ?? '2026-08-25',
            startTime: editTime || '13:00',
            endTime: item.endTime ?? null,
            title: editTitle || 'Activiteit',
            category: item.category ?? 'Programma',
            locationId: targetLocId,
            classCodes: item.classCodes ?? 'all',
            description: editDescription ?? null,
            order: item.order ?? 1,
            active: true,
          }
        : {
            ...item,
            date: item.date ?? '2026-08-25',
            startTime: item.startTime ?? '13:00',
            endTime: item.endTime ?? null,
            title: item.title ?? 'Activiteit',
            category: item.category ?? 'Programma',
            locationId: item.locationId ?? null,
            classCodes: item.classCodes ?? 'all',
            description: item.description ?? null,
            order: item.order ?? 1,
            active: true,
          }
    )

    setProgrammesList(updatedProgrammes)

    // Build next MasterContent & save
    const updatedContent: MasterContent = {
      ...baseContent,
      locations: updatedLocations,
      programmes: updatedProgrammes,
    }

    saveMasterContent(updatedContent)
    onContentUpdated()

    setScheduleSuccess(`Programma-onderdeel "${editTitle}" is live gewijzigd en doorgevoerd op de kaart!`)
    setEditingProgrammeId(null)
    window.setTimeout(() => setScheduleSuccess(''), 4_000)
  }

  const filteredPeople = useMemo(() => {
    return people.filter((p) => {
      const matchQuery = `${p.firstName} ${p.lastName} ${p.email} ${p.classCode}`.toLowerCase().includes(personSearch.toLowerCase())
      const matchRole = roleFilter === 'all' || p.role === roleFilter
      const matchClass = classFilter === 'all' || p.classCode === classFilter
      return matchQuery && matchRole && matchClass
    })
  }, [people, personSearch, roleFilter, classFilter])

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const timeA = new Date(a.scheduledAt).getTime()
      const timeB = new Date(b.scheduledAt).getTime()
      return msgSortOrder === 'newest' ? timeB - timeA : timeA - timeB
    })
  }, [messages, msgSortOrder])

  return (
    <div className="organizer-dashboard">
      {/* Top Header Bar */}
      <header className="dashboard-topbar">
        <div className="dashboard-title">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h1>Organisatiedashboard</h1>
            <small>LM = YOU · Inholland Amsterdam</small>
          </div>
        </div>
        <div className="dashboard-top-actions">
          {onToggleWidescreen && (
            <button
              type="button"
              className="shortcut-help-button view-mode-toggle-btn"
              onClick={onToggleWidescreen}
              title={isWidescreen ? 'Wissel naar telefoonweergave' : 'Wissel naar volledige schermweergave'}
            >
              {isWidescreen ? <Smartphone aria-hidden="true" /> : <Monitor aria-hidden="true" />}
              <span>{isWidescreen ? 'Telefoonweergave' : 'Volledig scherm'}</span>
            </button>
          )}
          <button
            type="button"
            className="shortcut-help-button"
            onClick={() => setShowShortcutsModal(true)}
            title="Sneltoetsen overzicht"
          >
            <Keyboard aria-hidden="true" />
            <span>Sneltoetsen</span>
          </button>
        </div>
      </header>

      {/* Main Layout Grid */}
      <div className="dashboard-grid">
        {/* Left Sidebar Navigation (Desktop & Laptop Layout) */}
        <nav className="dashboard-sidebar" aria-label="Dashboard navigatie">
          <button type="button" className={activeTab === 'people' ? 'active' : ''} onClick={() => setActiveTab('people')}>
            <Users aria-hidden="true" />
            <span>Personen</span>
          </button>
          <button type="button" className={activeTab === 'schedule' ? 'active' : ''} onClick={() => setActiveTab('schedule')}>
            <Calendar aria-hidden="true" />
            <span>Programma</span>
          </button>
          <button type="button" className={activeTab === 'pov' ? 'active' : ''} onClick={() => setActiveTab('pov')}>
            <Camera aria-hidden="true" />
            <span>POV-foto's</span>
          </button>
          <button type="button" className={activeTab === 'messages' ? 'active' : ''} onClick={() => setActiveTab('messages')}>
            <Bell aria-hidden="true" />
            <span>Berichten</span>
          </button>
          <button type="button" className={`subtle-tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} title="Technisch beheerderspaneel">
            <Settings aria-hidden="true" />
            <span>Technisch &amp; DNS</span>
          </button>
        </nav>

        {/* Content Area */}
        <main className="dashboard-main">
          {/* TAB 1: PERSONEN & ROLLEN */}
          {activeTab === 'people' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>Personen &amp; Rollen Beheer</h2>
                  <p>Beheer studenten, buddy's, PO'ers en geïnteresseerde docenten.</p>
                </div>
                <div className="header-button-group">
                  <button type="button" className="secondary-button" onClick={() => setShowImportModal(true)}>
                    <FileSpreadsheet aria-hidden="true" />
                    <span>Excel importeren</span>
                  </button>
                  <button type="button" className="primary-button" onClick={() => setShowNewPersonModal(true)}>
                    <Plus aria-hidden="true" />
                    <span>Persoon toevoegen</span>
                  </button>
                </div>
              </div>

              {/* Filters Bar */}
              <div className="table-filters-bar">
                <div className="search-input-wrapper">
                  <Search aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Zoek op naam, e-mail of klas..."
                    value={personSearch}
                    onChange={(e) => setPersonSearch(e.target.value)}
                  />
                </div>
                <div className="select-filters">
                  <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                    <option value="all">Alle rollen</option>
                    <option value="student">Student</option>
                    <option value="buddy">Buddy</option>
                    <option value="poer">PO'er</option>
                    <option value="interested_teacher">Geïnteresseerde Docent</option>
                    <option value="organizer">Organisator</option>
                  </select>
                  <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                    <option value="all">Alle klassen</option>
                    {['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Responsive Table */}
              <div className="table-responsive-wrapper">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th>E-mailadres</th>
                      <th>Rol</th>
                      <th>Klas</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPeople.map((person, idx) => (
                      <tr key={`${person.email}-${idx}`}>
                        <td>
                          <div className="person-name-cell">
                            <strong>{[person.firstName, person.namePrefix, person.lastName].filter(Boolean).join(' ')}</strong>
                            {person.studentNumber && <span className="student-number-pill">#{person.studentNumber}</span>}
                          </div>
                        </td>
                        <td>{person.email}</td>
                        <td>
                          <span className={`role-badge role-${person.role}`}>
                            {person.role === 'interested_teacher' ? 'Docent / Medewerker' : person.role.toUpperCase()}
                          </span>
                        </td>
                        <td><strong>{person.classCode ?? 'Geen'}</strong></td>
                        <td>
                          <span className="status-dot-active">● Actief</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="table-row-actions">
                            <button
                              type="button"
                              className="secondary-button icon-only-btn"
                              onClick={() => openEditPersonModal(person)}
                              title="Persoon bewerken"
                            >
                              <Edit3 aria-hidden="true" />
                              <span>Bewerken</span>
                            </button>
                            <button
                              type="button"
                              className="danger-button icon-only-btn"
                              onClick={() => handleDeletePerson(person.email)}
                              title="Persoon verwijderen"
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* TAB 2: PROGRAMMA & LOCATIES CMS */}
          {activeTab === 'schedule' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>Programma &amp; Locaties CMS</h2>
                  <p>Pas tijden en locaties live aan. Wijzigingen worden direct doorgevoerd in alle webapps.</p>
                </div>
              </div>

              {scheduleSuccess && <div className="notification-state notification-success">{scheduleSuccess}</div>}

              <div className="programme-editor-list">
                {programmesList.map((item: any) => (
                  <div key={item.id} className="programme-editor-card">
                    <div className="card-left">
                      <Clock aria-hidden="true" />
                      <strong>{item.startTime}</strong>
                      <div>
                        <h3>{item.title}</h3>
                        {item.description && <p style={{ margin: '4px 0', fontSize: '0.82rem', color: '#64748b' }}>{item.description}</p>}
                        <span className="prog-location-tag">
                          <MapPin aria-hidden="true" />
                          <span>{item.locationId || 'Locatie niet ingesteld'}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingProgrammeId(item.id)
                        setEditTime(item.startTime)
                        setEditTitle(item.title)
                        setEditDescription(item.description ?? '')
                        setEditLocation(item.locationId ?? 'Inholland')
                      }}
                    >
                      <Edit3 aria-hidden="true" /> Live bewerken
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TAB 3: POV FOTO REVIEW & PUNTEN */}
          {activeTab === 'pov' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>POV-foto Beoordeling &amp; Punten</h2>
                  <p>Klik op een foto om de inzending te bekijken en flexibel punten toe te kennen.</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => void loadPovSubmissions()}>
                  <RefreshCw aria-hidden="true" /> Vernieuwen
                </button>
              </div>

              {loadingPov && <div className="notification-state">Inzendingen ophalen...</div>}

              <div className="pov-grid-dashboard">
                {submissions.map((item) => {
                  const evalKey = `${item.classCode}-${item.assignmentId}`
                  const evaluation = evaluatedAssignmentIds[evalKey]
                  const isWinner = evaluation?.winningSubmissionId === item.id
                  const isEvaluated = Boolean(evaluation)

                  return (
                    <div
                      key={item.id}
                      className={`pov-dashboard-card ${isWinner ? 'is-winner' : isEvaluated ? 'is-evaluated' : ''}`}
                      onClick={() => void openPovModal(item)}
                    >
                      <div className="pov-card-img-holder">
                        <img src="https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=400&q=80" alt={item.assignmentTitle} loading="lazy" />
                        {isWinner && (
                          <div className="winner-badge">
                            <span>BESTE FOTO (+{evaluation.points} PT)</span>
                          </div>
                        )}
                        {isEvaluated && !isWinner && (
                          <div className="evaluated-overlay">
                            <span>Opdracht reeds beoordeeld</span>
                          </div>
                        )}
                      </div>
                      <div className="pov-card-details">
                        <span className="class-tag">{item.classCode}</span>
                        <strong>{item.assignmentTitle}</strong>
                        <small>Door: {item.uploaderName}</small>
                        {item.caption && <p>"{item.caption}"</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* TAB 4: BERICHTEN & BREVO */}
          {activeTab === 'messages' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>Berichten &amp; Brevo E-mail Sync</h2>
                  <p>Verstuur live waarschuwingsbanners naar studenten en e-mails via Brevo.</p>
                </div>
              </div>

              {msgSuccess && <div className="notification-state notification-success">{msgSuccess}</div>}

              {/* Compose Message Form */}
              <div className="compose-message-card">
                <h3>Nieuwe Melding Versturen</h3>
                <div className="form-grid">
                  <label>
                    <span>Titel van het bericht</span>
                    <input
                      type="text"
                      placeholder="bijv. 🌧️ Locatiewijziging ivm regen"
                      value={msgTitle}
                      onChange={(e) => setMsgTitle(e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Doelgroep Klas</span>
                    <select value={msgClass} onChange={(e) => setMsgClass(e.target.value)}>
                      <option value="all">Alle klassen</option>
                      {['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H'].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="full-width">
                    <span>Bericht inhoud</span>
                    <textarea
                      rows={3}
                      placeholder="Wat moeten de studenten weten?"
                      value={msgBody}
                      onChange={(e) => setMsgBody(e.target.value)}
                    />
                  </label>

                  <label>
                    <span>Verzendkanaal</span>
                    <select value={msgChannel} onChange={(e) => setMsgChannel(e.target.value as any)}>
                      <option value="all">In-App + Brevo E-mail</option>
                      <option value="in-app">Alleen In-App Notification</option>
                      <option value="brevo-email">Alleen Brevo E-mail</option>
                    </select>
                  </label>

                  <label>
                    <span>Banner Klikdoel op Telefoon</span>
                    <select value={msgAction} onChange={(e) => setMsgAction(e.target.value as any)}>
                      <option value="programme">Programma Tab (met ⚠️ GEWIJZIGD markering)</option>
                      <option value="route">Directe Routeknop / Kaart</option>
                      <option value="notifications">Meldingen Tab</option>
                    </select>
                  </label>
                </div>

                <div className="compose-actions">
                  <button type="button" className="primary-button" onClick={handleSendBroadcast}>
                    <Send aria-hidden="true" />
                    <span>Verstuur Bericht &amp; Banner</span>
                  </button>
                </div>
              </div>

              {/* Message History */}
              <div className="message-history">
                <div className="history-header">
                  <h3>Verzonden Berichten</h3>
                  <div className="history-sort">
                    <Filter aria-hidden="true" />
                    <select value={msgSortOrder} onChange={(e) => setMsgSortOrder(e.target.value as any)}>
                      <option value="newest">Nieuwste eerst</option>
                      <option value="oldest">Oudste eerst</option>
                    </select>
                  </div>
                </div>

                <div className="message-list">
                  {sortedMessages.map((msg) => (
                    <div key={msg.id} className="message-history-card">
                      <div className="msg-header">
                        <strong>{msg.title}</strong>
                        <span className="msg-time">{new Date(msg.scheduledAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p>{msg.body}</p>
                      <div className="msg-badges">
                        <span className="badge">Klas: {msg.classCode}</span>
                        <span className="badge">Kanaal: {msg.channel}</span>
                        <span className="badge">Klikdoel: {msg.actionTarget}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* TAB 5: SYSTEEM & DNS */}
          {activeTab === 'settings' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>Technisch &amp; TransIP DNS Instellingen</h2>
                  <p>Beheerdersinstellingen voor e-mail authenticatie en database status.</p>
                </div>
              </div>

              <div className="system-status-grid">
                <div className="status-card ok">
                  <ShieldCheck aria-hidden="true" />
                  <div>
                    <strong>Database Verbinding (Supabase)</strong>
                    <small>Actief &amp; Beveiligd met Row Level Security</small>
                  </div>
                </div>

                <div className="status-card ok">
                  <Send aria-hidden="true" />
                  <div>
                    <strong>Brevo E-mail Delivery Engine</strong>
                    <small>Gekoppeld via Transactional SMTP API</small>
                  </div>
                </div>
              </div>

              <div className="dns-guide-card">
                <div className="dns-card-header">
                  <h3>📋 2 TXT-records voor TransIP Controlepaneel</h3>
                  <p>Voeg deze 2 records toe onder <strong>Domein &amp; Hosting ➔ Jouw Domein ➔ DNS-instellingen</strong> in TransIP:</p>
                </div>

                <div className="dns-records-list">
                  <div className="dns-record-item">
                    <div className="dns-record-meta">
                      <span className="record-type">TXT</span>
                      <strong>1. SPF Record (Voorkomt dat mail in spam belandt)</strong>
                    </div>
                    <div className="dns-record-fields">
                      <div className="dns-field">
                        <small>Naam / Host:</small>
                        <code>@</code>
                      </div>
                      <div className="dns-field value-field">
                        <small>Waarde / Inhoud:</small>
                        <code>v=spf1 include:spf.brevo.com ~all</code>
                      </div>
                    </div>
                  </div>

                  <div className="dns-record-item">
                    <div className="dns-record-meta">
                      <span className="record-type">TXT</span>
                      <strong>2. DKIM Record (Digitale handtekening van Inholland)</strong>
                    </div>
                    <div className="dns-record-fields">
                      <div className="dns-field">
                        <small>Naam / Host:</small>
                        <code>mail._domainkey</code>
                      </div>
                      <div className="dns-field value-field">
                        <small>Waarde / Inhoud:</small>
                        <code>v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeM2Y4w88W8...</code>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* LIGHTBOX / POV REVIEW MODAL */}
      {selectedPov && (
        <div className="modal-overlay" onClick={() => setSelectedPov(null)}>
          <div className="modal-content pov-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setSelectedPov(null)}>
              <X aria-hidden="true" />
            </button>

            <div className="pov-modal-body">
              <div className="pov-modal-photo">
                <img src={selectedPovUrl || 'https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=800&q=80'} alt={selectedPov.assignmentTitle} />
              </div>
              <div className="pov-modal-info">
                <span className="class-badge-large">{selectedPov.classCode}</span>
                <h2>{selectedPov.assignmentTitle}</h2>
                <p className="uploader-info">Ingestuurd door <strong>{selectedPov.uploaderName}</strong></p>
                {selectedPov.caption && <blockquote className="photo-caption">"{selectedPov.caption}"</blockquote>}

                <div className="award-points-box">
                  <label htmlFor="points-input">
                    <span>Aantal punten toekennen:</span>
                  </label>
                  <div className="points-input-row">
                    <input
                      id="points-input"
                      type="number"
                      value={pointsInput}
                      onChange={(e) => setPointsInput(e.target.value)}
                    />
                    <span className="unit">punten</span>
                  </div>

                  <div className="quick-points-buttons">
                    <button type="button" onClick={() => setPointsInput('50')}>50</button>
                    <button type="button" onClick={() => setPointsInput('100')}>100</button>
                    <button type="button" onClick={() => setPointsInput('150')}>150</button>
                  </div>

                  <button
                    type="button"
                    className="primary-button full-width"
                    disabled={evaluatingPovId === selectedPov.id}
                    onClick={() => void awardPointsToPov()}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    <span>Bevestig en ken punten toe (Enter)</span>
                  </button>
                </div>

                <div className="moderation-actions-box">
                  <span className="moderation-label">Of foto modereren of afkeuren:</span>
                  <div className="moderation-button-group">
                    <button
                      type="button"
                      className="moderation-btn reject-btn"
                      onClick={() => handleRejectPov(selectedPov.id, 'rejected')}
                    >
                      <X aria-hidden="true" />
                      <span>Afkeuren (plek blijft bezet)</span>
                    </button>

                    <button
                      type="button"
                      className="moderation-btn delete-btn"
                      onClick={() => handleRejectPov(selectedPov.id, 'deleted')}
                    >
                      <Trash2 aria-hidden="true" />
                      <span>Wissen (plek komt vrij)</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW PERSON MODAL */}
      {showNewPersonModal && (
        <div className="modal-overlay" onClick={() => setShowNewPersonModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Nieuwe persoon toevoegen</h3>
              <button type="button" className="modal-close" onClick={() => setShowNewPersonModal(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>Voornaam</span>
                <input type="text" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} />
              </label>
              <label>
                <span>Achternaam</span>
                <input type="text" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} />
              </label>
              <label className="full-width">
                <span>E-mailadres</span>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>
                <span>Rol</span>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value as any)}>
                  <option value="student">Student</option>
                  <option value="buddy">Buddy</option>
                  <option value="poer">PO'er</option>
                  <option value="interested_teacher">Geïnteresseerde docent / medewerker</option>
                  <option value="organizer">Organisator</option>
                </select>
              </label>
              <label>
                <span>Klas</span>
                <select value={newClassCode} onChange={(e) => setNewClassCode(e.target.value)}>
                  {['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={handleAddPerson}>
                <Plus aria-hidden="true" />
                <span>Toevoegen</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PERSON MODAL */}
      {showEditPersonModal && (
        <div className="modal-overlay" onClick={() => setShowEditPersonModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Persoon gegevens wijzigen</h3>
              <button type="button" className="modal-close" onClick={() => setShowEditPersonModal(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>Voornaam</span>
                <input type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
              </label>
              <label>
                <span>Tussenvoegsel</span>
                <input type="text" placeholder="bijv. van" value={editNamePrefix} onChange={(e) => setEditNamePrefix(e.target.value)} />
              </label>
              <label>
                <span>Achternaam</span>
                <input type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
              </label>
              <label>
                <span>Studentnummer</span>
                <input type="text" placeholder="bijv. 689102" value={editStudentNumber} onChange={(e) => setEditStudentNumber(e.target.value)} />
              </label>
              <label className="full-width">
                <span>E-mailadres</span>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </label>
              <label>
                <span>Rol</span>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value as any)}>
                  <option value="student">Student</option>
                  <option value="buddy">Buddy</option>
                  <option value="poer">PO'er</option>
                  <option value="interested_teacher">Geïnteresseerde docent / medewerker</option>
                  <option value="organizer">Organisator</option>
                </select>
              </label>
              <label>
                <span>Klas</span>
                <select value={editClassCode} onChange={(e) => setEditClassCode(e.target.value)}>
                  {['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button type="button" className="secondary-button" onClick={() => setShowEditPersonModal(false)}>
                Annuleren
              </button>
              <button type="button" className="primary-button" onClick={handleSaveEditedPerson}>
                <Edit3 aria-hidden="true" />
                <span>Wijzigingen opslaan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROGRAMME ITEM EDIT MODAL */}
      {editingProgrammeId && (
        <div className="modal-overlay" onClick={() => setEditingProgrammeId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Programma-onderdeel live bewerken</h3>
              <button type="button" className="modal-close" onClick={() => setEditingProgrammeId(null)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>Tijdstip</span>
                <input type="text" placeholder="bijv. 13:00" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
              </label>
              <label>
                <span>Titel van activiteit</span>
                <input type="text" placeholder="bijv. Ontvangst eerstejaars" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </label>
              <label className="full-width">
                <span>Omschrijving</span>
                <textarea rows={3} placeholder="Wat gaan de studenten doen?" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </label>
              <label className="full-width">
                <span>Locatie</span>
                <input type="text" placeholder="bijv. Inholland Amsterdam - Aula" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
              </label>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button type="button" className="secondary-button" onClick={() => setEditingProgrammeId(null)}>
                Annuleren
              </button>
              <button type="button" className="primary-button" onClick={handleSaveProgrammeItem}>
                <Edit3 aria-hidden="true" />
                <span>Opslaan &amp; Live Doorvoeren</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KEYBOARD SHORTCUTS MODAL */}
      {showShortcutsModal && (
        <div className="modal-overlay" onClick={() => setShowShortcutsModal(false)}>
          <div className="modal-content shortcuts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="title-with-icon">
                <Keyboard aria-hidden="true" />
                <h3>Sneltoetsenoverzicht</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowShortcutsModal(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="shortcuts-list">
              <div className="shortcut-row">
                <div className="shortcut-key-group">
                  <kbd>1</kbd> <span>t/m</span> <kbd>3</kbd>
                </div>
                <span className="shortcut-desc">Snel punten selecteren (50, 100, 150 pt)</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-key-group">
                  <kbd>Enter</kbd>
                </div>
                <span className="shortcut-desc">Bevestig en ken punten toe op foto</span>
              </div>
              <div className="shortcut-row">
                <div className="shortcut-key-group">
                  <kbd>Esc</kbd>
                </div>
                <span className="shortcut-desc">Fotovergroting of venster sluiten</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXCEL IMPORT MODAL */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setShowImportModal(false)}>
              <X aria-hidden="true" />
            </button>
            <ImportPreviewPanel
              onApplied={() => {
                setShowImportModal(false)
                onContentUpdated()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
