import { auth } from './firebase'
import type { ProjectState } from './editor'
import type { PurchaseRequest } from './purchase'

export type SavedProject = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  objectCount: number
  roomCount: number
}
export type SavedProjectDetails = SavedProject & { project: ProjectState }
export const cloudProjectKey = (uid: string) => `forma-room-planner-cloud-project:${uid}`

export class AccountApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function accountApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth?.currentUser
  if (!user || user.isAnonymous) throw new Error('Sign in to your Formivo account to sync projects or send a purchase request.')
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${await user.getIdToken()}`)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(`/api/account${path}`, { ...init, headers })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new AccountApiError(response.status, result.error || `Request failed (${response.status}).`)
  return result as T
}

export type { PurchaseRequest }
