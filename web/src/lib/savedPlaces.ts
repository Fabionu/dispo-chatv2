import type { WorkspacePlaceCategory } from './types'

export const PLACE_CATEGORIES: WorkspacePlaceCategory[] = [
  'parking',
  'depot',
  'fuel',
  'customer',
  'service',
  'customs',
  'other',
]

export const PLACE_CATEGORY_LABEL: Record<WorkspacePlaceCategory, string> = {
  parking: 'Parking',
  depot: 'Depot',
  fuel: 'Fuel station',
  customer: 'Customer',
  service: 'Service',
  customs: 'Customs',
  other: 'Other',
}

export const PLACE_CATEGORY_COLOR: Record<WorkspacePlaceCategory, string> = {
  parking: '#7394b6',
  depot: '#a88d75',
  fuel: '#6f9f83',
  customer: '#9a83aa',
  service: '#b48b60',
  customs: '#718c99',
  other: '#8c8f94',
}
