export const partnerStages = ['lead', 'contacted', 'negotiating', 'onboarding', 'active', 'paused', 'lost'] as const
export type PartnerStage = typeof partnerStages[number]
export type PartnerFields = {
  company: string
  website: string
  country: string
  contactName: string
  contactEmail: string
  contactPhone: string
  retailerId: string
  stage: PartnerStage
}
export type PartnerNote = { id: string; text: string; at: string; authorEmail: string }
export type Partner = PartnerFields & {
  id: string
  notes: PartnerNote[]
  stageHistory: { stage: PartnerStage; at: string; authorEmail: string }[]
  createdAt: string
  updatedAt: string
}

export const stageLabels: Record<PartnerStage, string> = { lead: 'Lead', contacted: 'Contacted', negotiating: 'Negotiating', onboarding: 'Onboarding', active: 'Active', paused: 'Paused', lost: 'Lost' }

const limits: Record<Exclude<keyof PartnerFields, 'stage'>, number> = { company: 120, website: 200, country: 60, contactName: 100, contactEmail: 160, contactPhone: 40, retailerId: 60 }

/** Validates partner fields. `partial` allows updates that send only some fields. Returns an error message or the cleaned fields. */
export function partnerFields(input: Record<string, unknown>, partial = false): { error: string } | { fields: Partial<PartnerFields> } {
  const fields: Partial<PartnerFields> = {}
  for (const [key, max] of Object.entries(limits) as [Exclude<keyof PartnerFields, 'stage'>, number][]) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return { error: `${key} must be text.` }
    const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
    if (text.length > max) return { error: `${key} must be at most ${max} characters.` }
    fields[key] = text
  }
  if (input.stage !== undefined) {
    if (!partnerStages.includes(input.stage as PartnerStage)) return { error: 'Choose a valid partner stage.' }
    fields.stage = input.stage as PartnerStage
  }
  if (!partial && !fields.company) return { error: 'Company name is required.' }
  if (partial && fields.company === '') return { error: 'Company name is required.' }
  if (fields.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contactEmail)) return { error: 'Contact email is invalid.' }
  if (fields.website && !/^https?:\/\/\S+$/i.test(fields.website)) return { error: 'Website must start with http:// or https://.' }
  if (fields.retailerId && !/^[a-z0-9-]+$/.test(fields.retailerId)) return { error: 'Retailer id uses lowercase letters, numbers and dashes.' }
  if (!partial) return { fields: { website: '', country: '', contactName: '', contactEmail: '', contactPhone: '', retailerId: '', stage: 'lead', ...fields } }
  return { fields }
}
