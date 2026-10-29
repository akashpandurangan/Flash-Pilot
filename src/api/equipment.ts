import { supabase } from '@/lib/supabase'
import type { Equipment, EquipmentCategory, EquipmentCondition } from '@/types/entities'
import { nullable, unwrap } from './core'

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

export async function createEquipment(studioId: string, input: EquipmentInput): Promise<Equipment> {
  return unwrap(await supabase.from('equipment').insert({ studio_id: studioId, ...toRow(input) }).select().single()) as Equipment
}

export async function updateEquipment(id: string, input: EquipmentInput): Promise<Equipment> {
  return unwrap(await supabase.from('equipment').update(toRow(input)).eq('id', id).select().single()) as Equipment
}
