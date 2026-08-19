import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import { exportCurrentMasterWorkbook } from './import/exportWorkbook'
import type { ImportRole, MasterContent } from './import/parseWorkbook'
import { approvePovSubmissionWithPoints, createPovPhotoUrl, deletePovSubmission, fetchPovSubmissions, reviewPovSubmission, type PovSubmission } from './povUploads'
import { createInitialMasterContent, updateMasterContent } from './content'
import {
  fetchOrganizerRecipients,
  fetchOrganizerMessageHistory,
  sendOrganizerNotification,
  type OrganizerDeliveryChannel,
  type OrganizerRecipient,
} from './organizerMessaging'
import { supabase } from './lib/supabase'
import {
  deactivateOrganizerPerson,
  fetchOrganizerPeople,
  notifyOrganizerPersonChange,
  saveOrganizerPerson,
  type OrganizerPerson,
} from './organizerPeople'

type Props = {
  profile: AppProfile
  content: MasterContent | null
  contentVersion: number
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
  targets: string[]
  channel: OrganizerDeliveryChannel
  actionTarget: 'route' | 'programme' | 'notifications'
  status: 'sent' | 'scheduled'
  source: 'master' | 'history'
}

type MessageHistoryFilters = {
  day: string
  time: string
  target: string
  channel: 'all' | OrganizerDeliveryChannel
}

type PeopleSortKey = 'firstName' | 'lastName' | 'studentNumber' | 'email' | 'role' | 'classCode' | 'active'
type SortDirection = 'asc' | 'desc'

const EMPTY_MESSAGE_FILTERS: MessageHistoryFilters = { day: '', time: '', target: '', channel: 'all' }

function deliveryChannelLabel(channel: OrganizerDeliveryChannel) {
  if (channel === 'both') return 'In-app + push'
  if (channel === 'push') return 'Alleen push'
  return 'Alleen in-app'
}

function localDatePart(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTimePart(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function currentLocalMessageMoment() {
  const now = new Date()
  return {
    date: localDatePart(now.toISOString()),
    time: localTimePart(now.toISOString()),
  }
}

function compareMessageMoment(date: string, time: string) {
  if (!date || !time) return 'invalid' as const
  const selected = new Date(`${date}T${time}:00`)
  if (Number.isNaN(selected.getTime())) return 'invalid' as const
  const currentMinute = new Date()
  currentMinute.setSeconds(0, 0)
  if (selected.getTime() < currentMinute.getTime()) return 'past' as const
  if (selected.getTime() > currentMinute.getTime()) return 'future' as const
  return 'now' as const
}

function programmeDayLabel(value: string) {
  if (!value) return 'Dag niet ingesteld'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })
}

function programmeAudienceLabel(classCodes: string[] | 'all') {
  return classCodes === 'all' ? 'Alle klassen' : classCodes.join(', ')
}

function organizerRoleLabel(role: ImportRole) {
  if (role === 'student') return 'Student'
  if (role === 'buddy') return 'Buddy'
  if (role === 'poer') return "PO'er"
  if (role === 'interested_teacher') return 'Docent / Medewerker'
  return 'Organisator'
}

