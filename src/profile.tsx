import { createContext, useContext, type ReactNode } from 'react'

export type AppProfile = {
  firstName: string
  displayName: string
  profileType: 'student' | 'buddy' | 'poer' | 'organizer'
  classCode: string
  country: string
  flag: string
}

export const demoProfile: AppProfile = {
  firstName: 'Sofia',
  displayName: 'Sofia',
  profileType: 'student',
  classCode: 'LM1A',
  country: 'Australië',
  flag: '🇦🇺',
}

const ProfileContext = createContext<AppProfile>(demoProfile)

export function ProfileProvider({ profile, children }: { profile: AppProfile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>
}

export function useAppProfile() {
  return useContext(ProfileContext)
}
