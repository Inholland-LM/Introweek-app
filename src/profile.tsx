import { createContext, useContext, type ReactNode } from 'react'

export type AppProfile = {
  id: string | null
  firstName: string
  displayName: string
  profileType: 'student' | 'buddy' | 'poer' | 'organizer'
  classCode: string
  country: string
  flag: string
}

export const demoProfile: AppProfile = {
  id: null,
  firstName: 'Sofia',
  displayName: 'Sofia',
  profileType: 'student',
  classCode: 'LM1A',
  country: 'Australië',
  flag: '🇦🇺',
}

export const demoProfiles: Record<'student' | 'buddy' | 'poer' | 'organizer', AppProfile> = {
  student: demoProfile,
  buddy: {
    id: null,
    firstName: 'Bo',
    displayName: 'Bo Testbuddy',
    profileType: 'buddy',
    classCode: 'LM1A',
    country: 'Australië',
    flag: '🇦🇺',
  },
  poer: {
    id: null,
    firstName: 'Puck',
    displayName: 'Puck Test-POer',
    profileType: 'poer',
    classCode: 'LM1A',
    country: 'Australië',
    flag: '🇦🇺',
  },
  organizer: {
    id: null,
    firstName: 'Jacco',
    displayName: 'Jacco Testorganisatie',
    profileType: 'organizer',
    classCode: 'TEAM',
    country: 'Organisatie',
    flag: '🇳🇱',
  },
}

const ProfileContext = createContext<AppProfile>(demoProfile)

export function ProfileProvider({ profile, children }: { profile: AppProfile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>
}

export function useAppProfile() {
  return useContext(ProfileContext)
}