export function OrganizerDashboard({
  profile,
  content,
  contentVersion,
  onContentUpdated,
  isWidescreen = false,
  onToggleWidescreen,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('people')
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  // People State
  const [people, setPeople] = useState<OrganizerPerson[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleExporting, setPeopleExporting] = useState(false)
  const [peopleSaving, setPeopleSaving] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [peopleSuccess, setPeopleSuccess] = useState('')
  const [personSearch, setPersonSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [classFilter, setClassFilter] = useState<string>('all')
  const [peopleSort, setPeopleSort] = useState<{ key: PeopleSortKey; direction: SortDirection }>({
    key: 'lastName',
    direction: 'asc',
  })

  // New Person Modal
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newStudentNumber, setNewStudentNumber] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<ImportRole>('interested_teacher')
  const [newClassCode, setNewClassCode] = useState('LM1A')
  const [showNewPersonModal, setShowNewPersonModal] = useState(false)

  // Edit Person Modal
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null)
  const [editFirstName, setEditFirstName] = useState('')
  const [editNamePrefix, setEditNamePrefix] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editStudentNumber, setEditStudentNumber] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<ImportRole>('student')
  const [editClassCode, setEditClassCode] = useState('LM1A')
  const [editActive, setEditActive] = useState(true)
  const [showEditPersonModal, setShowEditPersonModal] = useState(false)
  const [editSendNotification, setEditSendNotification] = useState(true)
  const [editNotificationChannel, setEditNotificationChannel] = useState<OrganizerDeliveryChannel>('both')

  // POV Submissions State
  const [submissions, setSubmissions] = useState<PovSubmission[]>([])
  const [loadingPov, setLoadingPov] = useState(false)
  const [selectedPov, setSelectedPov] = useState<PovSubmission | null>(null)
  const [selectedPovUrl, setSelectedPovUrl] = useState('')
  const [pointsInput, setPointsInput] = useState('100')
  const [evaluatingPovId, setEvaluatingPovId] = useState<string | null>(null)

  // Messages State
  const [messages, setMessages] = useState<AnnouncementMessage[]>([])
  const [msgTitle, setMsgTitle] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [selectedClassCodes, setSelectedClassCodes] = useState<string[]>([])
  const [selectedBuddyIds, setSelectedBuddyIds] = useState<string[]>([])
  const [selectedPoerIds, setSelectedPoerIds] = useState<string[]>([])
  const [messageRecipients, setMessageRecipients] = useState<OrganizerRecipient[]>([])
  const [recipientsLoading, setRecipientsLoading] = useState(false)
  const [recipientsError, setRecipientsError] = useState('')
  const [msgChannel, setMsgChannel] = useState<OrganizerDeliveryChannel>('both')
  const [editingScheduledMessageId, setEditingScheduledMessageId] = useState<string | null>(null)
  const [msgScheduledDate, setMsgScheduledDate] = useState(() => currentLocalMessageMoment().date)
  const [msgScheduledTime, setMsgScheduledTime] = useState(() => currentLocalMessageMoment().time)
  const effectiveMessageDeliveryTiming = compareMessageMoment(msgScheduledDate, msgScheduledTime) === 'future'
    ? 'scheduled'
    : 'now'
  const [scheduledFilters, setScheduledFilters] = useState<MessageHistoryFilters>(EMPTY_MESSAGE_FILTERS)
  const [sentFilters, setSentFilters] = useState<MessageHistoryFilters>(EMPTY_MESSAGE_FILTERS)
  const [msgSuccess, setMsgSuccess] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const composeMessageRef = useRef<HTMLDivElement | null>(null)

  // Schedule CMS State
  const [programmesList, setProgrammesList] = useState<MasterContent['programmes']>(() =>
    createInitialMasterContent().programmes.map((item) => ({ ...item })),
  )
  const [editingProgrammeId, setEditingProgrammeId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editEndTime, setEditEndTime] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [addingProgrammeLocation, setAddingProgrammeLocation] = useState(false)
  const [newLocationName, setNewLocationName] = useState('')
  const [newLocationAddress, setNewLocationAddress] = useState('')
  const [newLocationPostalCode, setNewLocationPostalCode] = useState('')
  const [newLocationCity, setNewLocationCity] = useState('Amsterdam')
  const [newLocationRouteUrl, setNewLocationRouteUrl] = useState('')
  const [programmeSearch, setProgrammeSearch] = useState('')
  const [programmeDayFilter, setProgrammeDayFilter] = useState('all')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleSuccess, setScheduleSuccess] = useState('')
  const [scheduleError, setScheduleError] = useState('')

  const activeClassCodes = useMemo(() => {
    const configured = (content?.classes ?? [])
      .filter((item) => item.active !== false && item.classCode)
      .map((item) => item.classCode)
    return configured.length ? [...new Set(configured)].sort() : ['LM1A', 'LM1B', 'LM1C', 'LM1D', 'LM1E', 'LM1F', 'LM1G', 'LM1H']
  }, [content?.classes])

  const buddyRecipients = messageRecipients.filter((recipient) => recipient.role === 'buddy')
  const poerRecipients = messageRecipients.filter((recipient) => recipient.role === 'poer')

  useEffect(() => {
    if (!content?.programmes) return
    setProgrammesList(content.programmes.map((item) => ({ ...item })))
  }, [content?.programmes])

  useEffect(() => {
    if (activeTab === 'people') void loadOrganizerPeople()
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'messages') return
    let active = true
    setRecipientsLoading(true)
    setRecipientsError('')
    Promise.all([fetchOrganizerRecipients(), fetchOrganizerMessageHistory()])
      .then(([recipients, history]) => {
        if (!active) return
        setMessageRecipients(recipients.length ? recipients : people
          .filter((person) => person.role === 'buddy' || person.role === 'poer')
          .map((person, index) => ({
            id: `demo-recipient-${index}`,
            displayName: [person.firstName, person.namePrefix, person.lastName].filter(Boolean).join(' '),
            email: person.email,
            role: person.role as 'buddy' | 'poer',
            classCode: person.classCode,
          })))
        const planned = (content?.messages ?? []).filter((message) => message.active).map((message): AnnouncementMessage => ({
          id: `master:${message.id}`,
          title: message.title,
          body: message.body,
          scheduledAt: message.scheduledAt,
          targets: [
            ...(message.roles.includes('student') ? (message.classCodes === 'all' ? ['Alle klassen'] : message.classCodes) : []),
            ...(message.roles.includes('buddy') ? ['Buddy’s'] : []),
            ...(message.roles.includes('poer') ? ['PO’ers'] : []),
          ],
          channel: message.channel,
          actionTarget: 'notifications',
          status: new Date(message.scheduledAt).getTime() > Date.now() ? 'scheduled' : 'sent',
          source: 'master',
        }))
        const sent = history.map((message): AnnouncementMessage => ({ ...message, actionTarget: 'notifications', source: 'history' }))
        setMessages([...planned, ...sent].filter((message, index, all) => all.findIndex((candidate) => candidate.id === message.id) === index))
      })
      .catch((reason) => {
        if (active) setRecipientsError(reason instanceof Error ? reason.message : 'Ontvangers konden niet worden opgehaald.')
      })
      .finally(() => { if (active) setRecipientsLoading(false) })
    return () => { active = false }
  }, [activeTab, content?.messages])

  useEffect(() => {
    if (activeTab === 'pov') {
      void loadPovSubmissions()
    }
  }, [activeTab])

  async function loadOrganizerPeople() {
    setPeopleLoading(true)
    setPeopleError('')
    try {
      setPeople(await fetchOrganizerPeople())
    } catch (reason) {
      setPeopleError(reason instanceof Error ? reason.message : 'De personenlijst kon niet worden opgehaald.')
    } finally {
      setPeopleLoading(false)
    }
  }

  async function handleMasterExport() {
    if (peopleExporting) return
    setPeopleExporting(true)
    setPeopleError('')
    setPeopleSuccess('')
    try {
      const result = await exportCurrentMasterWorkbook()
      setPeopleSuccess(`Masterbestand gedownload met ${result.peopleCount} personen en alle actuele organisatie-inhoud.`)
    } catch (reason) {
      setPeopleError(reason instanceof Error ? reason.message : 'Het actuele masterbestand kon niet worden gemaakt.')
    } finally {
      setPeopleExporting(false)
    }
  }

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
          reviewStatus: 'pending',
          rejectionReason: null,
          awardedPoints: 0,
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
          reviewStatus: 'pending',
          rejectionReason: null,
          awardedPoints: 0,
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

      const target = event.target
      const isEditingValue = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)

      // De sneltoetsen 1/2/3 mogen nooit een handmatig ingevoerd puntenaantal
      // overschrijven. Enter blijft in het puntenveld wel beschikbaar om op te slaan.
      if (isEditingValue && event.key !== 'Enter' && event.key !== 'Escape') return

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

  useEffect(() => {
    if (!selectedPov) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedPov])

  async function handleRejectPov(povId: string) {
    try {
      await reviewPovSubmission(povId, 'rejected', 'Afgekeurd door de organisatie.')
      setSubmissions((prev) => prev.map((submission) => submission.id === povId
        ? { ...submission, reviewStatus: 'rejected', rejectionReason: 'Afgekeurd door de organisatie.', awardedPoints: 0 }
        : submission))
      setSelectedPov(null)
    } catch {
      window.alert('De afkeuring kon niet worden opgeslagen. Probeer het opnieuw.')
    }
  }

  async function handleDeletePov(submission: PovSubmission) {
    if (!window.confirm(`Foto van ${submission.uploaderName} definitief verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return
    try {
      await deletePovSubmission(submission.id)
      setSubmissions((previous) => previous.filter((item) => item.id !== submission.id))
      setSelectedPov(null)
      setSelectedPovUrl('')
    } catch {
      window.alert('De foto kon niet worden verwijderd. Probeer het opnieuw.')
    }
  }

  async function openPovModal(submission: PovSubmission) {
    setSelectedPov(submission)
    setPointsInput(submission.awardedPoints > 0 ? String(submission.awardedPoints) : '100')
    try {
      const url = await createPovPhotoUrl(submission.storagePath)
      setSelectedPovUrl(url)
    } catch {
      setSelectedPovUrl('https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=800&q=80')
    }
  }

  async function awardPointsToPov() {
    if (!selectedPov) return
    const points = Number(pointsInput)
    if (!Number.isInteger(points) || points < 0 || points > 10000) {
      window.alert('Vul een heel puntenaantal tussen 0 en 10.000 in.')
      return
    }
    setEvaluatingPovId(selectedPov.id)

    try {
      await approvePovSubmissionWithPoints(selectedPov.id, points)
      setSubmissions((prev) => prev.map((submission) => submission.id === selectedPov.id
        ? { ...submission, reviewStatus: 'approved', rejectionReason: null, awardedPoints: points }
        : submission))
      setSelectedPov(null)
    } catch {
      window.alert('De beoordeling kon niet worden opgeslagen. Probeer het opnieuw.')
    } finally {
      setEvaluatingPovId(null)
    }
  }

  async function handleAddPerson() {
    if (!newFirstName.trim() || !newLastName.trim() || !newEmail.trim() || peopleSaving) return
    setPeopleSaving(true)
    setPeopleError('')
    try {
      await saveOrganizerPerson({
        studentNumber: ['student', 'buddy'].includes(newRole) ? newStudentNumber.trim() || null : null,
        firstName: newFirstName.trim(),
        namePrefix: null,
        lastName: newLastName.trim(),
        email: newEmail.trim(),
        role: newRole,
        classCode: ['interested_teacher', 'organizer'].includes(newRole) ? null : newClassCode,
        active: true,
      }, null)
      setNewFirstName('')
      setNewLastName('')
      setNewStudentNumber('')
      setNewEmail('')
      setShowNewPersonModal(false)
      await loadOrganizerPeople()
    } catch (reason) {
      setPeopleError(reason instanceof Error ? reason.message : 'De persoon kon niet worden toegevoegd.')
    } finally {
      setPeopleSaving(false)
    }
  }

  function openEditPersonModal(person: OrganizerPerson) {
    setEditingPersonId(person.profileId)
    setEditFirstName(person.firstName)
    setEditNamePrefix(person.namePrefix ?? '')
    setEditLastName(person.lastName)
    setEditStudentNumber(person.studentNumber ?? '')
    setEditEmail(person.email)
    setEditRole(person.role)
    setEditClassCode(person.classCode ?? '')
    setEditActive(person.active)
    setEditSendNotification(true)
    setEditNotificationChannel('both')
    setShowEditPersonModal(true)
  }

  async function handleSaveEditedPerson() {
    if (!editingPersonId || !editFirstName.trim() || !editLastName.trim() || !editEmail.trim() || peopleSaving) return
    setPeopleSaving(true)
    setPeopleError('')
    setPeopleSuccess('')
    try {
      const original = people.find((person) => person.profileId === editingPersonId)
      const nextClassCode = ['interested_teacher', 'organizer'].includes(editRole) ? null : editClassCode
      await saveOrganizerPerson({
        studentNumber: ['student', 'buddy'].includes(editRole) ? editStudentNumber.trim() || null : null,
        firstName: editFirstName.trim(),
        namePrefix: editNamePrefix.trim() || null,
        lastName: editLastName.trim(),
        email: editEmail.trim(),
        role: editRole,
        classCode: nextClassCode,
        active: editActive,
      }, editingPersonId)
      if (editSendNotification && editActive) {
        const classChanged = (original?.classCode ?? null) !== nextClassCode
        await notifyOrganizerPersonChange({
          profileId: editingPersonId,
          title: classChanged ? 'Je klas is gewijzigd' : 'Je profiel is bijgewerkt',
          body: classChanged
            ? `Je gaat van ${original?.classCode || 'geen klas'} naar ${nextClassCode || 'geen klas'}. Je programma en contactpersonen zijn bijgewerkt.`
            : 'De organisatie heeft je profielgegevens bijgewerkt.',
          deliveryChannel: editNotificationChannel,
        })
      }
      setShowEditPersonModal(false)
      setEditingPersonId(null)
      await loadOrganizerPeople()
      setPeopleSuccess(
        editSendNotification && editActive
          ? 'Wijziging opgeslagen en notificatie verstuurd.'
          : editActive
            ? 'Wijziging opgeslagen.'
            : 'Wijziging opgeslagen. De persoon is nu inactief.',
      )
    } catch (reason) {
      setPeopleError(reason instanceof Error ? reason.message : 'De wijzigingen konden niet worden opgeslagen.')
    } finally {
      setPeopleSaving(false)
    }
  }

  async function handleDeletePerson(person: OrganizerPerson) {
    if (!window.confirm(`Weet je zeker dat je ${person.email} wilt deactiveren? De historie blijft bewaard.`)) return
    setPeopleSaving(true)
    setPeopleError('')
    try {
      await deactivateOrganizerPerson(person.profileId)
      await loadOrganizerPeople()
    } catch (reason) {
      setPeopleError(reason instanceof Error ? reason.message : 'De persoon kon niet worden gedeactiveerd.')
    } finally {
      setPeopleSaving(false)
    }
  }

  async function handleSendBroadcast() {
    if (!msgTitle.trim() || !msgBody.trim() || msgSending) return
    const recipientProfileIds = [...new Set([...selectedBuddyIds, ...selectedPoerIds])]
    if (selectedClassCodes.length === 0 && recipientProfileIds.length === 0) {
      setMsgSuccess('Kies eerst minimaal één klas, buddy of PO’er.')
      return
    }
    setMsgSending(true)
    setMsgSuccess('')
    try {
      const result = await sendOrganizerNotification({
        title: msgTitle.trim(),
        body: msgBody.trim(),
        classCodes: selectedClassCodes,
        recipientProfileIds,
        deliveryChannel: msgChannel,
        actionTarget: 'notifications',
      })
      const targetLabels = [
        ...selectedClassCodes,
        ...messageRecipients.filter((recipient) => recipientProfileIds.includes(recipient.id)).map((recipient) => recipient.displayName),
      ]
    const newMsg: AnnouncementMessage = {
      id: result.messageId || `msg-${Date.now()}`,
        title: msgTitle.trim(),
        body: msgBody.trim(),
      scheduledAt: new Date().toISOString(),
        targets: targetLabels,
      channel: msgChannel,
      actionTarget: 'notifications',
      status: 'sent',
      source: 'history',
    }

    setMessages((prev) => [newMsg, ...prev])
      setMsgSuccess(`Melding verzonden naar ${result.recipientCount} ontvanger${result.recipientCount === 1 ? '' : 's'}.`)
      clearMessageComposer()
    window.setTimeout(() => setMsgSuccess(''), 4_000)
    } catch (reason) {
      setMsgSuccess(reason instanceof Error ? reason.message : 'De melding kon niet worden verzonden.')
    } finally {
      setMsgSending(false)
    }
  }

  function clearMessageComposer() {
    const currentMoment = currentLocalMessageMoment()
    setEditingScheduledMessageId(null)
    setMsgTitle('')
    setMsgBody('')
    setMsgScheduledDate(currentMoment.date)
    setMsgScheduledTime(currentMoment.time)
    setSelectedClassCodes([])
    setSelectedBuddyIds([])
    setSelectedPoerIds([])
    setMsgChannel('both')
  }

  function setMessageMomentToNow() {
    const currentMoment = currentLocalMessageMoment()
    setMsgScheduledDate(currentMoment.date)
    setMsgScheduledTime(currentMoment.time)
  }

  function handleMessageDateChange(value: string) {
    setMsgScheduledDate(value)
  }

  function handleMessageTimeChange(value: string) {
    setMsgScheduledTime(value)
  }

  function startEditingScheduledMessage(message: AnnouncementMessage) {
    if (message.source !== 'master' || !message.id.startsWith('master:')) return
    const masterId = message.id.slice('master:'.length)
    const source = content?.messages.find((item) => item.id === masterId)
    if (!source) {
      setMsgSuccess('Dit ingeplande bericht kon niet in de centrale inhoud worden gevonden.')
      return
    }

    const classCodes = source.classCodes === 'all' ? activeClassCodes : source.classCodes
    const explicitRecipientIds = source.recipientProfileIds ?? []
    setEditingScheduledMessageId(masterId)
    setMsgTitle(source.title)
    setMsgBody(source.body)
    setMsgScheduledDate(localDatePart(source.scheduledAt))
    setMsgScheduledTime(localTimePart(source.scheduledAt))
    setSelectedClassCodes(source.roles.includes('student') ? classCodes : [])
    setSelectedBuddyIds(source.roles.includes('buddy')
      ? buddyRecipients.filter((recipient) => explicitRecipientIds.length > 0
        ? explicitRecipientIds.includes(recipient.id)
        : !recipient.classCode || classCodes.includes(recipient.classCode)).map((recipient) => recipient.id)
      : [])
    setSelectedPoerIds(source.roles.includes('poer')
      ? poerRecipients.filter((recipient) => explicitRecipientIds.length > 0
        ? explicitRecipientIds.includes(recipient.id)
        : !recipient.classCode || classCodes.includes(recipient.classCode)).map((recipient) => recipient.id)
      : [])
    setMsgChannel(source.channel ?? 'both')
    setMsgSuccess('')
    window.setTimeout(() => composeMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  async function handleSaveScheduledMessage() {
    if (!editingScheduledMessageId || !content || msgSending) return
    const recipientProfileIds = [...new Set([...selectedBuddyIds, ...selectedPoerIds])]
    if (!msgTitle.trim() || !msgBody.trim() || !msgScheduledDate || !msgScheduledTime) {
      setMsgSuccess('Vul titel, berichtinhoud, dag en tijd volledig in.')
      return
    }
    if (selectedClassCodes.length === 0 && recipientProfileIds.length === 0) {
      setMsgSuccess('Kies eerst minimaal één klas, buddy of PO’er.')
      return
    }

    const current = content.messages.find((message) => message.id === editingScheduledMessageId)
    if (!current) {
      setMsgSuccess('Dit ingeplande bericht bestaat niet meer in de centrale inhoud.')
      return
    }

    const roles = [
      ...(selectedClassCodes.length ? ['student' as const] : []),
      ...(selectedBuddyIds.length ? ['buddy' as const] : []),
      ...(selectedPoerIds.length ? ['poer' as const] : []),
    ]
    const audienceClassCodes = [...new Set([
      ...selectedClassCodes,
      ...messageRecipients
        .filter((recipient) => recipientProfileIds.includes(recipient.id) && recipient.classCode)
        .map((recipient) => recipient.classCode as string),
    ])]
    const classCodes = audienceClassCodes.length === activeClassCodes.length ? 'all' as const : audienceClassCodes
    const scheduledDate = new Date(`${msgScheduledDate}T${msgScheduledTime}:00`)
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      setMsgSuccess('Kies een geldig moment in de toekomst.')
      return
    }
    const scheduledAt = scheduledDate.toISOString()
    const updatedMessage = {
      ...current,
      title: msgTitle.trim(),
      body: msgBody.trim(),
      scheduledAt,
      classCodes,
      roles,
      recipientProfileIds,
      channel: msgChannel,
    }
    const updatedContent: MasterContent = {
      ...content,
      messages: content.messages.map((message) => message.id === editingScheduledMessageId ? updatedMessage : message),
    }

    setMsgSending(true)
    setMsgSuccess('')
    try {
      await updateMasterContent(updatedContent, contentVersion)
      setMessages((currentMessages) => currentMessages.map((message) => message.id === `master:${editingScheduledMessageId}` ? {
        ...message,
        title: updatedMessage.title,
        body: updatedMessage.body,
        scheduledAt,
        channel: msgChannel,
        targets: [
          ...(selectedClassCodes.length === activeClassCodes.length ? ['Alle klassen'] : selectedClassCodes),
          ...(selectedBuddyIds.length ? ['Buddy’s'] : []),
          ...(selectedPoerIds.length ? ['PO’ers'] : []),
        ],
      } : message))
      onContentUpdated()
      clearMessageComposer()
      setMsgSuccess('Het ingeplande bericht is centraal aangepast en opgeslagen.')
      window.setTimeout(() => setMsgSuccess(''), 4_000)
    } catch (reason) {
      setMsgSuccess(reason instanceof Error ? reason.message : 'Het ingeplande bericht kon niet worden opgeslagen.')
    } finally {
      setMsgSending(false)
    }
  }

  async function handleScheduleBroadcast() {
    if (!content || msgSending) return
    const recipientProfileIds = [...new Set([...selectedBuddyIds, ...selectedPoerIds])]
    if (!msgTitle.trim() || !msgBody.trim() || !msgScheduledDate || !msgScheduledTime) {
      setMsgSuccess('Vul titel, berichtinhoud, dag en tijd volledig in.')
      return
    }
    if (selectedClassCodes.length === 0 && recipientProfileIds.length === 0) {
      setMsgSuccess('Kies eerst minimaal één klas, buddy of PO’er.')
      return
    }

    const scheduledDate = new Date(`${msgScheduledDate}T${msgScheduledTime}:00`)
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      setMsgSuccess('Een ingepland bericht moet in de toekomst liggen.')
      return
    }

    const roles: ImportRole[] = [
      ...(selectedClassCodes.length ? ['student' as const] : []),
      ...(selectedBuddyIds.length ? ['buddy' as const] : []),
      ...(selectedPoerIds.length ? ['poer' as const] : []),
    ]
    const audienceClassCodes = [...new Set([
      ...selectedClassCodes,
      ...messageRecipients
        .filter((recipient) => recipientProfileIds.includes(recipient.id) && recipient.classCode)
        .map((recipient) => recipient.classCode as string),
    ])]
    const classCodes = audienceClassCodes.length === activeClassCodes.length ? 'all' as const : audienceClassCodes
    const id = `od-${Date.now().toString(36)}`
    const scheduledAt = scheduledDate.toISOString()
    const nextMessage: MasterContent['messages'][number] = {
      id,
      scheduledAt,
      expiresAt: null,
      title: msgTitle.trim(),
      body: msgBody.trim(),
      classCodes,
      roles,
      recipientProfileIds,
      channel: msgChannel,
      linkUrl: null,
      backfillOnClassChange: true,
      priority: 'normal',
      active: true,
    }
    const updatedContent: MasterContent = { ...content, messages: [...content.messages, nextMessage] }

    setMsgSending(true)
    setMsgSuccess('')
    try {
      await updateMasterContent(updatedContent, contentVersion)
      setMessages((current) => [...current, {
        id: `master:${id}`,
        title: nextMessage.title,
        body: nextMessage.body,
        scheduledAt,
        targets: [
          ...(selectedClassCodes.length === activeClassCodes.length ? ['Alle klassen'] : selectedClassCodes),
          ...(selectedBuddyIds.length ? ['Buddy’s'] : []),
          ...(selectedPoerIds.length ? ['PO’ers'] : []),
        ],
        channel: msgChannel,
        actionTarget: 'notifications',
        status: 'scheduled',
        source: 'master',
      }])
      onContentUpdated()
      clearMessageComposer()
      setMsgSuccess(`Melding ingepland voor ${scheduledDate.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}.`)
      window.setTimeout(() => setMsgSuccess(''), 4_000)
    } catch (reason) {
      setMsgSuccess(reason instanceof Error ? reason.message : 'De melding kon niet worden ingepland.')
    } finally {
      setMsgSending(false)
    }
  }

  function handleSubmitMessage() {
    if (editingScheduledMessageId) return void handleSaveScheduledMessage()
    const moment = compareMessageMoment(msgScheduledDate, msgScheduledTime)
    if (moment === 'invalid') {
      setMsgSuccess('Vul dag en tijd volledig in.')
      return
    }
    if (effectiveMessageDeliveryTiming === 'scheduled') return void handleScheduleBroadcast()
    return void handleSendBroadcast()
  }

  function findLocationByReference(reference: string | null | undefined) {
    if (!reference) return null
    return (content?.locations ?? []).find((location) => (
      location.id === reference || location.name.toLocaleLowerCase('nl-NL') === reference.toLocaleLowerCase('nl-NL')
    )) ?? null
  }

  function programmeLocationLabel(reference: string | null | undefined) {
    return findLocationByReference(reference)?.name ?? reference ?? 'Niet ingesteld'
  }

  const selectableLocations = useMemo(() => (
    (content?.locations ?? [])
      .filter((location) => location.active !== false)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'nl-NL'))
  ), [content?.locations])

  function openEditProgrammeModal(item: MasterContent['programmes'][number]) {
    setEditingProgrammeId(item.id)
    setEditDate(item.date)
    setEditTime(item.startTime)
    setEditEndTime(item.endTime ?? '')
    setEditTitle(item.title)
    setEditDescription(item.description ?? '')
    setEditLocation(findLocationByReference(item.locationId)?.id ?? item.locationId ?? '')
    setAddingProgrammeLocation(false)
    setNewLocationName('')
    setNewLocationAddress('')
    setNewLocationPostalCode('')
    setNewLocationCity('Amsterdam')
    setNewLocationRouteUrl('')
    setScheduleError('')
  }

  async function handleSaveProgrammeItem() {
    if (!editingProgrammeId || !editTitle.trim() || scheduleSaving) return
    setScheduleSaving(true)
    setScheduleError('')
    setScheduleSuccess('')

    const baseContent = content ?? createInitialMasterContent()
    const currentLocations = [...(baseContent.locations ?? [])]
    let updatedLocations = currentLocations
    let targetLocId: string | null = editLocation || null

    if (addingProgrammeLocation) {
      const locationName = newLocationName.trim()
      const locationAddress = newLocationAddress.trim()
      if (!locationName || !locationAddress) {
        setScheduleError('Vul voor de nieuwe locatie minimaal een naam en adres in.')
        setScheduleSaving(false)
        return
      }

      const duplicate = currentLocations.find((location) => location.name.trim().toLocaleLowerCase('nl-NL') === locationName.toLocaleLowerCase('nl-NL'))
      if (duplicate) {
        targetLocId = duplicate.id
      } else {
        const city = newLocationCity.trim() || 'Amsterdam'
        const newLocationId = `loc-${Date.now().toString(36)}`
        const routeUrl = newLocationRouteUrl.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${locationName}, ${locationAddress}, ${city}`)}`
        updatedLocations = [...currentLocations, {
          id: newLocationId,
          name: locationName,
          address: locationAddress,
          postalCode: newLocationPostalCode.trim(),
          city,
          routeUrl,
          latitude: null,
          longitude: null,
          active: true,
        }]
        targetLocId = newLocationId
      }
    }

    const updatedProgrammes = programmesList.map((item) =>
      item.id === editingProgrammeId
        ? {
            ...item,
            date: editDate || item.date || '2026-08-25',
            startTime: editTime || '13:00',
            endTime: editEndTime || null,
            title: editTitle.trim() || 'Activiteit',
            category: item.category ?? 'Programma',
            locationId: targetLocId,
            classCodes: item.classCodes ?? 'all',
            description: editDescription.trim() || null,
            order: item.order ?? 1,
            active: item.active ?? true,
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
            active: item.active ?? true,
          }
    )

    // Build next MasterContent & save
    const updatedContent: MasterContent = {
      ...baseContent,
      locations: updatedLocations,
      programmes: updatedProgrammes,
    }

    try {
      await updateMasterContent(updatedContent, contentVersion)
      setProgrammesList(updatedProgrammes)
      onContentUpdated()
      setScheduleSuccess(`Programma-onderdeel "${editTitle.trim()}" is centraal bijgewerkt.`)
      setEditingProgrammeId(null)
      window.setTimeout(() => setScheduleSuccess(''), 4_000)
    } catch (reason) {
      setScheduleError(reason instanceof Error ? reason.message : 'Het programma kon niet centraal worden opgeslagen.')
    } finally {
      setScheduleSaving(false)
    }
  }

  async function handleDeleteProgrammeItem(item: MasterContent['programmes'][number]) {
    if (scheduleSaving || !window.confirm(`Weet je zeker dat je "${item.title}" uit het programma wilt verwijderen?`)) return
    setScheduleSaving(true)
    setScheduleError('')
    setScheduleSuccess('')
    const baseContent = content ?? createInitialMasterContent()
    const updatedProgrammes = programmesList.filter((programme) => programme.id !== item.id)
    const updatedContent: MasterContent = { ...baseContent, programmes: updatedProgrammes }

    try {
      await updateMasterContent(updatedContent, contentVersion)
      setProgrammesList(updatedProgrammes)
      onContentUpdated()
      setScheduleSuccess(`Programma-onderdeel "${item.title}" is verwijderd.`)
      window.setTimeout(() => setScheduleSuccess(''), 4_000)
    } catch (reason) {
      setScheduleError(reason instanceof Error ? reason.message : 'Het programma-onderdeel kon niet worden verwijderd.')
    } finally {
      setScheduleSaving(false)
    }
  }

  const programmeDays = useMemo(() => [...new Set(programmesList.map((item) => item.date).filter(Boolean))].sort(), [programmesList])

  const filteredProgrammes = useMemo(() => {
    const query = programmeSearch.trim().toLowerCase()
    return programmesList
      .filter((item) => programmeDayFilter === 'all' || item.date === programmeDayFilter)
      .filter((item) => !query || [
        item.title,
        item.category,
        programmeLocationLabel(item.locationId),
        item.description ?? '',
        programmeAudienceLabel(item.classCodes),
      ].join(' ').toLowerCase().includes(query))
      .sort((left, right) => (
        left.date.localeCompare(right.date)
        || left.startTime.localeCompare(right.startTime)
        || left.order - right.order
      ))
  }, [content?.locations, programmeDayFilter, programmeSearch, programmesList])

  const filteredPeople = useMemo(() => {
    const collator = new Intl.Collator('nl-NL', { sensitivity: 'base', numeric: true })
    const direction = peopleSort.direction === 'asc' ? 1 : -1

    function sortValue(person: OrganizerPerson) {
      if (peopleSort.key === 'role') return organizerRoleLabel(person.role)
      if (peopleSort.key === 'active') return person.active ? 'Actief' : 'Inactief'
      return person[peopleSort.key] ?? ''
    }

    return people.filter((p) => {
      const matchQuery = `${p.firstName} ${p.namePrefix ?? ''} ${p.lastName} ${p.studentNumber ?? ''} ${p.email} ${p.classCode}`.toLowerCase().includes(personSearch.toLowerCase())
      const matchRole = roleFilter === 'all' || p.role === roleFilter
      const matchClass = classFilter === 'all' || p.classCode === classFilter
      return matchQuery && matchRole && matchClass
    }).sort((left, right) => {
      const primary = collator.compare(String(sortValue(left)), String(sortValue(right)))
      if (primary !== 0) return primary * direction

      return collator.compare(left.lastName, right.lastName)
        || collator.compare(left.namePrefix ?? '', right.namePrefix ?? '')
        || collator.compare(left.firstName, right.firstName)
    })
  }, [people, personSearch, roleFilter, classFilter, peopleSort])

  function togglePeopleSort(key: PeopleSortKey) {
    setPeopleSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  function renderPeopleSortIcon(key: PeopleSortKey) {
    if (peopleSort.key !== key) return <ArrowUpDown aria-hidden="true" />
    return peopleSort.direction === 'asc'
      ? <ArrowUp aria-hidden="true" />
      : <ArrowDown aria-hidden="true" />
  }

  function filterMessages(items: AnnouncementMessage[], filters: MessageHistoryFilters) {
    return items.filter((message) => {
      const matchesDay = !filters.day || localDatePart(message.scheduledAt) === filters.day
      const matchesTime = !filters.time || localTimePart(message.scheduledAt) === filters.time
      const matchesTarget = !filters.target || message.targets.includes(filters.target)
      const matchesChannel = filters.channel === 'all' || message.channel === filters.channel
      return matchesDay && matchesTime && matchesTarget && matchesChannel
    })
  }

  const scheduledSourceMessages = useMemo(() => messages
    .filter((message) => message.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.channel.localeCompare(b.channel)), [messages])
  const sentSourceMessages = useMemo(() => messages
    .filter((message) => message.status === 'sent')
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()), [messages])
  const scheduledMessages = useMemo(() => filterMessages(scheduledSourceMessages, scheduledFilters), [scheduledSourceMessages, scheduledFilters])
  const sentMessages = useMemo(() => filterMessages(sentSourceMessages, sentFilters), [sentSourceMessages, sentFilters])

  function messageFilterOptions(items: AnnouncementMessage[]) {
    return {
      days: [...new Set(items.map((message) => localDatePart(message.scheduledAt)).filter(Boolean))].sort(),
      times: [...new Set(items.map((message) => localTimePart(message.scheduledAt)).filter(Boolean))].sort(),
      targets: [...new Set(items.flatMap((message) => message.targets))].sort((a, b) => a.localeCompare(b, 'nl')),
    }
  }

  const scheduledFilterOptions = useMemo(() => messageFilterOptions(scheduledSourceMessages), [scheduledSourceMessages])
  const sentFilterOptions = useMemo(() => messageFilterOptions(sentSourceMessages), [sentSourceMessages])

  function toggleSelection(value: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

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
          <button type="button" className={activeTab === 'messages' ? 'active' : ''} onClick={() => { if (activeTab !== 'messages' && !editingScheduledMessageId) setMessageMomentToNow(); setActiveTab('messages') }}>
            <Bell aria-hidden="true" />
            <span>Berichten</span>
          </button>
          <button type="button" className={`subtle-tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')} title="Technisch beheerderspaneel">
            <Settings aria-hidden="true" />
            <span>Technisch</span>
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
                  <button type="button" className="secondary-button" onClick={() => void handleMasterExport()} disabled={peopleExporting}>
                    <Download aria-hidden="true" />
                    <span>{peopleExporting ? 'Excel maken…' : 'Excel exporteren'}</span>
                  </button>
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

              {peopleError && <div className="notification-state notification-error">{peopleError}</div>}
              {peopleSuccess && <div className="notification-state notification-success">{peopleSuccess}</div>}
              {peopleLoading && <div className="notification-state">Personen uit de beveiligde database laden…</div>}

              {/* Filters Bar */}
              <div className="table-filters-bar">
                <div className="search-input-wrapper">
                  <Search aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Zoek op naam, studentnummer, e-mail of klas..."
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
                    {activeClassCodes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Responsive Table */}
              <div className="table-responsive-wrapper">
                <table className="dashboard-table people-dashboard-table">
                  <thead>
                    <tr>
                      <th aria-sort={peopleSort.key === 'firstName' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('firstName')}>
                          Voornaam
                          {renderPeopleSortIcon('firstName')}
                        </button>
                      </th>
                      <th className="name-prefix-column"><span className="visually-hidden">Tussenvoegsel</span></th>
                      <th aria-sort={peopleSort.key === 'lastName' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('lastName')}>
                          Achternaam
                          {renderPeopleSortIcon('lastName')}
                        </button>
                      </th>
                      <th className="student-number-column" aria-sort={peopleSort.key === 'studentNumber' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('studentNumber')}>
                          Stud. nr.
                          {renderPeopleSortIcon('studentNumber')}
                        </button>
                      </th>
                      <th aria-sort={peopleSort.key === 'email' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('email')}>
                          E-mailadres
                          {renderPeopleSortIcon('email')}
                        </button>
                      </th>
                      <th aria-sort={peopleSort.key === 'role' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('role')}>
                          Rol
                          {renderPeopleSortIcon('role')}
                        </button>
                      </th>
                      <th aria-sort={peopleSort.key === 'classCode' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('classCode')}>
                          Klas
                          {renderPeopleSortIcon('classCode')}
                        </button>
                      </th>
                      <th aria-sort={peopleSort.key === 'active' ? (peopleSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="table-sort-button" onClick={() => togglePeopleSort('active')}>
                          Status
                          {renderPeopleSortIcon('active')}
                        </button>
                      </th>
                      <th className="table-actions-column" style={{ textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPeople.map((person) => (
                      <tr key={person.profileId}>
                        <td><strong>{person.firstName || '—'}</strong></td>
                        <td className="name-prefix-column" title={person.namePrefix || undefined}>{person.namePrefix || '—'}</td>
                        <td><strong>{person.lastName || '—'}</strong></td>
                        <td className="student-number-column">{person.studentNumber || '—'}</td>
                        <td>{person.email}</td>
                        <td>
                          <span className={`role-badge role-${person.role}`}>
                            {organizerRoleLabel(person.role)}
                          </span>
                        </td>
                        <td><strong>{person.classCode ?? 'Geen'}</strong></td>
                        <td>
                          <span className={person.active ? 'status-dot-active' : 'status-dot-inactive'}>
                            ● {person.active ? 'Actief' : 'Inactief'}
                          </span>
                        </td>
                        <td className="table-actions-column" style={{ textAlign: 'right' }}>
                          <div className="table-row-actions">
                            <button
                              type="button"
                              className="secondary-button icon-only-btn table-action-button"
                              onClick={() => openEditPersonModal(person)}
                              title="Persoon bewerken"
                              aria-label={`Bewerk ${[person.firstName, person.namePrefix, person.lastName].filter(Boolean).join(' ')}`}
                            >
                              <Edit3 aria-hidden="true" />
                            </button>
                            {person.active && (
                              <button
                                type="button"
                                className="danger-button icon-only-btn table-action-button"
                                onClick={() => void handleDeletePerson(person)}
                                disabled={peopleSaving}
                                title="Persoon inactief zetten"
                                aria-label={`Zet ${[person.firstName, person.namePrefix, person.lastName].filter(Boolean).join(' ')} inactief`}
                              >
                                <Trash2 aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!peopleLoading && filteredPeople.length === 0 && (
                      <tr><td colSpan={9}>Geen personen gevonden.</td></tr>
                    )}
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
                  <h2>Programma</h2>
                  <p>Bekijk, bewerk en verwijder programmaonderdelen. De wijzigingen worden centraal opgeslagen.</p>
                </div>
              </div>

              {scheduleSuccess && <div className="notification-state notification-success">{scheduleSuccess}</div>}
              {scheduleError && <div className="notification-state notification-error">{scheduleError}</div>}

              <div className="table-filters-bar">
                <div className="search-input-wrapper">
                  <Search aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Zoek op onderdeel, categorie, locatie of klas..."
                    value={programmeSearch}
                    onChange={(event) => setProgrammeSearch(event.target.value)}
                  />
                </div>
                <div className="select-filters">
                  <select value={programmeDayFilter} onChange={(event) => setProgrammeDayFilter(event.target.value)}>
                    <option value="all">Alle dagen</option>
                    {programmeDays.map((day) => <option key={day} value={day}>{programmeDayLabel(day)}</option>)}
                  </select>
                </div>
              </div>

              <div className="table-responsive-wrapper programme-table-wrapper">
                <table className="dashboard-table programme-dashboard-table">
                  <thead>
                    <tr>
                      <th>Dag</th>
                      <th>Tijd</th>
                      <th>Onderdeel</th>
                      <th>Locatie</th>
                      <th>Voor wie</th>
                      <th>Status</th>
                      <th className="table-actions-column" style={{ textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProgrammes.map((item) => (
                      <tr key={item.id}>
                        <td><strong className="programme-day-cell">{programmeDayLabel(item.date)}</strong></td>
                        <td>
                          <span className="programme-time-cell">
                            <Clock aria-hidden="true" />
                            <strong>{item.startTime}</strong>
                            {item.endTime && <span>– {item.endTime}</span>}
                          </span>
                        </td>
                        <td>
                          <div className="programme-title-cell">
                            <strong>{item.title}</strong>
                            <span>{item.category}</span>
                          </div>
                        </td>
                        <td>
                          <span className="programme-location-cell">
                            <MapPin aria-hidden="true" />
                            <span>{programmeLocationLabel(item.locationId)}</span>
                          </span>
                        </td>
                        <td>{programmeAudienceLabel(item.classCodes)}</td>
                        <td>
                          <span className={item.active ? 'status-dot-active' : 'status-dot-inactive'}>
                            ● {item.active ? 'Actief' : 'Verborgen'}
                          </span>
                        </td>
                        <td className="table-actions-column" style={{ textAlign: 'right' }}>
                          <div className="table-row-actions">
                            <button
                              type="button"
                              className="secondary-button icon-only-btn table-action-button"
                              onClick={() => openEditProgrammeModal(item)}
                              disabled={scheduleSaving}
                              title="Programmaonderdeel bewerken"
                              aria-label={`${item.title} bewerken`}
                            >
                              <Edit3 aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="danger-button icon-only-btn table-action-button"
                              onClick={() => void handleDeleteProgrammeItem(item)}
                              disabled={scheduleSaving}
                              title="Programmaonderdeel verwijderen"
                              aria-label={`${item.title} verwijderen`}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredProgrammes.length === 0 && (
                      <tr><td colSpan={7}>Geen programmaonderdelen gevonden.</td></tr>
                    )}
                  </tbody>
                </table>
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
                  const isEvaluated = item.reviewStatus === 'approved'

                  return (
                    <div
                      key={item.id}
                      className={`pov-dashboard-card ${isEvaluated ? 'is-winner' : ''}`}
                      onClick={() => void openPovModal(item)}
                    >
                      <div className="pov-card-img-holder">
                        <img src="https://images.unsplash.com/photo-1523580494863-6f3031224c94?auto=format&fit=crop&w=400&q=80" alt={item.assignmentTitle} loading="lazy" />
                        {isEvaluated && (
                          <div className="winner-badge">
                            <span>GOEDGEKEURD (+{item.awardedPoints} PT)</span>
                          </div>
                        )}
                      </div>
                      <div className="pov-card-details">
                        <span className="class-tag">{item.classCode}</span>
                        <span className={`pov-review-status status-${item.reviewStatus}`}>
                          {item.reviewStatus === 'approved' ? 'Goedgekeurd' : item.reviewStatus === 'rejected' ? 'Afgekeurd' : 'In afwachting'}
                        </span>
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

          {/* TAB 4: BERICHTEN */}
          {activeTab === 'messages' && (
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <h2>Berichten &amp; pushmeldingen</h2>
                  <p>Stuur gericht naar één of meer klassen, buddy’s en PO’ers.</p>
                </div>
              </div>

              {msgSuccess && <div className="notification-state notification-success">{msgSuccess}</div>}

              {/* Compose Message Form */}
              <div className="compose-message-card" ref={composeMessageRef}>
                <div className="compose-heading">
                  <div>
                    <h3>{editingScheduledMessageId ? 'Ingeplande melding aanpassen' : 'Nieuwe melding'}</h3>
                    <small>{editingScheduledMessageId ? 'Pas de ingevulde velden aan en sla de wijzigingen centraal op.' : 'Verstuur direct of plan een moment in de toekomst.'}</small>
                  </div>
                  {editingScheduledMessageId && <button type="button" className="secondary-button compact-button" onClick={clearMessageComposer}><X aria-hidden="true" /> Annuleren</button>}
                </div>
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
                    <span>Dag</span>
                    <input type="date" min={currentLocalMessageMoment().date} value={msgScheduledDate} onChange={(event) => handleMessageDateChange(event.target.value)} />
                  </label>
                  <label>
                    <span>Tijd</span>
                    <input type="time" value={msgScheduledTime} onChange={(event) => handleMessageTimeChange(event.target.value)} />
                    {!editingScheduledMessageId && <small>De huidige dag en tijd zijn standaard ingevuld. Kies een later moment om het bericht in te plannen.</small>}
                  </label>

                  <fieldset className="recipient-picker full-width">
                    <legend>Doelgroep klassen (studenten)</legend>
                    <button
                      type="button"
                      className={selectedClassCodes.length === activeClassCodes.length ? 'selection-shortcut active' : 'selection-shortcut'}
                      onClick={() => setSelectedClassCodes(selectedClassCodes.length === activeClassCodes.length ? [] : activeClassCodes)}
                    >Alle klassen</button>
                    <div className="recipient-options">
                      {activeClassCodes.map((classCode) => (
                        <label key={classCode} className={selectedClassCodes.includes(classCode) ? 'recipient-option active' : 'recipient-option'}>
                          <input type="checkbox" checked={selectedClassCodes.includes(classCode)} onChange={() => toggleSelection(classCode, setSelectedClassCodes)} />
                          <span>{classCode}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="recipient-picker">
                    <legend>Doelgroep buddy’s</legend>
                    <button type="button" className={buddyRecipients.length > 0 && selectedBuddyIds.length === buddyRecipients.length ? 'selection-shortcut active' : 'selection-shortcut'} onClick={() => setSelectedBuddyIds(selectedBuddyIds.length === buddyRecipients.length ? [] : buddyRecipients.map((item) => item.id))}>Alle buddy’s</button>
                    <div className="recipient-person-list">
                      {buddyRecipients.map((recipient) => (
                        <label key={recipient.id} className="recipient-person">
                          <input type="checkbox" checked={selectedBuddyIds.includes(recipient.id)} onChange={() => toggleSelection(recipient.id, setSelectedBuddyIds)} />
                          <span><b>{recipient.displayName}</b><small>{recipient.classCode ?? 'Geen klas'}</small></span>
                        </label>
                      ))}
                      {!recipientsLoading && !buddyRecipients.length && <small>Geen buddy’s gevonden.</small>}
                    </div>
                  </fieldset>

                  <fieldset className="recipient-picker">
                    <legend>Doelgroep PO’ers</legend>
                    <button type="button" className={poerRecipients.length > 0 && selectedPoerIds.length === poerRecipients.length ? 'selection-shortcut active' : 'selection-shortcut'} onClick={() => setSelectedPoerIds(selectedPoerIds.length === poerRecipients.length ? [] : poerRecipients.map((item) => item.id))}>Alle PO’ers</button>
                    <div className="recipient-person-list">
                      {poerRecipients.map((recipient) => (
                        <label key={recipient.id} className="recipient-person">
                          <input type="checkbox" checked={selectedPoerIds.includes(recipient.id)} onChange={() => toggleSelection(recipient.id, setSelectedPoerIds)} />
                          <span><b>{recipient.displayName}</b><small>{recipient.classCode ?? 'Geen klas'}</small></span>
                        </label>
                      ))}
                      {!recipientsLoading && !poerRecipients.length && <small>Geen PO’ers gevonden.</small>}
                    </div>
                  </fieldset>
                  {recipientsLoading && <p className="recipient-help full-width">Ontvangers ophalen…</p>}
                  {recipientsError && <p className="recipient-help recipient-error full-width">{recipientsError}</p>}

                  <label>
                    <span>Verzendkanaal</span>
                    <select value={msgChannel} onChange={(e) => setMsgChannel(e.target.value as OrganizerDeliveryChannel)}>
                      <option value="both">In-app + pushmelding</option>
                      <option value="in-app">Alleen in-app</option>
                      <option value="push">Alleen pushmelding</option>
                    </select>
                    <small>Push verschijnt als browsermelding wanneer het apparaat toestemming heeft. Bij “alleen pushmelding” wordt geen kopie in Meldingen opgeslagen.</small>
                  </label>
                </div>

                <div className="compose-actions">
                  <button type="button" className="primary-button" onClick={handleSubmitMessage} disabled={msgSending}>
                    {editingScheduledMessageId ? <Check aria-hidden="true" /> : effectiveMessageDeliveryTiming === 'scheduled' ? <Calendar aria-hidden="true" /> : <Send aria-hidden="true" />}
                    <span>{msgSending ? 'Opslaan…' : editingScheduledMessageId ? 'Wijzigingen opslaan' : effectiveMessageDeliveryTiming === 'scheduled' ? 'Bericht inplannen' : 'Nu versturen'}</span>
                  </button>
                </div>
              </div>

              {/* Message History */}
              <div className="message-history">
                <div className="history-header">
                  <div><h3>Ingeplande berichten</h3><small>Standaard op dag, tijd en kanaal · klik op een bericht om het aan te passen.</small></div>
                </div>

                <div className="message-filter-grid">
                  <label><span>Dag</span><select value={scheduledFilters.day} onChange={(event) => setScheduledFilters((current) => ({ ...current, day: event.target.value }))}><option value="">Alle dagen</option>{scheduledFilterOptions.days.map((day) => <option key={day} value={day}>{new Date(`${day}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}</select></label>
                  <label><span>Tijd</span><select value={scheduledFilters.time} onChange={(event) => setScheduledFilters((current) => ({ ...current, time: event.target.value }))}><option value="">Alle tijden</option>{scheduledFilterOptions.times.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                  <label><span>Naar</span><select value={scheduledFilters.target} onChange={(event) => setScheduledFilters((current) => ({ ...current, target: event.target.value }))}><option value="">Alle ontvangers</option>{scheduledFilterOptions.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label>
                  <label><span>Kanaal</span><select value={scheduledFilters.channel} onChange={(event) => setScheduledFilters((current) => ({ ...current, channel: event.target.value as MessageHistoryFilters['channel'] }))}><option value="all">Alle kanalen</option><option value="both">In-app + push</option><option value="in-app">Alleen in-app</option><option value="push">Alleen push</option></select></label>
                  <button type="button" className="filter-reset-button" onClick={() => setScheduledFilters({ ...EMPTY_MESSAGE_FILTERS })}><Filter aria-hidden="true" /> Wis filters</button>
                </div>

                <div className="message-list">
                  {scheduledMessages.length === 0 && <p className="notification-state">Geen ingeplande berichten.</p>}
                  {scheduledMessages.map((msg) => (
                    <button type="button" key={msg.id} className="message-history-card editable-message-card" onClick={() => startEditingScheduledMessage(msg)}>
                      <div className="msg-header">
                        <strong>{msg.title}</strong>
                        <span className="msg-time">{new Date(msg.scheduledAt).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p>{msg.body}</p>
                      <div className="msg-badges">
                        <span className="badge">Naar: {msg.targets.join(', ')}</span>
                        <span className="badge">Kanaal: {deliveryChannelLabel(msg.channel)}</span>
                        <span className="badge edit-badge"><Edit3 aria-hidden="true" /> Aanpassen</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="message-history">
                <div className="history-header"><div><h3>Verzonden berichten</h3><small>Nieuwste berichten staan bovenaan.</small></div></div>
                <div className="message-filter-grid">
                  <label><span>Dag</span><select value={sentFilters.day} onChange={(event) => setSentFilters((current) => ({ ...current, day: event.target.value }))}><option value="">Alle dagen</option>{sentFilterOptions.days.map((day) => <option key={day} value={day}>{new Date(`${day}T12:00:00`).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</option>)}</select></label>
                  <label><span>Tijd</span><select value={sentFilters.time} onChange={(event) => setSentFilters((current) => ({ ...current, time: event.target.value }))}><option value="">Alle tijden</option>{sentFilterOptions.times.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
                  <label><span>Naar</span><select value={sentFilters.target} onChange={(event) => setSentFilters((current) => ({ ...current, target: event.target.value }))}><option value="">Alle ontvangers</option>{sentFilterOptions.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label>
                  <label><span>Kanaal</span><select value={sentFilters.channel} onChange={(event) => setSentFilters((current) => ({ ...current, channel: event.target.value as MessageHistoryFilters['channel'] }))}><option value="all">Alle kanalen</option><option value="both">In-app + push</option><option value="in-app">Alleen in-app</option><option value="push">Alleen push</option></select></label>
                  <button type="button" className="filter-reset-button" onClick={() => setSentFilters({ ...EMPTY_MESSAGE_FILTERS })}><Filter aria-hidden="true" /> Wis filters</button>
                </div>
                <div className="message-list">
                  {sentMessages.length === 0 && <p className="notification-state">Nog geen berichten verzonden.</p>}
                  {sentMessages.map((msg) => (
                    <div key={msg.id} className="message-history-card">
                      <div className="msg-header">
                        <strong>{msg.title}</strong>
                        <span className="msg-time">{new Date(msg.scheduledAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p>{msg.body}</p>
                      <div className="msg-badges">
                        <span className="badge">Naar: {msg.targets.join(', ')}</span>
                        <span className="badge">Kanaal: {deliveryChannelLabel(msg.channel)}</span>
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
        <div className="modal-overlay pov-modal-overlay" onClick={() => setSelectedPov(null)}>
          <div
            className="modal-content pov-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Ingestuurde foto voor ${selectedPov.assignmentTitle}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pov-modal-header">
              <strong>Ingestuurde foto</strong>
              <button type="button" className="pov-modal-close" onClick={() => setSelectedPov(null)} aria-label="Foto sluiten">
                <X aria-hidden="true" />
                <span>Sluiten</span>
              </button>
            </div>

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
                      onClick={() => { void handleRejectPov(selectedPov.id) }}
                    >
                      <X aria-hidden="true" />
                      <span>Afkeuren (plek komt vrij)</span>
                    </button>
                    <button
                      type="button"
                      className="moderation-btn delete-btn"
                      onClick={() => { void handleDeletePov(selectedPov) }}
                    >
                      <Trash2 aria-hidden="true" />
                      <span>Foto definitief verwijderen</span>
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
              <label>
                <span>Studentnummer {['student', 'buddy'].includes(newRole) ? '(verplicht)' : '(niet nodig)'}</span>
                <input
                  type="text"
                  value={newStudentNumber}
                  disabled={!['student', 'buddy'].includes(newRole)}
                  onChange={(e) => setNewStudentNumber(e.target.value)}
                />
              </label>
              <label className="full-width">
                <span>E-mailadres</span>
                <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </label>
              <label>
                <span>Rol</span>
                <select value={newRole} onChange={(e) => {
                  const nextRole = e.target.value as ImportRole
                  setNewRole(nextRole)
                  if (['interested_teacher', 'organizer'].includes(nextRole)) setNewClassCode('')
                  else if (!newClassCode) setNewClassCode('LM1A')
                }}>
                  <option value="student">Student</option>
                  <option value="buddy">Buddy</option>
                  <option value="poer">PO'er</option>
                  <option value="interested_teacher">Geïnteresseerde docent / medewerker</option>
                  <option value="organizer">Organisator</option>
                </select>
              </label>
              <label>
                <span>Klas {['interested_teacher', 'organizer'].includes(newRole) ? '(niet nodig)' : ''}</span>
                <select
                  value={newClassCode}
                  disabled={['interested_teacher', 'organizer'].includes(newRole)}
                  onChange={(e) => setNewClassCode(e.target.value)}
                >
                  <option value="">Geen klas</option>
                  {activeClassCodes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary-button" onClick={() => void handleAddPerson()} disabled={peopleSaving}>
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
                <select value={editRole} onChange={(e) => {
                  const nextRole = e.target.value as ImportRole
                  setEditRole(nextRole)
                  if (['interested_teacher', 'organizer'].includes(nextRole)) setEditClassCode('')
                  else if (!editClassCode) setEditClassCode('LM1A')
                }}>
                  <option value="student">Student</option>
                  <option value="buddy">Buddy</option>
                  <option value="poer">PO'er</option>
                  <option value="interested_teacher">Geïnteresseerde docent / medewerker</option>
                  <option value="organizer">Organisator</option>
                </select>
              </label>
              <label>
                <span>Klas {['interested_teacher', 'organizer'].includes(editRole) ? '(niet nodig)' : ''}</span>
                <select
                  value={editClassCode}
                  disabled={['interested_teacher', 'organizer'].includes(editRole)}
                  onChange={(e) => setEditClassCode(e.target.value)}
                >
                  <option value="">Geen klas</option>
                  {activeClassCodes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={editActive ? 'active' : 'inactive'} onChange={(e) => {
                  const nextActive = e.target.value === 'active'
                  setEditActive(nextActive)
                  if (!nextActive) setEditSendNotification(false)
                }}>
                  <option value="active">Actief</option>
                  <option value="inactive">Inactief</option>
                </select>
              </label>
              <fieldset className="person-notification-options full-width">
                <label className="person-notification-toggle">
                  <input
                    type="checkbox"
                    checked={editSendNotification}
                    disabled={!editActive}
                    onChange={(e) => setEditSendNotification(e.target.checked)}
                  />
                  <span>Stuur notificatie over deze wijziging</span>
                </label>
                {!editActive && <small>Een inactief profiel ontvangt geen app- of pushmeldingen.</small>}
                {editSendNotification && (
                  <label>
                    <span>Verzendkanaal</span>
                    <select
                      value={editNotificationChannel}
                      onChange={(e) => setEditNotificationChannel(e.target.value as OrganizerDeliveryChannel)}
                    >
                      <option value="both">Beide (push en in-app)</option>
                      <option value="push">Alleen push</option>
                      <option value="in-app">Alleen in-app</option>
                    </select>
                  </label>
                )}
              </fieldset>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button type="button" className="secondary-button" onClick={() => setShowEditPersonModal(false)}>
                Annuleren
              </button>
              <button type="button" className="primary-button" onClick={() => void handleSaveEditedPerson()} disabled={peopleSaving}>
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
                <span>Dag</span>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </label>
              <label>
                <span>Naam van onderdeel</span>
                <input type="text" placeholder="bijv. Ontvangst eerstejaars" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </label>
              <label>
                <span>Starttijd</span>
                <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
              </label>
              <label>
                <span>Eindtijd</span>
                <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} />
              </label>
              <label className="full-width">
                <span>Omschrijving</span>
                <textarea rows={3} placeholder="Wat gaan de studenten doen?" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </label>
              <label className="full-width">
                <span>Locatie</span>
                <select
                  value={addingProgrammeLocation ? '__new__' : editLocation}
                  onChange={(event) => {
                    const value = event.target.value
                    setAddingProgrammeLocation(value === '__new__')
                    if (value !== '__new__') setEditLocation(value)
                  }}
                >
                  <option value="">Geen locatie</option>
                  {selectableLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}{location.address ? ` — ${location.address}` : ''}
                    </option>
                  ))}
                  <option value="__new__">＋ Nieuwe locatie toevoegen</option>
                </select>
              </label>
              {addingProgrammeLocation && (
                <fieldset className="new-programme-location full-width">
                  <legend>Nieuwe locatie toevoegen</legend>
                  <label>
                    <span>Naam</span>
                    <input type="text" placeholder="bijv. De Duif" value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} />
                  </label>
                  <label>
                    <span>Adres</span>
                    <input type="text" placeholder="Straat en huisnummer" value={newLocationAddress} onChange={(event) => setNewLocationAddress(event.target.value)} />
                  </label>
                  <label>
                    <span>Postcode</span>
                    <input type="text" placeholder="1234 AB" value={newLocationPostalCode} onChange={(event) => setNewLocationPostalCode(event.target.value)} />
                  </label>
                  <label>
                    <span>Plaats</span>
                    <input type="text" value={newLocationCity} onChange={(event) => setNewLocationCity(event.target.value)} />
                  </label>
                  <label className="full-width">
                    <span>Google Maps-link (optioneel)</span>
                    <input type="url" placeholder="Wordt automatisch gemaakt als je dit leeg laat" value={newLocationRouteUrl} onChange={(event) => setNewLocationRouteUrl(event.target.value)} />
                  </label>
                </fieldset>
              )}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button type="button" className="secondary-button" onClick={() => setEditingProgrammeId(null)}>
                Annuleren
              </button>
              <button type="button" className="primary-button" onClick={() => void handleSaveProgrammeItem()} disabled={scheduleSaving}>
                <Edit3 aria-hidden="true" />
                <span>{scheduleSaving ? 'Opslaan…' : 'Wijzigingen opslaan'}</span>
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
                void loadOrganizerPeople()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
