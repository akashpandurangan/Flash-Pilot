import type { Equipment, EquipmentCategory, EquipmentCondition } from '@/types/entities'
import { write } from '../store/access'
import { lower, newId, notFound, pgError } from '../store/core'
import { nullable } from './core'

export interface EquipmentInput {
  name: string
  category: EquipmentCategory
  brand_model?: string
  asset_tag?: string
  quantity_owned: number
  condition: EquipmentCondition
  notes?: string
  is_active: boolean
}

const toRow = (input: EquipmentInput) => ({
  name: input.name.trim(),
  category: input.category,
  brand_model: nullable(input.brand_model),
  asset_tag: nullable(input.asset_tag),
  // a uniquely tagged asset is one physical unit
  quantity_owned: nullable(input.asset_tag) ? 1 : input.quantity_owned,
  condition: input.condition,
  notes: nullable(input.notes),
  is_active: input.is_active,
})

const tagTaken = (all: Equipment[], tag: string | null, exceptId?: string) => tag !== null && all.some((e) => e.id !== exceptId && lower(e.asset_tag) === lower(tag))

export async function createEquipment(studioId: string, input: EquipmentInput): Promise<Equipment> {
  return write((db, at) => {
    const row = toRow(input)
    if (tagTaken(db.equipment, row.asset_tag)) throw pgError('duplicate key value violates unique constraint "equipment_asset_tag_key" (asset_tag)', '23505')
    const created: Equipment = { id: newId(), studio_id: studioId, ...row, created_at: at.toISOString() }
    db.equipment.push(created)
    return created
  })
}

export async function updateEquipment(id: string, input: EquipmentInput): Promise<Equipment> {
  return write((db) => {
    const current = db.equipment.find((e) => e.id === id)
    if (!current) throw notFound('equipment')
    const row = toRow(input)
    if (tagTaken(db.equipment, row.asset_tag, id)) throw pgError('duplicate key value violates unique constraint "equipment_asset_tag_key" (asset_tag)', '23505')
    Object.assign(current, row)
    return current
  })
}
