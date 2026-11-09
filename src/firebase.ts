import { getApp, getApps, initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'forma-furniture-marketplace.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'forma-furniture-marketplace',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'forma-furniture-marketplace.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.messagingSenderId && config.appId)
export const firebaseApp = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null
export const auth = firebaseApp ? getAuth(firebaseApp) : null
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
export const appCheckConfigured = Boolean(firebaseApp && appCheckSiteKey)
let appCheck: AppCheck | null = null
/** Starts App Check (reCAPTCHA Enterprise) on first use, so ordinary page views load no reCAPTCHA script. */
export function getAppCheck() {
  if (!appCheck && firebaseApp && appCheckSiteKey) appCheck = initializeAppCheck(firebaseApp, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true })
  return appCheck
}

const authMessages: Record<string, string> = {
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/wrong-password': 'That email and password do not match an account.',
  'auth/user-not-found': 'That email and password do not match an account.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/password-does-not-meet-requirements': 'Use at least 8 characters, including a number.',
  'auth/weak-password': 'Use at least 8 characters, including a number.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
}

/** Turns Firebase Auth errors into plain messages for the sign-in forms. */
export function authErrorMessage(reason: unknown, fallback = 'Sign-in failed.') {
  const code = typeof reason === 'object' && reason && 'code' in reason ? String((reason as { code: unknown }).code) : ''
  return authMessages[code] || (reason instanceof Error ? reason.message : fallback)
}

export const authActionSettings = () => ({ url: `${window.location.origin}/profile` })

export async function keepAdminSession() {
  if (auth) await setPersistence(auth, browserLocalPersistence)
}
